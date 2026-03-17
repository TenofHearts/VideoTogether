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

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function getApiBaseUrl(explicitUrl?: string): string {
  if (explicitUrl && explicitUrl.length > 0) {
    try {
      const parsedUrl = new URL(explicitUrl);

      if (
        typeof window !== 'undefined'
        && window.location.protocol.startsWith('http')
        && !isLoopbackHostname(window.location.hostname)
        && isLoopbackHostname(parsedUrl.hostname)
      ) {
        parsedUrl.hostname = window.location.hostname;
        return stripTrailingSlash(parsedUrl.toString());
      }
    } catch {
      return stripTrailingSlash(explicitUrl);
    }

    return stripTrailingSlash(explicitUrl);
  }

  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }

  return 'http://localhost:3000';
}

export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(value));
}

export function buildUrlFromBase(baseUrl: string, relativePath: string): string {
  const normalizedBase = new URL(baseUrl);
  const normalizedPath = normalizedBase.pathname.endsWith('/')
    ? normalizedBase.pathname
    : `${normalizedBase.pathname}/`;
  const sanitizedRelativePath = relativePath.replace(/^\/+/, '');

  normalizedBase.pathname = `${normalizedPath}${sanitizedRelativePath}`;
  normalizedBase.search = '';
  normalizedBase.hash = '';

  return normalizedBase.toString();
}

export function buildRoomUrl(baseUrl: string, token: string): string {
  return buildUrlFromBase(baseUrl, `room/${token}`);
}


