import type { Readable } from 'node:stream';

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
  app.addContentTypeParser(
    'application/octet-stream',
    (_request, payload, done) => {
      done(null, payload);
    }
  );

  app.get('/api/media', async () => {
    return dependencies.mediaService.listRecentMedia();
  });

  app.post<{
    Body: Readable;
  }>(
    '/api/media/import',
    {
      bodyLimit: 20 * 1024 * 1024 * 1024
    },
    async (request, reply) => {
      const rawFileName = request.headers['x-file-name'];
      const stream = request.body;

      if (typeof rawFileName !== 'string' || rawFileName.length === 0) {
        throw new HttpError(400, 'Missing x-file-name header');
      }

      if (!stream) {
        throw new HttpError(400, 'Missing media upload body');
      }

      let fileName = rawFileName;

      try {
        fileName = decodeURIComponent(rawFileName);
      } catch {
        fileName = rawFileName;
      }

      const result = await dependencies.mediaService.importUploadedMedia({
        fileName,
        stream
      });

      return reply.status(202).send(result);
    }
  );

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

  app.post<{
    Params: {
      id: string;
    };
  }>('/api/media/:id/process', async (request, reply) => {
    const result = dependencies.mediaService.requestProcessing(request.params.id);

    return reply.status(202).send(result);
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
