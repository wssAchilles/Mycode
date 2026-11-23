import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createChildLogger } from '../../utils/logger';

const log = createChildLogger('services:media:avatarMediaOptimizer');

export const AVATAR_WIDTH_BUCKETS = [64, 96, 128, 256] as const;
export type AvatarWidthBucket = (typeof AVATAR_WIDTH_BUCKETS)[number];

const PUBLIC_ASSET_ALLOW_TTL_MS = 10 * 60 * 1000;
const PUBLIC_ASSET_ALLOW_MAX_ENTRIES = 5000;
const AVATAR_VARIANT_MEMORY_MAX_BYTES = 32 * 1024 * 1024;
const AVATAR_VARIANT_SINGLE_ENTRY_MAX_BYTES = 512 * 1024;
const LEGACY_GCS_FETCH_MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_LEGACY_GCS_PUBLIC_BASE =
  'https://storage.googleapis.com/telegram-467705-space-uploads/space/uploads';

interface CachedVariantEntry {
  buffer: Buffer;
  contentType: 'image/webp';
  bytes: number;
}

export interface AvatarVariantResult {
  buffer: Buffer;
  contentType: 'image/webp';
  source: 'memory' | 'disk' | 'generated';
}

// 资产白名单 TTL 内存缓存（仅缓存合法存在的资源文件名）
const publicAssetAllowCache = new Map<string, number>();

// 缩放后的 WebP 头像字节级内存 LRU 缓存
const variantMemoryCache = new Map<string, CachedVariantEntry>();
let variantMemoryBytes = 0;

// 进程内并发合并锁：防止同一头像被多消息气泡/并发请求重复转码
const inFlightVariants = new Map<string, Promise<AvatarVariantResult | null>>();

/**
 * 将请求宽度参数归并到受控白名单档位，杜绝任意像素裁剪与缓存碎片化
 */
export function parseAvatarWidthParam(raw?: unknown): AvatarWidthBucket | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(num) || num <= 0 || num > 2048) {
    return null;
  }
  for (const bucket of AVATAR_WIDTH_BUCKETS) {
    if (num <= bucket) {
      return bucket;
    }
  }
  return 256;
}

/**
 * 查询资产文件名是否在 TTL 白名单缓存中
 */
export function getCachedPublicAssetAllowed(filename: string): boolean {
  const expiresAt = publicAssetAllowCache.get(filename);
  if (!expiresAt) {
    return false;
  }
  if (expiresAt <= Date.now()) {
    publicAssetAllowCache.delete(filename);
    return false;
  }
  // 刷新 LRU 热度顺序
  publicAssetAllowCache.delete(filename);
  publicAssetAllowCache.set(filename, expiresAt);
  return true;
}

/**
 * 将校验通过的公共资产文件名写入 TTL 白名单缓存
 */
export function setCachedPublicAssetAllowed(filename: string): void {
  if (!filename) return;
  if (publicAssetAllowCache.has(filename)) {
    publicAssetAllowCache.delete(filename);
  } else if (publicAssetAllowCache.size >= PUBLIC_ASSET_ALLOW_MAX_ENTRIES) {
    const oldestKey = publicAssetAllowCache.keys().next().value;
    if (oldestKey) {
      publicAssetAllowCache.delete(oldestKey);
    }
  }
  publicAssetAllowCache.set(filename, Date.now() + PUBLIC_ASSET_ALLOW_TTL_MS);
}

function getVariantFromMemory(cacheKey: string): CachedVariantEntry | null {
  const entry = variantMemoryCache.get(cacheKey);
  if (!entry) return null;
  variantMemoryCache.delete(cacheKey);
  variantMemoryCache.set(cacheKey, entry);
  return entry;
}

function putVariantInMemory(cacheKey: string, buffer: Buffer): void {
  if (!buffer.length || buffer.length > AVATAR_VARIANT_SINGLE_ENTRY_MAX_BYTES) {
    return;
  }
  const existing = variantMemoryCache.get(cacheKey);
  if (existing) {
    variantMemoryBytes -= existing.bytes;
    variantMemoryCache.delete(cacheKey);
  }
  while (
    variantMemoryCache.size > 0 &&
    variantMemoryBytes + buffer.length > AVATAR_VARIANT_MEMORY_MAX_BYTES
  ) {
    const oldestKey = variantMemoryCache.keys().next().value;
    if (!oldestKey) break;
    const evicted = variantMemoryCache.get(oldestKey);
    variantMemoryCache.delete(oldestKey);
    if (evicted) {
      variantMemoryBytes -= evicted.bytes;
    }
  }
  variantMemoryCache.set(cacheKey, {
    buffer,
    contentType: 'image/webp',
    bytes: buffer.length,
  });
  variantMemoryBytes += buffer.length;
}

