export function getApiBaseUrl(explicitUrl) {
    if (explicitUrl && explicitUrl.length > 0) {
        return explicitUrl;
    }
    return 'http://localhost:3000';
}
export function formatTimestamp(value) {
    return new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'medium'
    }).format(new Date(value));
}
export function buildUrlFromBase(baseUrl, relativePath) {
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
