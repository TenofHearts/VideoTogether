import { resolve } from 'node:path';

import type { FastifyInstance } from 'fastify';

import type { AppEnv } from '../config/env.js';
import { HttpError } from '../lib/errors.js';
import { resolveSafeChildPath, streamFile } from '../lib/files.js';
import type { MediaService } from '../services/media-service.js';

type StaticRouteDependencies = {
  env: AppEnv;
  mediaService: MediaService;
};

export async function registerStaticRoutes(
  app: FastifyInstance,
  dependencies: StaticRouteDependencies
) {
  app.get<{
    Params: {
      mediaId: string;
      '*': string;
    };
  }>('/media/:mediaId/*', async (request, reply) => {
    const media = dependencies.mediaService.getMediaById(request.params.mediaId);

    if (!media || media.status !== 'ready' || !media.hlsManifestPath) {
      throw new HttpError(404, 'Media not found');
    }

    const assetPath = request.params['*'];
    const mediaDirectory = resolve(
      dependencies.env.storage.hlsDir,
      request.params.mediaId
    );
    const filePath = resolveSafeChildPath(mediaDirectory, assetPath);

    if (!filePath) {
      throw new HttpError(400, 'Invalid media asset path');
    }

    return streamFile(reply, filePath);
  });

  app.get<{
    Params: {
      subtitleId: string;
    };
  }>('/subtitles/:subtitleId.vtt', async (request, reply) => {
    const subtitle = dependencies.mediaService.getSubtitleById(
      request.params.subtitleId
    );

    if (!subtitle) {
      throw new HttpError(404, 'Subtitle not found');
    }

    const filePath =
      subtitle.servedPath ??
      resolve(dependencies.env.storage.subtitleDir, `${subtitle.id}.vtt`);

    return streamFile(reply, filePath);
  });
}
