import { z } from 'zod';
import type { FastifyInstance } from 'fastify';

import { HttpError } from '../lib/errors.js';
import type { RoomService } from '../services/room-service.js';

const createRoomBodySchema = z.object({
  expiresAt: z.string().datetime().nullable().optional(),
  hostClientId: z.string().min(1).nullable().optional(),
  activeMediaId: z.string().uuid().nullable().optional(),
  activeSubtitleId: z.string().uuid().nullable().optional()
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
  }>('/api/rooms/:token/close', async (request, reply) => {
    dependencies.roomService.closeRoom(request.params.token);

    return reply.status(204).send();
  });
}
