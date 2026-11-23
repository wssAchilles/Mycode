import { API_BASE_URL, resolveMediaCrossOrigin, withApiBase } from '../apiUrl';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;

export const AVATAR_SIZE_PRESET_PX: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', number> = {
    xs: 24,
    sm: 32,
    md: 42,
    lg: 54,
    xl: 80,
};

export const LEGACY_GCS_SPACE_UPLOAD_PREFIX =
    'https://storage.googleapis.com/telegram-467705-space-uploads/space/uploads/';

const PUBLIC_SPACE_UPLOAD_PREFIX = '/api/public/space/uploads/';
const MAX_LOADED_AVATAR_CACHE = 1000;
const PRELOAD_CONCURRENCY = 6;

const loadedAvatarUrls = new Set<string>();
const inFlightPreloads = new Map<string, Promise<void>>();
const preloadQueue: string[] = [];
let activePreloads = 0;

export function getAvatarPixelSize(size: AvatarSize = 'md'): number {
    if (typeof size === 'number' && Number.isFinite(size) && size > 0) {
        return size;
    }
    return AVATAR_SIZE_PRESET_PX[typeof size === 'string' ? size : 'md'] ?? AVATAR_SIZE_PRESET_PX.md;
}

/**
 * 统一归并头像所需物理像素档位：
 * - <= 64px（24/32/42/54px 列表、气泡、顶栏、选人面板）全站共享 ?w=128，在 2x 屏下仍锐利
 * - > 64px（80/88px 大图预览）统一使用 ?w=256
 */
export function resolveAvatarWidthBucket(size: AvatarSize = 'md'): 128 | 256 {
    return getAvatarPixelSize(size) <= 64 ? 128 : 256;
}

function extractPublicUploadFilename(rawUrl: string): string | null {
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith(LEGACY_GCS_SPACE_UPLOAD_PREFIX)) {
        const rest = trimmed.slice(LEGACY_GCS_SPACE_UPLOAD_PREFIX.length).split(/[?#]/)[0];
        if (!rest || rest.includes('/') || rest.includes('..')) {
            return null;
        }
        return rest;
    }

    if (trimmed.startsWith(PUBLIC_SPACE_UPLOAD_PREFIX)) {
        const rest = trimmed.slice(PUBLIC_SPACE_UPLOAD_PREFIX.length).split(/[?#]/)[0];
        if (!rest || rest.includes('/') || rest.includes('..')) {
            return null;
        }
        return rest;
    }

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        try {
            const parsed = new URL(trimmed);
            const apiOrigin = new URL(API_BASE_URL).origin;
            if (parsed.origin === apiOrigin && parsed.pathname.startsWith(PUBLIC_SPACE_UPLOAD_PREFIX)) {
                const rest = parsed.pathname.slice(PUBLIC_SPACE_UPLOAD_PREFIX.length);
                if (!rest || rest.includes('/') || rest.includes('..')) {
                    return null;
                }
                return rest;
            }
        } catch {
            return null;
        }
    }

    return null;
}

/**
 * 解析并规范化头像加载 URL，自动接入后端按需 WebP 缩放与多级缓存端点
 */
export function resolveAvatarUrl(rawUrl?: string | null, size: AvatarSize = 'md'): string | undefined {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return undefined;
    }
    const trimmed = rawUrl.trim();
    if (!trimmed) {
        return undefined;
    }
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
        return trimmed;
    }

    const publicFilename = extractPublicUploadFilename(trimmed);
    if (publicFilename) {
        const bucket = resolveAvatarWidthBucket(size);
        return `${API_BASE_URL}${PUBLIC_SPACE_UPLOAD_PREFIX}${encodeURIComponent(publicFilename)}?w=${bucket}`;
    }

    return withApiBase(trimmed) ?? undefined;
}

export function isAvatarUrlLoaded(url?: string): boolean {
    return Boolean(url && loadedAvatarUrls.has(url));
}

export function markAvatarUrlLoaded(url?: string): void {
    if (!url) return;
    if (loadedAvatarUrls.has(url)) {
        loadedAvatarUrls.delete(url);
    } else if (loadedAvatarUrls.size >= MAX_LOADED_AVATAR_CACHE) {
        const oldest = loadedAvatarUrls.values().next().value;
        if (oldest) {
            loadedAvatarUrls.delete(oldest);
        }
    }
    loadedAvatarUrls.add(url);
}

function pumpPreloadQueue(): void {
    if (typeof Image === 'undefined') {
        preloadQueue.length = 0;
        return;
    }

    while (activePreloads < PRELOAD_CONCURRENCY && preloadQueue.length > 0) {
        const url = preloadQueue.shift();
        if (!url || isAvatarUrlLoaded(url) || inFlightPreloads.has(url)) {
            continue;
        }

        activePreloads += 1;
        const promise = new Promise<void>((resolve) => {
            const img = new Image();
            const cors = resolveMediaCrossOrigin(url);
            if (cors) {
                img.crossOrigin = cors;
            }
            img.decoding = 'async';

            const finish = () => {
                resolve();
            };

            img.onload = () => {
                if (typeof img.decode === 'function') {
                    img.decode().catch(() => undefined).finally(() => {
                        markAvatarUrlLoaded(url);
                        finish();
                    });
                } else {
                    markAvatarUrlLoaded(url);
                    finish();
                }
            };
            img.onerror = finish;
            img.src = url;
        }).finally(() => {
            inFlightPreloads.delete(url);
            activePreloads = Math.max(0, activePreloads - 1);
            pumpPreloadQueue();
        });

        inFlightPreloads.set(url, promise);
    }
}

/**
 * 后台温和预热头像列表，使好友列表、群成员列表、消息气泡和新建弹窗共享预解码缓存
 */
export function preloadAvatarUrls(
    urls: Array<string | null | undefined>,
    size: AvatarSize = 'md',
): void {
    if (typeof window === 'undefined' || typeof Image === 'undefined') {
        return;
    }

    let enqueued = false;
    for (const raw of urls) {
        const resolved = resolveAvatarUrl(raw, size);
        if (!resolved || resolved.startsWith('data:') || resolved.startsWith('blob:')) {
            continue;
        }
        if (isAvatarUrlLoaded(resolved) || inFlightPreloads.has(resolved) || preloadQueue.includes(resolved)) {
            continue;
        }
        preloadQueue.push(resolved);
        enqueued = true;
    }

    if (enqueued) {
        pumpPreloadQueue();
    }
}

export function __resetAvatarClientCachesForTest(): void {
    loadedAvatarUrls.clear();
    inFlightPreloads.clear();
    preloadQueue.length = 0;
    activePreloads = 0;
}
