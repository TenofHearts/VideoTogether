import type { FastifyInstance } from 'fastify';

import { HttpError } from '../lib/errors.js';
import type { MediaService } from '../services/media-service.js';

type MediaRouteDependencies = {
  mediaService: MediaService;
};

export async function registerMediaRoutes(
  app: FastifyInstance,
  dependencies: MediaRouteDependencies
) {
  app.get<{
    Params: {
      id: string;
    };
  }>('/api/media/:id', async (request) => {
    const media = dependencies.mediaService.getMediaById(request.params.id);

    if (!media) {
      throw new HttpError(404, 'Media not found');
    }

    return media;
  });

  app.get<{
    Params: {
      id: string;
    };
  }>('/api/media/:id/subtitles', async (request) => {
    const media = dependencies.mediaService.getMediaById(request.params.id);

    if (!media) {
      throw new HttpError(404, 'Media not found');
    }

    return {
      mediaId: request.params.id,
      subtitles: dependencies.mediaService.listSubtitlesByMediaId(
        request.params.id
      )
    };
  });
}
