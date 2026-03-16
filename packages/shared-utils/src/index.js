function isLoopbackHostname(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}
export function getApiBaseUrl(explicitUrl) {
    if (explicitUrl && explicitUrl.length > 0) {
        try {
            const parsedUrl = new globalThis.URL(explicitUrl);
            if (typeof globalThis.window !== 'undefined'
                && globalThis.window.location.protocol.startsWith('http')
                && !isLoopbackHostname(globalThis.window.location.hostname)
                && isLoopbackHostname(parsedUrl.hostname)) {
                parsedUrl.hostname = globalThis.window.location.hostname;
                return parsedUrl.toString();
            }
        }
        catch {
            return explicitUrl;
        }
        return explicitUrl;
    }
    if (typeof globalThis.window !== 'undefined' && globalThis.window.location.protocol.startsWith('http')) {
        return `${globalThis.window.location.protocol}//${globalThis.window.location.hostname}:3000`;
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
    const normalizedBase = new globalThis.URL(baseUrl);
    const normalizedPath = normalizedBase.pathname.endsWith('/')
        ? normalizedBase.pathname
        : `${normalizedBase.pathname}/`;
    const sanitizedRelativePath = relativePath.replace(/^\/+/, '');
    normalizedBase.pathname = `${normalizedPath}${sanitizedRelativePath}`;
    normalizedBase.search = '';
    normalizedBase.hash = '';
    return normalizedBase.toString();
}
export function buildRoomUrl(baseUrl, token) {
    return buildUrlFromBase(baseUrl, `room/${token}`);
}

