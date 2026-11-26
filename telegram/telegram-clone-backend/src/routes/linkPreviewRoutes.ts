import { createHash } from 'node:crypto';
import { promises as dnsPromises } from 'node:dns';
import { isIP } from 'node:net';
import express, { type Request, type Response } from 'express';
import { redis } from '../config/redis';
import { catchAsync } from '../middleware/errorHandler';
import { errors, sendSuccess } from '../utils/apiResponse';

const router = express.Router();

const LINK_PREVIEW_TIMEOUT_MS = 3000;
const LINK_PREVIEW_MAX_BYTES = 256 * 1024;
const LINK_PREVIEW_MAX_REDIRECTS = 2;
const LINK_PREVIEW_CACHE_TTL_SEC = 600;
const LINK_PREVIEW_EMPTY_CACHE_TTL_SEC = 120;

export interface LinkPreviewMetadata {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  hostname: string;
}

function isPrivateIpv4Tuple(octets: number[]): boolean {
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = octets;
  // 0.0.0.0/8 (本网络/未指定)
  if (a === 0) return true;
  // 10.0.0.0/8 (私网)
  if (a === 10) return true;
  // 100.64.0.0/10 (CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 (回环)
  if (a === 127) return true;
  // 169.254.0.0/16 (链路本地 / 云元数据服务)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (私网)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24 与 192.0.2.0/24 (保留)
  if (a === 192 && b === 0) return true;
  // 192.168.0.0/16 (私网)
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 (基准测试)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 224.0.0.0+ (组播及保留地址)
  if (a >= 224) return true;
  return false;
}

/**
 * 校验 IP 地址是否属于回环、内网、链路本地或保留网段，防止 SSRF 探测内部服务
 */
export function isPrivateOrReservedIp(rawIp: string): boolean {
  const normalized = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return isPrivateIpv4Tuple(normalized.split('.').map(Number));
  }
  if (ipVersion === 6) {
    // 回环 ::1、未指定 ::
    if (normalized === '::1' || normalized === '::' || /^0(:0)*$/.test(normalized)) {
      return true;
    }
    // IPv4 映射地址 ::ffff:a.b.c.d 或 ::ffff:xx:yy
    if (normalized.startsWith('::ffff:')) {
      const rest = normalized.slice('::ffff:'.length);
      if (isIP(rest) === 4) {
        return isPrivateIpv4Tuple(rest.split('.').map(Number));
      }
      const hexParts = rest.split(':');
      if (hexParts.length === 2) {
        const hi = parseInt(hexParts[0], 16);
        const lo = parseInt(hexParts[1], 16);
        if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
          return isPrivateIpv4Tuple([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]);
        }
      }
    }
    // 唯一本地地址 fc00::/7 (fc.. 或 fd..) 与链路本地 fe80::/10 (fe80..febf) 与组播 ff00::/8
    const firstHextetMatch = normalized.match(/^([0-9a-f]{1,4}):/);
    if (firstHextetMatch) {
      const firstWord = parseInt(firstHextetMatch[1], 16);
      if ((firstWord & 0xfe00) === 0xfc00) return true;
      if ((firstWord & 0xffc0) === 0xfe80) return true;
      if ((firstWord & 0xff00) === 0xff00) return true;
      if ((firstWord & 0xffc0) === 0xfec0) return true;
    }
    return false;
  }
  return true;
}

/**
 * 校验目标 URL 合法性并拦截明显内网主机与高危协议
 */
export function validatePreviewTargetUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('无效的链接地址');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('仅支持 http 或 https 链接预览');
  }
  if (parsed.username || parsed.password) {
    throw new Error('链接不允许携带认证凭据');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) {
    throw new Error('无效的主机名');
  }

  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host === 'metadata.google.internal'
  ) {
    throw new Error('不允许请求内网或本地保留域名');
  }

  if (isIP(host) !== 0 && isPrivateOrReservedIp(host)) {
    throw new Error('不允许请求私网或保留 IP 地址');
  }

  return parsed;
}

async function ensureHostResolvesToPublicIp(hostname: string): Promise<void> {
  const bareHost = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bareHost) !== 0) {
    if (isPrivateOrReservedIp(bareHost)) {
      throw new Error('目标 IP 属于非公开网段');
    }
    return;
  }

  const records = await dnsPromises.lookup(bareHost, { all: true });
  if (!records || records.length === 0) {
    throw new Error('目标域名无法解析');
  }
  for (const record of records) {
    if (isPrivateOrReservedIp(record.address)) {
      throw new Error('目标域名解析到了内网或保留地址');
    }
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    });
}

