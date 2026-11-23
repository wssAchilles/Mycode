import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { Op } from 'sequelize';

vi.mock('../../src/models/Post', () => ({
  default: { exists: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../src/models/SpaceProfile', () => ({
  default: { exists: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../src/models/User', () => ({
  default: { findOne: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../src/models/Group', () => ({
  default: { findOne: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../src/models/NewsArticle', () => ({
  default: { findOne: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../src/models/SpaceUpload', () => ({
  default: { findOne: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../src/utils/logger', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('uploadController isSpacePublicAsset', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { __resetAvatarMediaCachesForTest } = await import('../../src/services/media');
    __resetAvatarMediaCachesForTest();
  });

  it('allows active group avatars without restricting to public group type', async () => {
    const Group = (await import('../../src/models/Group')).default;
    (Group.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'group-private-1' });

    const { isSpacePublicAsset } = await import('../../src/controllers/uploadController');
    const filename = 'f143b93b-466b-474e-ae6b-a251725c6036.webp';

    await expect(isSpacePublicAsset(filename)).resolves.toBe(true);
    expect(Group.findOne).toHaveBeenCalledWith({
      where: {
        isActive: true,
        avatarUrl: { [Op.like]: `%${filename}%` },
      },
      attributes: ['id'],
    });
  });

  it('hits TTL memory cache on repeated checks without querying databases again', async () => {
    const Group = (await import('../../src/models/Group')).default;
    (Group.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'group-cached-1' });

    const { isSpacePublicAsset } = await import('../../src/controllers/uploadController');
    const filename = 'cached-group-avatar.webp';

    await expect(isSpacePublicAsset(filename)).resolves.toBe(true);
    await expect(isSpacePublicAsset(filename)).resolves.toBe(true);
    expect(Group.findOne).toHaveBeenCalledTimes(1);
  });

  it('denies unreferenced asset filenames when no model matches', async () => {
    const { isSpacePublicAsset } = await import('../../src/controllers/uploadController');
    await expect(isSpacePublicAsset('unreferenced-file.webp')).resolves.toBe(false);
  });
});

describe('avatarMediaOptimizer', () => {
  let tempDir: string;

  beforeEach(async () => {
    const { __resetAvatarMediaCachesForTest } = await import('../../src/services/media');
    __resetAvatarMediaCachesForTest();
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tg-avatar-opt-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('normalizes requested width into controlled buckets and rejects invalid input', async () => {
    const { parseAvatarWidthParam } = await import('../../src/services/media');
    expect(parseAvatarWidthParam(undefined)).toBeNull();
    expect(parseAvatarWidthParam('')).toBeNull();
    expect(parseAvatarWidthParam('-10')).toBeNull();
    expect(parseAvatarWidthParam('abc')).toBeNull();
    expect(parseAvatarWidthParam(4096)).toBeNull();
    expect(parseAvatarWidthParam(32)).toBe(64);
    expect(parseAvatarWidthParam('80')).toBe(96);
    expect(parseAvatarWidthParam(128)).toBe(128);
    expect(parseAvatarWidthParam(200)).toBe(256);
    expect(parseAvatarWidthParam(512)).toBe(256);
  });

  it('generates WebP variants, coalesces concurrent requests via single-flight, and serves from memory LRU', async () => {
    const { getOrCreateAvatarVariant } = await import('../../src/services/media');
    const sourcePng = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: { r: 37, g: 99, b: 235 },
      },
    })
      .png()
      .toBuffer();

    const loadSourceBuffer = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return sourcePng;
    });

    const concurrentResults = await Promise.all(
      Array.from({ length: 5 }, () =>
        getOrCreateAvatarVariant({
          filename: 'sample-avatar.png',
          width: 128,
          cacheDir: tempDir,
          loadSourceBuffer,
        }),
      ),
    );

    expect(loadSourceBuffer).toHaveBeenCalledTimes(1);
    for (const res of concurrentResults) {
      expect(res).not.toBeNull();
      expect(res?.contentType).toBe('image/webp');
      expect(res?.buffer.length).toBeGreaterThan(0);
    }

    const meta = await sharp(concurrentResults[0]!.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);

    // 二次读取应直接命中内存 LRU
    const secondHit = await getOrCreateAvatarVariant({
      filename: 'sample-avatar.png',
      width: 128,
      cacheDir: tempDir,
      loadSourceBuffer,
    });
    expect(secondHit?.source).toBe('memory');
    expect(loadSourceBuffer).toHaveBeenCalledTimes(1);
  });
});
