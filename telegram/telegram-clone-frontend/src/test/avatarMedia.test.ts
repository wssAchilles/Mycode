import { beforeEach, describe, expect, it } from 'vitest';
import { API_BASE_URL } from '../utils/apiUrl';
import {
  __resetAvatarClientCachesForTest,
  isAvatarUrlLoaded,
  LEGACY_GCS_SPACE_UPLOAD_PREFIX,
  markAvatarUrlLoaded,
  resolveAvatarUrl,
  resolveAvatarWidthBucket,
} from '../utils/media';

describe('avatarMedia url pipeline & cache normalization', () => {
  beforeEach(() => {
    __resetAvatarClientCachesForTest();
  });

  it('rewrites legacy GCS public avatar URLs to backend WebP resize endpoint', () => {
    const legacyUrl = `${LEGACY_GCS_SPACE_UPLOAD_PREFIX}7fcefa34-8310-4795-89bc-de394f81c474.png`;
    expect(resolveAvatarUrl(legacyUrl, 'md')).toBe(
      `${API_BASE_URL}/api/public/space/uploads/7fcefa34-8310-4795-89bc-de394f81c474.png?w=128`,
    );
    expect(resolveAvatarUrl(legacyUrl, 'xl')).toBe(
      `${API_BASE_URL}/api/public/space/uploads/7fcefa34-8310-4795-89bc-de394f81c474.png?w=256`,
    );
  });

  it('normalizes relative and full API public upload URLs with unified width buckets', () => {
    const relative = '/api/public/space/uploads/18fadcc9-f176-4d5e-99e0-f237eb1dc6fc.jpg';
    const expectedSmall = `${API_BASE_URL}/api/public/space/uploads/18fadcc9-f176-4d5e-99e0-f237eb1dc6fc.jpg?w=128`;

    // 列表(54px)、气泡(32px)、顶栏(42px)、选人芯片(24px) 全部分配至同一个 ?w=128 缓存键
    expect(resolveAvatarUrl(relative, 'xs')).toBe(expectedSmall);
    expect(resolveAvatarUrl(relative, 'sm')).toBe(expectedSmall);
    expect(resolveAvatarUrl(relative, 'md')).toBe(expectedSmall);
    expect(resolveAvatarUrl(relative, 'lg')).toBe(expectedSmall);
    expect(resolveAvatarUrl(relative, 54)).toBe(expectedSmall);
    expect(resolveAvatarUrl(`${API_BASE_URL}${relative}`, 'md')).toBe(expectedSmall);

    // 80px/88px 大图预览归入 ?w=256
    expect(resolveAvatarWidthBucket(88)).toBe(256);
    expect(resolveAvatarUrl(relative, 88)).toBe(
      `${API_BASE_URL}/api/public/space/uploads/18fadcc9-f176-4d5e-99e0-f237eb1dc6fc.jpg?w=256`,
    );
  });

  it('preserves data:, blob:, and unrelated third-party URLs untouched', () => {
    expect(resolveAvatarUrl('data:image/png;base64,abc', 'md')).toBe('data:image/png;base64,abc');
    expect(resolveAvatarUrl('blob:https://telegram-467705.web.app/1234', 'md')).toBe(
      'blob:https://telegram-467705.web.app/1234',
    );
    expect(resolveAvatarUrl('https://cdn.example.com/external-avatar.png', 'md')).toBe(
      'https://cdn.example.com/external-avatar.png',
    );
    expect(resolveAvatarUrl(undefined, 'md')).toBeUndefined();
    expect(resolveAvatarUrl('   ', 'md')).toBeUndefined();
  });

  it('tracks decoded avatar readiness in memory cache', () => {
    const resolved = resolveAvatarUrl('/api/public/space/uploads/demo.webp', 'md')!;
    expect(isAvatarUrlLoaded(resolved)).toBe(false);
    markAvatarUrlLoaded(resolved);
    expect(isAvatarUrlLoaded(resolved)).toBe(true);
  });
});
