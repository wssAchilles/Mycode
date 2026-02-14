import { withApiBase } from './apiUrl';

const normalizeSpaceMediaPath = (pathValue: string) => {
    // Older payloads used /api/uploads/* (non-space). Normalize to the public Space media route.
    if (pathValue.startsWith('/api/uploads/thumbnails/')) {
        const filename = pathValue.replace('/api/uploads/thumbnails/', '').replace(/^\/+/, '');
        return `/api/public/space/uploads/thumbnails/${filename}`;
    }
    if (pathValue.startsWith('/api/uploads/')) {
        const filename = pathValue.replace('/api/uploads/', '').replace(/^\/+/, '');
        return `/api/public/space/uploads/${filename}`;
    }
    return pathValue;
};

export const normalizeSpaceMediaUrl = (value?: string | null): string | null => {
    if (!value) return value || null;

    if (value.startsWith('http://') || value.startsWith('https://')) {
        try {
            const parsed = new URL(value);
            const normalizedPath = normalizeSpaceMediaPath(parsed.pathname);
            // If this is an API-ish path, drop the origin so we can re-base to VITE_API_BASE_URL.
            if (normalizedPath.startsWith('/api/')) {
                return `${normalizedPath}${parsed.search}${parsed.hash}`;
            }
            return `${parsed.origin}${normalizedPath}${parsed.search}${parsed.hash}`;
        } catch {
            return value;
        }
    }

    return normalizeSpaceMediaPath(value);
};

export const resolveSpaceMediaUrl = (value?: string | null): string | null => {
    return withApiBase(normalizeSpaceMediaUrl(value));
};
