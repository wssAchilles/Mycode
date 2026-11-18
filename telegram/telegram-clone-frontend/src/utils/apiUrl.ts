const DEFAULT_PRODUCTION_BACKEND_ORIGIN = 'https://api.xuziqi.tech';
const DEFAULT_DEVELOPMENT_BACKEND_ORIGIN = 'http://localhost:5000';

export const DEFAULT_BACKEND_ORIGIN =
  import.meta.env.VITE_DEFAULT_BACKEND_ORIGIN
  || (import.meta.env.PROD ? DEFAULT_PRODUCTION_BACKEND_ORIGIN : DEFAULT_DEVELOPMENT_BACKEND_ORIGIN);
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN;
export const SOCKET_URL: string = import.meta.env.VITE_SOCKET_URL || API_BASE_URL;

export const withApiBase = (url?: string | null): string | null => {
    if (!url) return url || null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

// 仅对归属后端 API 源且跨源的媒体地址启用 anonymous CORS，避免误伤未开启 CORS 的外部对象存储（如 GCS）
export const resolveMediaCrossOrigin = (url?: string | null): 'anonymous' | undefined => {
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) {
        return undefined;
    }
    try {
        const fallbackOrigin = typeof window !== 'undefined'
            ? window.location.origin
            : DEFAULT_PRODUCTION_BACKEND_ORIGIN;
        const apiOrigin = new URL(API_BASE_URL, fallbackOrigin).origin;
        const targetOrigin = new URL(withApiBase(url) || url, apiOrigin).origin;
        if (typeof window !== 'undefined' && targetOrigin === window.location.origin) {
            return undefined;
        }
        return targetOrigin === apiOrigin ? 'anonymous' : undefined;
    } catch {
        return undefined;
    }
};
