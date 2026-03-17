import { createReadStream, existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import type { FastifyReply } from 'fastify';

const contentTypes = new Map<string, string>([
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

