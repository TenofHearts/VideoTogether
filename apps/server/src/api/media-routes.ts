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

import type { Readable } from 'node:stream';

import type { FastifyInstance } from 'fastify';

import { HttpError } from '../lib/errors.js';
import type { MediaService } from '../services/media-service.js';
import type { RoomService } from '../services/room-service.js';

type MediaRouteDependencies = {
  mediaService: MediaService;
  roomService: RoomService;
};

function decodeUploadFileName(rawFileName: string): string {
  try {
    return decodeURIComponent(rawFileName);
  } catch {
    return rawFileName;
  }
}

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

      const result = await dependencies.mediaService.importUploadedMedia({
        fileName: decodeUploadFileName(rawFileName),
        stream
      });

      return reply.status(202).send(result);
    }
  );

  app.post<{
    Params: {
      id: string;
    };
    Body: Readable;
  }>(
    '/api/media/:id/subtitles',
    {
      bodyLimit: 256 * 1024 * 1024
    },
    async (request, reply) => {
      const rawFileName = request.headers['x-file-name'];
      const stream = request.body;
      const rawLanguage = request.headers['x-subtitle-language'];
      const rawLabel = request.headers['x-subtitle-label'];
      const rawIsDefault = request.headers['x-subtitle-default'];

      if (typeof rawFileName !== 'string' || rawFileName.length === 0) {
        throw new HttpError(400, 'Missing x-file-name header');
      }

      if (!stream) {
        throw new HttpError(400, 'Missing subtitle upload body');
      }

      const result = await dependencies.mediaService.importSubtitleForMedia({
        mediaId: request.params.id,
        fileName: decodeUploadFileName(rawFileName),
        stream,
        language: typeof rawLanguage === 'string' ? rawLanguage : null,
        label: typeof rawLabel === 'string' ? rawLabel : null,
        isDefault: rawIsDefault === 'true'
      });

      return reply.status(201).send(result);
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
    const result = dependencies.mediaService.requestProcessing(
      request.params.id
    );

    return reply.status(202).send(result);
  });

  app.delete<{
    Params: {
      id: string;
    };
  }>('/api/media/:id', async (request, reply) => {
    dependencies.mediaService.ensureMediaCanBeDeleted(request.params.id);
    dependencies.roomService.closeAllRooms();
    dependencies.mediaService.deleteMedia(request.params.id);

    return reply.status(204).send();
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
