export {
  AVATAR_WIDTH_BUCKETS,
  parseAvatarWidthParam,
  getCachedPublicAssetAllowed,
  setCachedPublicAssetAllowed,
  getOrCreateAvatarVariant,
  fetchLegacyPublicGcsObject,
  normalizeUploadedAvatarFile,
  __resetAvatarMediaCachesForTest,
  type AvatarWidthBucket,
  type AvatarVariantResult,
} from './avatarMediaOptimizer';
