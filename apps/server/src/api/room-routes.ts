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

import { HttpError } from '../lib/errors.js';
import type { RoomService } from '../services/room-service.js';

const createRoomBodySchema = z.object({
  expiresAt: z.string().datetime().nullable().optional(),
  hostClientId: z.string().min(1).nullable().optional(),
  hostDisplayName: z.string().trim().min(1).max(48).nullable().optional(),
  activeMediaId: z.string().uuid().nullable().optional(),
  activeSubtitleId: z.string().uuid().nullable().optional()
});

const joinRoomBodySchema = z.object({
  displayName: z.string().trim().min(1).max(48),
  participantId: z.string().uuid().nullable().optional()
});

const updateSubtitleBodySchema = z.object({
  activeSubtitleId: z.string().uuid().nullable()
});

type RoomRouteDependencies = {
  roomService: RoomService;
};

export async function registerRoomRoutes(
  app: FastifyInstance,
  dependencies: RoomRouteDependencies
) {
  app.post('/api/rooms', async (request, reply) => {
    const parseResult = createRoomBodySchema.safeParse(request.body ?? {});

    if (!parseResult.success) {
      throw new HttpError(400, 'Invalid room payload');
    }

    const room = dependencies.roomService.createRoom(parseResult.data);

    return reply.status(201).send(room);
  });

  app.get<{
    Params: {
      token: string;
    };
  }>('/api/rooms/:token', async (request) => {
    return dependencies.roomService.getRoomByToken(request.params.token);
  });

  app.post<{
    Params: {
      token: string;
    };
  }>('/api/rooms/:token/join', async (request, reply) => {
    const parseResult = joinRoomBodySchema.safeParse(request.body ?? {});

    if (!parseResult.success) {
      throw new HttpError(400, 'Invalid room join payload');
    }

    const room = dependencies.roomService.joinRoom(request.params.token, parseResult.data);

    return reply.status(200).send(room);
  });

  app.post<{
    Params: {
      token: string;
    };
  }>('/api/rooms/:token/subtitle', async (request, reply) => {
    const parseResult = updateSubtitleBodySchema.safeParse(request.body ?? {});

    if (!parseResult.success) {
      throw new HttpError(400, 'Invalid subtitle selection payload');
    }

    const room = dependencies.roomService.updateActiveSubtitle(
      request.params.token,
      parseResult.data.activeSubtitleId
    );

    return reply.status(200).send(room);
  });

  app.post<{
    Params: {
      token: string;
    };
  }>('/api/rooms/:token/close', async (request, reply) => {
    dependencies.roomService.closeRoom(request.params.token);

    return reply.status(204).send();
  });
}
