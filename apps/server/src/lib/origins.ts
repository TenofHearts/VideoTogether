export function isAllowedBrowserOrigin(origin: string, webOrigin: string): boolean {
  if (origin === webOrigin) {
    return true;
  }

  try {
    const url = new URL(origin);

    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }

    if (url.port !== '5173' && url.port !== '4200') {
      return false;
    }

    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1' ||
      url.hostname.startsWith('192.168.') ||
      url.hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(url.hostname)
    );
  } catch {
    return false;
  }
}
