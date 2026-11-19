import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisState = vi.hoisted(() => {
  const store = new Map<string, string>();
  const sets = new Map<string, string[]>();
  const commands: Array<() => Promise<unknown>> = [];

  const mockPipeline = {
    sunion: vi.fn((...keys: string[]) => {
      commands.push(async () => {
        const merged = new Set<string>();
        for (const key of keys) {
          for (const member of sets.get(key) || []) {
            merged.add(member);
          }
        }
        return [null, Array.from(merged)];
      });
      return mockPipeline;
    }),
    get: vi.fn((key: string) => {
      commands.push(async () => [null, store.get(key) ?? null]);
      return mockPipeline;
    }),
    exec: vi.fn(async () => {
      const batch = commands.splice(0, commands.length);
      return Promise.all(batch.map((fn) => fn()));
    }),
  };

  const mockClient = {
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'connect') cb();
    }),
    connect: vi.fn(async () => undefined),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    mget: vi.fn(async (...keys: string[]) => keys.map((key) => store.get(key) ?? null)),
    pipeline: vi.fn(() => mockPipeline),
  };

  return { store, sets, mockClient };
});

vi.mock('ioredis', () => ({
  default: vi.fn(function RedisMock() {
    return redisState.mockClient;
  }),
}));

vi.mock('../../src/utils/logger', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('cacheService.areUsersOnline', () => {
  beforeEach(() => {
    redisState.store.clear();
    redisState.sets.clear();
    vi.clearAllMocks();
  });

  it('从 Rust Redis 会话注册表读取实时在线状态并剔除未认证和过期会话', async () => {
    const { cacheService } = await import('../../src/services/cacheService');
    const now = new Date();
    const stale = new Date(now.getTime() - 200_000);

    // u-online: 已认证且心跳新鲜
    redisState.sets.set('rt:user:u-online', ['sid-1']);
    redisState.store.set(
      'rt:session:sid-1',
      JSON.stringify({
        session_id: 'sid-1',
        user_id: 'u-online',
        authenticated: true,
        last_heartbeat_at: now.toISOString(),
      }),
    );

    // u-stale: 已认证但心跳超时
    redisState.sets.set('rt:user:u-stale', ['sid-2']);
    redisState.store.set(
      'rt:session:sid-2',
      JSON.stringify({
        session_id: 'sid-2',
        user_id: 'u-stale',
        authenticated: true,
        last_heartbeat_at: stale.toISOString(),
      }),
    );

    // u-unauth: 仅建立连接未认证
    redisState.sets.set('rt:user:u-unauth', ['sid-3']);
    redisState.store.set(
      'rt:session:sid-3',
      JSON.stringify({
        session_id: 'sid-3',
        user_id: 'u-unauth',
        authenticated: false,
        last_heartbeat_at: now.toISOString(),
      }),
    );

    // 触发一次连接初始化后批量查询
    await cacheService.get('warmup');
    const result = await cacheService.areUsersOnline(['u-online', 'u-stale', 'u-unauth', 'u-none'], 120);

    expect(result.get('u-online')).toBe(true);
    expect(result.get('u-stale')).toBe(false);
    expect(result.get('u-unauth')).toBe(false);
    expect(result.get('u-none')).toBe(false);
  });
});
