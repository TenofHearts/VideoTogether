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

import { createReadStream, existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import type { FastifyReply } from 'fastify';

const contentTypes = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.m3u8', 'application/vnd.apple.mpegurl'],
  ['.ts', 'video/mp2t'],
  ['.m4s', 'video/iso.segment'],
  ['.mp4', 'video/mp4'],
  ['.vtt', 'text/vtt; charset=utf-8']
]);

export function getContentType(filePath: string): string {
  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();

  return contentTypes.get(extension) ?? 'application/octet-stream';
}

function getCacheControl(filePath: string): string {
  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();

  if (extension === '.m3u8' || extension === '.vtt') {
    return 'public, max-age=60, stale-while-revalidate=300';
  }

  if (extension === '.ts' || extension === '.m4s') {
    return 'public, max-age=604800, immutable';
  }

  if (
    extension === '.js' ||
    extension === '.css' ||
    extension === '.svg' ||
    extension === '.png' ||
    extension === '.jpg' ||
    extension === '.jpeg' ||
    extension === '.ico'
  ) {
    return 'public, max-age=604800, immutable';
  }

  return 'public, max-age=3600';
}

export function resolveSafeChildPath(
  baseDirectory: string,
  requestedPath: string
): string | null {
  const sanitizedSegments = requestedPath
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');

  if (sanitizedSegments.some((segment) => segment === '..')) {
    return null;
  }

  const resolvedPath = resolve(baseDirectory, ...sanitizedSegments);
  const relativePath = relative(baseDirectory, resolvedPath);

  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return null;
  }

  return resolvedPath;
}

export async function streamFile(reply: FastifyReply, filePath: string) {
  if (!existsSync(filePath)) {
    return reply.status(404).send({
      message: 'Asset not found'
    });
  }

  const fileStats = statSync(filePath);

  if (!fileStats.isFile()) {
    return reply.status(404).send({
      message: 'Asset not found'
    });
  }
  reply.header('Cache-Control', getCacheControl(filePath));
  reply.header('Content-Length', String(fileStats.size));
  reply.type(getContentType(filePath));

  return reply.send(createReadStream(filePath));
}
