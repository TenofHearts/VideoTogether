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

function getNormalizedPort(url: URL): string {
  if (url.port.length > 0) {
    return url.port;
  }

  return url.protocol === 'https:' ? '443' : '80';
}

function isPrivateBrowserHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

export function isAllowedBrowserOrigin(origin: string, webOrigin: string): boolean {
  if (origin === webOrigin) {
    return true;
  }

  try {
    const candidateOrigin = new URL(origin);
    const configuredWebOrigin = new URL(webOrigin);

    if (!['http:', 'https:'].includes(candidateOrigin.protocol)) {
      return false;
    }

    if (!['http:', 'https:'].includes(configuredWebOrigin.protocol)) {
      return false;
    }

    if (candidateOrigin.protocol !== configuredWebOrigin.protocol) {
      return false;
    }

    if (getNormalizedPort(candidateOrigin) !== getNormalizedPort(configuredWebOrigin)) {
      return false;
    }

    if (candidateOrigin.hostname === configuredWebOrigin.hostname) {
      return true;
    }

    return (
      isPrivateBrowserHostname(candidateOrigin.hostname)
      && isPrivateBrowserHostname(configuredWebOrigin.hostname)
    );
  } catch {
    return false;
  }
}

