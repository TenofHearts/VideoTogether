export function getApiBaseUrl(explicitUrl?: string): string {
  if (explicitUrl && explicitUrl.length > 0) {
    return explicitUrl;
  }

  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return window.location.protocol + '//' + window.location.hostname + ':3000';
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
