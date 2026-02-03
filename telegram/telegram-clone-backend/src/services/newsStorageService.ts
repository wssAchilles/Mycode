import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const uploadsRoot = path.join(__dirname, '../../uploads');
const contentDir = path.join(uploadsRoot, 'news-content');
const imageDir = path.join(uploadsRoot, 'news-images');

const S3_BUCKET = process.env.NEWS_S3_BUCKET || '';
const S3_REGION = process.env.NEWS_S3_REGION || '';
const S3_ACCESS_KEY_ID = process.env.NEWS_S3_ACCESS_KEY_ID || '';
const S3_SECRET_ACCESS_KEY = process.env.NEWS_S3_SECRET_ACCESS_KEY || '';
const S3_PUBLIC_BASE_URL = process.env.NEWS_S3_PUBLIC_BASE_URL || '';
const NEWS_PUBLIC_UPLOAD_BASE = process.env.NEWS_PUBLIC_UPLOAD_BASE || '/api/public/news/uploads';

const useS3 = !!(S3_BUCKET && S3_REGION && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY && S3_PUBLIC_BASE_URL);

const s3Client = useS3
  ? new S3Client({
      region: S3_REGION,
      credentials: {
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
      },
    })
  : null;

const ensureDirs = async () => {
  await fs.mkdir(contentDir, { recursive: true });
  await fs.mkdir(imageDir, { recursive: true });
};

const hashContent = (text: string) =>
  crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

const toPublicUrl = (relativePath: string) => {
  const cleaned = relativePath.replace(/^\/+/, '');
  if (cleaned.startsWith('news-images/')) {
    return `${NEWS_PUBLIC_UPLOAD_BASE}/${cleaned.replace('news-images/', '')}`;
  }
  return `/api/uploads/${cleaned}`;
};

const resolveImagePath = (value?: string | null): string | null => {
  if (!value) return null;
  if (value.startsWith('news-images/')) return value;

  if (value.startsWith(NEWS_PUBLIC_UPLOAD_BASE)) {
    const filename = value.replace(NEWS_PUBLIC_UPLOAD_BASE, '').replace(/^\/+/, '');
    return filename ? `news-images/${filename}` : null;
  }

  if (value.startsWith('/api/public/news/uploads/')) {
    const filename = value.replace('/api/public/news/uploads/', '').replace(/^\/+/, '');
    return filename ? `news-images/${filename}` : null;
  }

  if (value.startsWith('/api/uploads/')) {
    return value.replace('/api/uploads/', '').replace(/^\/+/, '');
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    if (S3_PUBLIC_BASE_URL && value.startsWith(S3_PUBLIC_BASE_URL)) {
      return value.replace(`${S3_PUBLIC_BASE_URL}/`, '').replace(/^\/+/, '');
    }
    try {
      const parsed = new URL(value);
      const pathname = parsed.pathname.replace(/^\/+/, '');
      if (pathname.startsWith('news-images/')) return pathname;
      if (pathname.startsWith('api/public/news/uploads/')) {
        return `news-images/${pathname.replace('api/public/news/uploads/', '')}`;
      }
      if (pathname.startsWith('api/uploads/')) {
        return pathname.replace('api/uploads/', '');
      }
    } catch {
      return null;
    }
  }

  return null;
};

export const newsStorageService = {
  async saveContent(id: string, content: string): Promise<{ path: string; url: string }> {
    const safeId = id.replace(/[^a-zA-Z0-9-]/g, '');
    const filename = `${safeId}-${hashContent(content)}.md`;
    const relativePath = `news-content/${filename}`;

    if (useS3 && s3Client) {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: relativePath,
          Body: content,
          ContentType: 'text/markdown; charset=utf-8',
        })
      );
      return { path: relativePath, url: `${S3_PUBLIC_BASE_URL}/${relativePath}` };
    }

    await ensureDirs();
    const fullPath = path.join(uploadsRoot, relativePath);
    await fs.writeFile(fullPath, content, 'utf-8');
    return { path: relativePath, url: toPublicUrl(relativePath) };
  },

  async getContent(contentPath?: string | null): Promise<string | null> {
    if (!contentPath) return null;
    if (useS3 && s3Client) {
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: contentPath,
        })
      );
      if (!response.Body) return null;
      const stream = response.Body as any;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString('utf-8');
    }

    const fullPath = path.join(uploadsRoot, contentPath);
    try {
      return await fs.readFile(fullPath, 'utf-8');
    } catch {
      return null;
    }
  },

  async deleteContent(contentPath?: string | null): Promise<void> {
    if (!contentPath) return;
    if (useS3 && s3Client) {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: S3_BUCKET,
          Key: contentPath,
        })
      );
      return;
    }
    const fullPath = path.join(uploadsRoot, contentPath);
    await fs.unlink(fullPath).catch(() => undefined);
  },

  async saveImageFromUrl(id: string, imageUrl?: string | null): Promise<{ path: string | null; url: string | null }> {
    if (!imageUrl) return { path: null, url: null };
    try {
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
      const contentType = response.headers['content-type'] || 'image/jpeg';
      const extFromType = contentType.includes('png')
        ? '.png'
        : contentType.includes('webp')
          ? '.webp'
          : contentType.includes('gif')
            ? '.gif'
            : '.jpg';
      const safeId = id.replace(/[^a-zA-Z0-9-]/g, '');
      const filename = `${safeId}${extFromType}`;
      const relativePath = `news-images/${filename}`;

      if (useS3 && s3Client) {
        await s3Client.send(
          new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: relativePath,
            Body: Buffer.from(response.data),
            ContentType: contentType,
          })
        );
        return { path: relativePath, url: `${S3_PUBLIC_BASE_URL}/${relativePath}` };
      }

      await ensureDirs();
      const fullPath = path.join(uploadsRoot, relativePath);
      await fs.writeFile(fullPath, response.data);
      return { path: relativePath, url: toPublicUrl(relativePath) };
    } catch {
      return { path: null, url: imageUrl || null };
    }
  },

  async deleteImage(imagePathOrUrl?: string | null): Promise<void> {
    if (!imagePathOrUrl) return;
    const resolvedPath = resolveImagePath(imagePathOrUrl);
    if (!resolvedPath) return;
    if (useS3 && s3Client) {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: S3_BUCKET,
          Key: resolvedPath,
        })
      );
      return;
    }
    const fullPath = path.join(uploadsRoot, resolvedPath);
    await fs.unlink(fullPath).catch(() => undefined);
  },
};
