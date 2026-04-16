import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadPolicyModule() {
  vi.resetModules();
  return import('../core/chat/rolloutPolicy');
}

describe('resolveChatRuntimePolicy storage rollout', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('falls back to IndexedDB when storage rollout percent excludes sqlite-opfs', async () => {
    vi.stubEnv('VITE_CHAT_STORAGE_BACKEND', 'sqlite-opfs');
    vi.stubEnv('VITE_CHAT_STORAGE_SHADOW_IDB', 'true');
    vi.stubEnv('VITE_CHAT_STORAGE_SHADOW_READ_COMPARE', 'true');
    vi.stubEnv('VITE_CHAT_STORAGE_SHADOW_READ_COMPARE_SAMPLE_RATE', '25');
    vi.stubEnv('VITE_CHAT_STORAGE_MIGRATION_ENABLED', 'true');
    vi.stubEnv('VITE_CHAT_STORAGE_MIGRATION_BATCH_SIZE', '500');
    vi.stubEnv('VITE_CHAT_ROLLOUT_STORAGE_SQLITE_PERCENT', '0');
    vi.stubEnv('VITE_CHAT_ROLLOUT_STORAGE_SHADOW_IDB_PERCENT', '0');
    vi.stubEnv('VITE_CHAT_ROLLOUT_STORAGE_MIGRATION_PERCENT', '0');

    const { resolveChatRuntimePolicy } = await loadPolicyModule();
    const policy = resolveChatRuntimePolicy('user-a');

    expect(policy.storageBackend).toBe('idb');
    expect(policy.storageShadowIdb).toBe(false);
    expect(policy.storageMigrationEnabled).toBe(false);
    expect(policy.storageShadowReadCompare).toBe(false);
  });

  it('keeps sqlite-opfs primary with shadow compare when storage rollout is fully enabled', async () => {
    vi.stubEnv('VITE_CHAT_STORAGE_BACKEND', 'sqlite-opfs');
    vi.stubEnv('VITE_CHAT_STORAGE_SHADOW_IDB', 'true');
    vi.stubEnv('VITE_CHAT_STORAGE_SHADOW_READ_COMPARE', 'true');
    vi.stubEnv('VITE_CHAT_STORAGE_SHADOW_READ_COMPARE_SAMPLE_RATE', '20');
    vi.stubEnv('VITE_CHAT_STORAGE_MIGRATION_ENABLED', 'true');
    vi.stubEnv('VITE_CHAT_STORAGE_MIGRATION_BATCH_SIZE', '500');
    vi.stubEnv('VITE_CHAT_ROLLOUT_STORAGE_SQLITE_PERCENT', '100');
    vi.stubEnv('VITE_CHAT_ROLLOUT_STORAGE_SHADOW_IDB_PERCENT', '100');
    vi.stubEnv('VITE_CHAT_ROLLOUT_STORAGE_MIGRATION_PERCENT', '100');

    const { resolveChatRuntimePolicy } = await loadPolicyModule();
    const policy = resolveChatRuntimePolicy('user-b');

    expect(policy.storageBackend).toBe('sqlite-opfs');
    expect(policy.storageShadowIdb).toBe(true);
    expect(policy.storageShadowReadCompare).toBe(true);
    expect(policy.storageShadowReadCompareSampleRate).toBe(20);
    expect(policy.storageMigrationEnabled).toBe(true);
  });
});

