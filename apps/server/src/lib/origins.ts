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

