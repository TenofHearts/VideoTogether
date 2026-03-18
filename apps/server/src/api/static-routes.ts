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

import { existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

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
    const media = dependencies.mediaService.getMediaById(
      request.params.mediaId
    );

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

  if (dependencies.env.nodeEnv !== 'production') {
    app.log.info('Frontend fallback disabled outside production mode');
    return;
  }

  const webIndexPath = resolve(dependencies.env.web.distDir, 'index.html');

  if (!existsSync(webIndexPath)) {
    app.log.info(
      { webDistDir: dependencies.env.web.distDir },
      'Production web assets not found; frontend fallback disabled'
    );
    return;
  }

  const reservedPrefixes = [
    '/api',
    '/media',
    '/subtitles',
    '/health',
    dependencies.env.realtime.path
  ];

  app.log.info(
    { webDistDir: dependencies.env.web.distDir },
    'Production web assets enabled'
  );

  app.get('/', async (_request, reply) => streamFile(reply, webIndexPath));

  app.get<{
    Params: {
      '*': string;
    };
  }>('/*', async (request, reply) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const normalizedPath =
      pathname.endsWith('/') && pathname.length > 1
        ? pathname.slice(0, -1)
        : pathname;

    if (
      reservedPrefixes.some(
        (prefix) =>
          normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
      )
    ) {
      return reply.status(404).send({
        message: 'Route not found'
      });
    }

    const assetPath = normalizedPath.replace(/^\/+/, '');

    if (assetPath.length > 0) {
      const filePath = resolveSafeChildPath(
        dependencies.env.web.distDir,
        assetPath
      );

      if (filePath && existsSync(filePath) && statSync(filePath).isFile()) {
        return streamFile(reply, filePath);
      }

      if (extname(assetPath).length > 0) {
        return reply.status(404).send({
          message: 'Asset not found'
        });
      }
    }

    return streamFile(reply, webIndexPath);
  });
}
