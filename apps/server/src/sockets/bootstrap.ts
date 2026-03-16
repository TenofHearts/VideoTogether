import { z } from 'zod';
import { Server } from 'socket.io';
import type { FastifyInstance } from 'fastify';

import type { AppEnv } from '../config/env.js';
import { HttpError } from '../lib/errors.js';
import { isAllowedBrowserOrigin } from '../lib/origins.js';
import type { RoomService } from '../services/room-service.js';
import type { SystemStatus } from '../types/models.js';

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
      message: 'VideoShare realtime ready'
    });

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
        dependencies.roomService.touchParticipant(payload.token, payload.participantId);
      } catch (error) {
        socket.emit('system:error', toSocketErrorPayload(error, 'participant:heartbeat'));
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
