/*
Copyright Jin Ye

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';

import type { AppEnv } from '../config/env.js';
import { HttpError } from '../lib/errors.js';
import { isAllowedBrowserOrigin } from '../lib/origins.js';
import type { RoomService } from '../services/room-service.js';
import type {
  PlaybackResyncEvent,
  PlaybackStateReportPayload,
  PlaybackUpdateEvent,
  SystemStatus
} from '../types/models.js';

type RealtimeStatus = SystemStatus['realtime'];

type RealtimeDependencies = {
  roomService: RoomService;
};

const roomJoinEventSchema = z.object({
  token: z.string().min(1),
  participantId: z.string().uuid()
});

const participantHeartbeatSchema = z.object({
  token: z.string().min(1),
  participantId: z.string().uuid()
});

const playbackCommandSchema = z.object({
  token: z.string().min(1),
  participantId: z.string().uuid(),
  currentTime: z.number().finite().nonnegative(),
  playbackRate: z.number().positive().optional()
});

const playbackStateReportSchema = playbackCommandSchema.extend({
  playbackState: z.enum(['paused', 'playing'])
});

function toSocketErrorPayload(error: unknown, event: string) {
  if (error instanceof HttpError) {
    return {
      event,
      statusCode: error.statusCode,
      message: error.message
    };
  }

  if (error instanceof Error) {
    return {
      event,
      statusCode: 500,
      message: error.message
    };
  }

  return {
    event,
    statusCode: 500,
    message: 'Unexpected realtime error'
  };
}

export async function bootstrapRealtime(
  app: FastifyInstance,
  env: AppEnv,
  dependencies: RealtimeDependencies
): Promise<RealtimeStatus> {
  const io = new Server(app.server, {
    path: env.realtime.path,
    cors: {
      origin(origin, callback) {
        if (!origin || isAllowedBrowserOrigin(origin, env.webOrigin)) {
          callback(null, true);
          return;
        }

        callback(new Error('Origin not allowed'));
      }
    }
  });

  io.on('connection', (socket) => {
    app.log.info({ socketId: socket.id }, 'Socket.IO client connected');
    socket.emit('system:hello', {
      message: 'VideoTogether realtime ready'
    });

    function requireSocketSession(token: string, participantId: string) {
      const activeToken = socket.data.roomToken as string | undefined;
      const activeParticipantId = socket.data.participantId as string | undefined;

      if (activeToken !== token || activeParticipantId !== participantId) {
        throw new HttpError(403, 'Socket session is not joined to this participant');
      }
    }

    function emitPlaybackUpdate(roomToken: string, payload: PlaybackUpdateEvent) {
      io.to(roomToken).emit('playback:update', payload);
    }

    function emitPlaybackResync(payload: PlaybackResyncEvent) {
      socket.emit('playback:resync', payload);
    }

    function registerPlaybackMutationHandler(
      eventName: 'playback:play' | 'playback:pause' | 'playback:seek',
      handler: RoomService['play']
    ) {
      socket.on(eventName, (rawPayload: unknown) => {
        try {
          const payload = playbackCommandSchema.parse(rawPayload);
          requireSocketSession(payload.token, payload.participantId);

          const result = handler(payload.token, payload.participantId, payload);
          emitPlaybackUpdate(payload.token, {
            room: result.room,
            sourceParticipantId: result.participant.id,
            reason: eventName === 'playback:play'
              ? 'play'
              : eventName === 'playback:pause'
                ? 'pause'
                : 'seek',
            issuedAt: result.room.lastStateUpdatedAt
          });
        } catch (error) {
          socket.emit('system:error', toSocketErrorPayload(error, eventName));
        }
      });
    }

    socket.on('room:join', (rawPayload: unknown) => {
      try {
        const payload = roomJoinEventSchema.parse(rawPayload);
        const previousToken = socket.data.roomToken as string | undefined;

        if (previousToken && previousToken !== payload.token) {
          socket.leave(previousToken);
        }

        const result = dependencies.roomService.connectParticipant(
          payload.token,
          payload.participantId,
          socket.id
        );

        socket.join(payload.token);
        socket.data.roomToken = payload.token;
        socket.data.participantId = payload.participantId;

        socket.emit('room:joined', {
          participant: result.participant,
          room: result.response.room,
          participants: result.response.participants
        });
        io.to(payload.token).emit('room:state', result.response);
        socket.to(payload.token).emit('room:participant-joined', result.participant);
      } catch (error) {
        socket.emit('system:error', toSocketErrorPayload(error, 'room:join'));
      }
    });

    socket.on('participant:heartbeat', (rawPayload: unknown) => {
      try {
        const payload = participantHeartbeatSchema.parse(rawPayload);
        requireSocketSession(payload.token, payload.participantId);
        dependencies.roomService.touchParticipant(payload.token, payload.participantId);
      } catch (error) {
        socket.emit('system:error', toSocketErrorPayload(error, 'participant:heartbeat'));
      }
    });

    registerPlaybackMutationHandler('playback:play', (token, participantId, payload) =>
      dependencies.roomService.play(token, participantId, payload)
    );
    registerPlaybackMutationHandler('playback:pause', (token, participantId, payload) =>
      dependencies.roomService.pause(token, participantId, payload)
    );
    registerPlaybackMutationHandler('playback:seek', (token, participantId, payload) =>
      dependencies.roomService.seek(token, participantId, payload)
    );

    socket.on('playback:state-report', (rawPayload: unknown) => {
      try {
        const payload = playbackStateReportSchema.parse(rawPayload) as PlaybackStateReportPayload;
        requireSocketSession(payload.token, payload.participantId);

        const result = dependencies.roomService.reportPlaybackState(
          payload.token,
          payload.participantId,
          payload
        );

        if (result.shouldResync && result.mode) {
          emitPlaybackResync({
            room: result.room,
            mode: result.mode,
            driftMs: result.driftMs,
            issuedAt: new Date().toISOString()
          });
        }
      } catch (error) {
        socket.emit('system:error', toSocketErrorPayload(error, 'playback:state-report'));
      }
    });

    socket.on('room:leave', () => {
      const roomToken = socket.data.roomToken as string | undefined;
      const participantId = socket.data.participantId as string | undefined;

      if (!roomToken || !participantId) {
        return;
      }

      try {
        const result = dependencies.roomService.leaveRoom(roomToken, participantId);
        socket.leave(roomToken);
        socket.data.roomToken = undefined;
        socket.data.participantId = undefined;
        io.to(roomToken).emit('room:state', result.response);
        socket.to(roomToken).emit('room:participant-left', result.participant);
      } catch (error) {
        socket.emit('system:error', toSocketErrorPayload(error, 'room:leave'));
      }
    });

    socket.on('disconnect', () => {
      const result = dependencies.roomService.disconnectParticipantBySocketId(socket.id);

      if (result) {
        io.to(result.roomToken).emit('room:state', result.response);
        socket.to(result.roomToken).emit('room:participant-left', result.participant);
      }

      app.log.info({ socketId: socket.id }, 'Socket.IO client disconnected');
    });
  });

  app.addHook('onClose', async () => {
    await io.close();
  });

  return {
    transport: env.realtime.transport,
    path: env.realtime.path,
    status: 'ready',
    detail: 'Socket.IO server attached to the Fastify HTTP server'
  };
}





