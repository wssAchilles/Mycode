const DEFAULT_API_BASE_URL = 'https://telegram-clone-backend-88ez.onrender.com';

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL;

export const withApiBase = (url?: string | null): string | null => {
    if (!url) return url || null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

