export const DEFAULT_BACKEND_ORIGIN = 'https://telegram-clone-backend-88ez.onrender.com';
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN;
export const SOCKET_URL: string = import.meta.env.VITE_SOCKET_URL || API_BASE_URL;

export const withApiBase = (url?: string | null): string | null => {
    if (!url) return url || null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};