function normalizeText(value: string | undefined, maxLen: number): string | undefined {
  if (!value) return undefined;
  const cleaned = decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

function extractMetaContent(html: string, keys: string[]): string | undefined {
  const metaTagRegex = /<meta\b[^>]*>/gi;
  const tags = html.match(metaTagRegex) || [];
  const extractedByKey = new Map<string, string>();

  for (const tag of tags) {
    const attrNameMatch = tag.match(/\b(?:property|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const attrKey = (attrNameMatch?.[1] || attrNameMatch?.[2] || attrNameMatch?.[3] || '').trim().toLowerCase();
    if (!attrKey || extractedByKey.has(attrKey)) continue;

    const contentMatch = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawContent = contentMatch?.[1] ?? contentMatch?.[2] ?? contentMatch?.[3];
    if (rawContent && rawContent.trim()) {
      extractedByKey.set(attrKey, rawContent.trim());
    }
  }

  for (const key of keys) {
    const matched = extractedByKey.get(key.toLowerCase());
    if (matched) return matched;
  }
  return undefined;
}

/**
 * 从 HTML 片段提取安全的 OpenGraph 元数据
 */
export function parseOpenGraphMetadata(html: string, baseUrl: string): LinkPreviewMetadata {
  const parsedBase = new URL(baseUrl);

  const rawTitle =
    extractMetaContent(html, ['og:title', 'twitter:title'])
    || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const rawDescription = extractMetaContent(html, ['og:description', 'twitter:description', 'description']);
  const rawImage = extractMetaContent(html, ['og:image', 'og:image:secure_url', 'twitter:image']);
  const rawSiteName = extractMetaContent(html, ['og:site_name', 'application-name']);

  let resolvedImage: string | undefined;
  if (rawImage) {
    try {
      const imgUrl = new URL(decodeHtmlEntities(rawImage), parsedBase);
      if (imgUrl.protocol === 'http:' || imgUrl.protocol === 'https:') {
        validatePreviewTargetUrl(imgUrl.toString());
        resolvedImage = imgUrl.toString();
      }
    } catch {
      resolvedImage = undefined;
    }
  }

  return {
    url: parsedBase.toString(),
    title: normalizeText(rawTitle, 160),
    description: normalizeText(rawDescription, 260),
    image: resolvedImage,
    siteName: normalizeText(rawSiteName, 64) || parsedBase.hostname,
    hostname: parsedBase.hostname,
  };
}

async function readLimitedHtml(response: globalThis.Response): Promise<string> {
  if (!response.body) {
    return (await response.text()).slice(0, LINK_PREVIEW_MAX_BYTES);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < LINK_PREVIEW_MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const remaining = LINK_PREVIEW_MAX_BYTES - total;
      const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(slice);
      total += slice.byteLength;
      if (total >= LINK_PREVIEW_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return merged.toString('utf8');
}

async function fetchSafeLinkPreview(initialUrl: URL): Promise<LinkPreviewMetadata> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= LINK_PREVIEW_MAX_REDIRECTS; hop += 1) {
    await ensureHostResolvesToPublicIp(currentUrl.hostname);

    const response = await fetch(currentUrl.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(LINK_PREVIEW_TIMEOUT_MS),
      headers: {
        'User-Agent': 'TelegramCloneLinkPreview/1.0 (+https://telegram.clone)',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || hop === LINK_PREVIEW_MAX_REDIRECTS) {
        break;
      }
      currentUrl = validatePreviewTargetUrl(new URL(location, currentUrl).toString());
      continue;
    }

    if (!response.ok) {
      return {
        url: currentUrl.toString(),
        hostname: currentUrl.hostname,
        siteName: currentUrl.hostname,
      };
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return {
        url: currentUrl.toString(),
        hostname: currentUrl.hostname,
        siteName: currentUrl.hostname,
      };
    }

    const html = await readLimitedHtml(response);
    return parseOpenGraphMetadata(html, currentUrl.toString());
  }

  return {
    url: currentUrl.toString(),
    hostname: currentUrl.hostname,
    siteName: currentUrl.hostname,
  };
}

router.get('/', catchAsync(async (req: Request, res: Response) => {
  const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!rawUrl || rawUrl.length > 2048) {
    return errors.badRequest(res, '请提供有效的预览链接');
  }

  let validatedUrl: URL;
  try {
    validatedUrl = validatePreviewTargetUrl(rawUrl);
  } catch (err: unknown) {
    return errors.badRequest(res, err instanceof Error ? err.message : '链接不合法');
  }

  const cacheKey = `link_preview:v1:${createHash('sha256').update(validatedUrl.toString()).digest('hex')}`;
  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return sendSuccess(res, JSON.parse(cached) as LinkPreviewMetadata);
      }
    } catch {
      // Redis 异常时降级直查
    }
  }

  try {
    const metadata = await fetchSafeLinkPreview(validatedUrl);
    if (redis.status === 'ready') {
      const ttl = metadata.title || metadata.description
        ? LINK_PREVIEW_CACHE_TTL_SEC
        : LINK_PREVIEW_EMPTY_CACHE_TTL_SEC;
      await redis.set(cacheKey, JSON.stringify(metadata), 'EX', ttl).catch(() => undefined);
    }
    return sendSuccess(res, metadata);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('内网') || msg.includes('非公开') || msg.includes('保留') || msg.includes('私网')) {
      return errors.badRequest(res, msg);
    }
    return sendSuccess(res, {
      url: validatedUrl.toString(),
      hostname: validatedUrl.hostname,
      siteName: validatedUrl.hostname,
    });
  }
}));

export default router;
