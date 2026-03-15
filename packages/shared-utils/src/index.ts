export function getApiBaseUrl(explicitUrl?: string): string {
  if (explicitUrl && explicitUrl.length > 0) {
    return explicitUrl;
  }

  return 'http://localhost:3000';
}

export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(value));
}