function sanitizeFilenameForDisk(filename: string): string {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * 获取或按需生成指定宽度档位的 WebP 头像缩略图（内存 LRU -> 并发合并 -> 磁盘缓存 -> 回源转码）
 */
export async function getOrCreateAvatarVariant(params: {
  filename: string;
  width: AvatarWidthBucket;
  cacheDir: string;
  loadSourceBuffer: () => Promise<Buffer | null>;
}): Promise<AvatarVariantResult | null> {
  const safeName = sanitizeFilenameForDisk(params.filename);
  const cacheKey = `${safeName}:w${params.width}`;

  // 1. 优先命中内存 LRU（微秒级响应）
  const memHit = getVariantFromMemory(cacheKey);
  if (memHit) {
    return {
      buffer: memHit.buffer,
      contentType: memHit.contentType,
      source: 'memory',
    };
  }

  // 2. 合并同一头像+尺寸的并发回源请求
  const inFlight = inFlightVariants.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async (): Promise<AvatarVariantResult | null> => {
    const variantPath = path.join(params.cacheDir, `${safeName}_w${params.width}.webp`);

    // 3. 查询本地磁盘变体缓存
    try {
      const diskBuf = await fs.promises.readFile(variantPath);
      if (diskBuf.length > 0) {
        putVariantInMemory(cacheKey, diskBuf);
        return {
          buffer: diskBuf,
          contentType: 'image/webp',
          source: 'disk',
        };
      }
    } catch {
      // 磁盘未命中属正常路径，继续回源
    }

    // 4. 拉取原图并按需裁剪为目标宽度 WebP
    const sourceBuffer = await params.loadSourceBuffer();
    if (!sourceBuffer || !sourceBuffer.length) {
      return null;
    }

    let webpBuffer: Buffer;
    try {
      webpBuffer = await sharp(sourceBuffer)
        .rotate()
        .resize(params.width, params.width, {
          fit: 'cover',
          position: 'centre',
          withoutEnlargement: true,
        })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();
    } catch (err) {
      log.warn({ err, filename: safeName, width: params.width }, '⚠️ sharp 头像变体转码失败');
      return null;
    }

    putVariantInMemory(cacheKey, webpBuffer);

    // 异步持久化到磁盘缓存，不阻塞当前响应返回
    fs.promises
      .mkdir(params.cacheDir, { recursive: true })
      .then(() => fs.promises.writeFile(variantPath, webpBuffer))
      .catch((writeErr) => {
        log.warn({ err: writeErr, variantPath }, '⚠️ 头像变体写入磁盘缓存失败');
      });

    return {
      buffer: webpBuffer,
      contentType: 'image/webp',
      source: 'generated',
    };
  })().finally(() => {
    inFlightVariants.delete(cacheKey);
  });

  inFlightVariants.set(cacheKey, task);
  return task;
}

/**
 * 受控白名单历史 GCS 公开资源回源：仅允许安全单段文件名拼接至白名单桶基址
 */
export async function fetchLegacyPublicGcsObject(filename: string): Promise<Buffer | null> {
  const safeName = path.basename(filename);
  if (
    !safeName ||
    safeName !== filename ||
    safeName.includes('..') ||
    safeName.includes('/') ||
    safeName.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(safeName)
  ) {
    return null;
  }

  const baseRaw =
    process.env.SPACE_S3_PUBLIC_BASE_URL ||
    process.env.SPACE_LEGACY_PUBLIC_UPSTREAM_BASE ||
    DEFAULT_LEGACY_GCS_PUBLIC_BASE;
  const base = baseRaw.replace(/\/+$/, '');

  let targetUrl: URL;
  try {
    targetUrl = new URL(`${base}/${encodeURIComponent(safeName)}`);
    if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const response = await fetch(targetUrl, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return null;
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      return null;
    }
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > LEGACY_GCS_FETCH_MAX_BYTES) {
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    if (!arrayBuffer.byteLength || arrayBuffer.byteLength > LEGACY_GCS_FETCH_MAX_BYTES) {
      return null;
    }
    return Buffer.from(arrayBuffer);
  } catch (err) {
    log.warn({ err, filename: safeName }, '⚠️ 回源拉取历史公开头像失败');
    return null;
  }
}

/**
 * 头像上传服务端防巨图规范化：非 GIF/SVG 大图或超 512px 图片自动转为 <= 512px WebP
 */
export async function normalizeUploadedAvatarFile(
  file: Express.Multer.File,
): Promise<Express.Multer.File> {
  if (
    !file?.path ||
    !file.mimetype?.startsWith('image/') ||
    file.mimetype === 'image/gif' ||
    file.mimetype === 'image/svg+xml'
  ) {
    return file;
  }

  try {
    const meta = await sharp(file.path).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const withinDimensions = width > 0 && height > 0 && width <= 512 && height <= 512;

    if (withinDimensions && file.size <= 120 * 1024 && file.mimetype === 'image/webp') {
      return file;
    }

    const webpBuffer = await sharp(file.path)
      .rotate()
      .resize(512, 512, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 84, effort: 4 })
      .toBuffer();

    const shouldReplace = !withinDimensions || webpBuffer.length < file.size;
    if (!shouldReplace) {
      return file;
    }

    const parsed = path.parse(file.filename || path.basename(file.path));
    const nextFilename = `${parsed.name}.webp`;
    const nextPath = path.join(path.dirname(file.path), nextFilename);
    await fs.promises.writeFile(nextPath, webpBuffer);

    if (nextPath !== file.path) {
      fs.promises.unlink(file.path).catch(() => undefined);
    }

    const origParsed = path.parse(file.originalname || nextFilename);
    return {
      ...file,
      filename: nextFilename,
      path: nextPath,
      originalname: `${origParsed.name || 'avatar'}.webp`,
      mimetype: 'image/webp',
      size: webpBuffer.length,
    };
  } catch (err) {
    log.warn({ err, filename: file.filename }, '⚠️ 上传头像规范化失败，保留原始文件');
    return file;
  }
}

/**
 * 仅供单元测试重置进程内缓存状态使用
 */
export function __resetAvatarMediaCachesForTest(): void {
  publicAssetAllowCache.clear();
  variantMemoryCache.clear();
  variantMemoryBytes = 0;
  inFlightVariants.clear();
}
