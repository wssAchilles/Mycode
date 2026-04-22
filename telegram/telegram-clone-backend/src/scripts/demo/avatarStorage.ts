import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import axios from 'axios';
import sharp from 'sharp';

import { saveSpaceUpload } from '../../controllers/uploadController';
import { absolutizePublicUrl } from './runtime';

let uploadState: 'pending' | 'available' | 'blocked' = 'pending';

const portraitSourceAt = (index: number): string => {
  const bucket = index % 36;
  const id = bucket + 1;
  const gender = index % 2 === 0 ? 'men' : 'women';
  return `https://randomuser.me/api/portraits/${gender}/${id}.jpg`;
};

const placeholdFallback = (label: string, background: string, foreground: string): string => {
  const text = encodeURIComponent(label);
  return `https://placehold.co/512x512/${background}/${foreground}.png?text=${text}`;
};

const uploadBuffer = async (args: {
  filename: string;
  buffer: Buffer;
  mimetype: string;
  publicApiBaseUrl: string | null;
  fallbackUrl: string;
}): Promise<string> => {
  if (uploadState === 'blocked') {
    return args.fallbackUrl;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-demo-assets-'));
  const filePath = path.join(tempDir, args.filename);

  try {
    await fs.writeFile(filePath, args.buffer);
    const stored = await saveSpaceUpload({
      fieldname: 'avatar',
      originalname: args.filename,
      encoding: '7bit',
      mimetype: args.mimetype,
      size: args.buffer.length,
      destination: tempDir,
      filename: args.filename,
      path: filePath,
      buffer: args.buffer,
      stream: undefined as any,
    } as Express.Multer.File);
    const absolute = absolutizePublicUrl(stored.url, args.publicApiBaseUrl);
    const s3Configured = Boolean(process.env.SPACE_S3_BUCKET || process.env.SPACE_S3_PUBLIC_BASE_URL);
    if (stored.url.startsWith('/') && (!absolute || s3Configured)) {
      uploadState = 'blocked';
      return args.fallbackUrl;
    }
    if (!absolute && !/^https?:\/\//i.test(stored.url)) {
      uploadState = 'blocked';
      return args.fallbackUrl;
    }
    uploadState = 'available';
    return absolute || stored.url || args.fallbackUrl;
  } catch (error) {
    uploadState = 'blocked';
    console.warn(`[demo] upload fallback for ${args.filename}:`, error);
    return args.fallbackUrl;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

const escapeSvgText = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const buildGroupAvatarBuffer = async (label: string, start: string, end: string): Promise<Buffer> => {
  const safeLabel = escapeSvgText(label);
  const svg = `
    <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${start}" />
          <stop offset="100%" stop-color="${end}" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="96" fill="url(#bg)" />
      <circle cx="398" cy="110" r="54" fill="rgba(255,255,255,0.18)" />
      <circle cx="124" cy="404" r="72" fill="rgba(255,255,255,0.1)" />
      <text x="56" y="246" fill="#f8fafc" font-size="68" font-family="Arial, Helvetica, sans-serif" font-weight="700">${safeLabel}</text>
      <text x="56" y="330" fill="#e2e8f0" font-size="28" font-family="Arial, Helvetica, sans-serif">Interview Demo Cohort</text>
    </svg>
  `;
  return sharp(Buffer.from(svg)).png().toBuffer();
};

export const preparePortraitPool = async (
  count: number,
  publicApiBaseUrl: string | null,
): Promise<string[]> => {
  const results: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const sourceUrl = portraitSourceAt(index);
    try {
      const response = await axios.get<ArrayBuffer>(sourceUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
      });
      const buffer = Buffer.from(response.data);
      const uploaded = await uploadBuffer({
        filename: `demo-avatar-${String(index + 1).padStart(3, '0')}.jpg`,
        buffer,
        mimetype: 'image/jpeg',
        publicApiBaseUrl,
        fallbackUrl: sourceUrl,
      });
      results.push(uploaded);
    } catch (error) {
      console.warn(`[demo] portrait download fallback #${index + 1}:`, error);
      results.push(sourceUrl);
    }
  }

  return results;
};

export const prepareGroupAvatarUrls = async (
  publicApiBaseUrl: string | null,
): Promise<Record<'perf_arena' | 'recsys_lab' | 'product_review', string>> => {
  const assets: Array<{
    slug: 'perf_arena' | 'recsys_lab' | 'product_review';
    label: string;
    start: string;
    end: string;
    fallback: string;
  }> = [
    {
      slug: 'perf_arena',
      label: 'Rust & Go',
      start: '#0f766e',
      end: '#155e75',
      fallback: placeholdFallback('Rust+Go', '0f766e', 'f8fafc'),
    },
    {
      slug: 'recsys_lab',
      label: 'Recsys Lab',
      start: '#1d4ed8',
      end: '#4338ca',
      fallback: placeholdFallback('Recsys', '1d4ed8', 'f8fafc'),
    },
    {
      slug: 'product_review',
      label: 'Product',
      start: '#b45309',
      end: '#dc2626',
      fallback: placeholdFallback('Product', 'b45309', 'f8fafc'),
    },
  ];

  const entries = await Promise.all(
    assets.map(async (asset) => {
      const buffer = await buildGroupAvatarBuffer(asset.label, asset.start, asset.end);
      const url = await uploadBuffer({
        filename: `demo-group-${asset.slug}.png`,
        buffer,
        mimetype: 'image/png',
        publicApiBaseUrl,
        fallbackUrl: asset.fallback,
      });
      return [asset.slug, url] as const;
    }),
  );

  return Object.fromEntries(entries) as Record<'perf_arena' | 'recsys_lab' | 'product_review', string>;
};
