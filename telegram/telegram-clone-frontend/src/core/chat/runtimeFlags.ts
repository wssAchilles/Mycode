const env = import.meta.env;

function readBool(name: string, defaultValue: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const value = String(raw).trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function readInt(name: string, defaultValue: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  const normalized = Math.floor(parsed);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

export const runtimeFlags = {
  wasmSeqOps: readBool('VITE_CHAT_WASM_SEQ_OPS', true),
  wasmRequired: readBool('VITE_CHAT_WASM_REQUIRED', true),
  wasmSearchFallback: readBool('VITE_CHAT_WASM_SEARCH_FALLBACK', true),
  wasmShadowCompare: readBool('VITE_CHAT_WASM_SHADOW_COMPARE', true),
  wasmShadowCompareSampleRate: readInt('VITE_CHAT_WASM_SHADOW_COMPARE_SAMPLE_RATE', 5, 0, 100),
  searchTieredIndex: readBool('VITE_CHAT_SEARCH_TIERED_INDEX', true),
  searchTieredWasm: readBool('VITE_CHAT_SEARCH_TIERED_WASM', true),
  chatMemoryWindow: readInt('VITE_CHAT_MEMORY_WINDOW', 10000, 5000, 50000),
  workerSyncFallback: readBool('VITE_CHAT_WORKER_SYNC_FALLBACK', true),
  workerQosPatchQueue: readBool('VITE_CHAT_WORKER_QOS', true),
  workerSocketEnabled: readBool('VITE_CHAT_WORKER_SOCKET', true),
  workerSafetyChecks: readBool('VITE_CHAT_WORKER_SAFETY_CHECKS', true),
  workerRealtimeBatchSize: readInt('VITE_CHAT_WORKER_REALTIME_BATCH_SIZE', 220, 32, 2000),
  workerRealtimeQueueHardMax: readInt('VITE_CHAT_WORKER_REALTIME_QUEUE_HARD_MAX', 8000, 512, 100000),
  workerRealtimeQueueWarnAt: readInt('VITE_CHAT_WORKER_REALTIME_QUEUE_WARN_AT', 3000, 128, 80000),
  syncDisconnectGraceMs: readInt('VITE_CHAT_SYNC_DISCONNECT_GRACE_MS', 800, 100, 5000),
  syncFlapWindowMs: readInt('VITE_CHAT_SYNC_FLAP_WINDOW_MS', 12000, 2000, 60000),
  syncFlapMaxTransitions: readInt('VITE_CHAT_SYNC_FLAP_MAX_TRANSITIONS', 8, 3, 30),
  syncGapRecoverCooldownMs: readInt('VITE_CHAT_SYNC_GAP_RECOVER_COOLDOWN_MS', 1500, 100, 10000),
  syncGapRecoverMaxSteps: readInt('VITE_CHAT_SYNC_GAP_RECOVER_MAX_STEPS', 10, 1, 50),
  syncGapRecoverStepDelayMs: readInt('VITE_CHAT_SYNC_GAP_RECOVER_STEP_DELAY_MS', 24, 0, 200),
  syncGapRecoverForceBudgetWindowMs: readInt('VITE_CHAT_SYNC_GAP_RECOVER_FORCE_BUDGET_WINDOW_MS', 20000, 2000, 120000),
  syncGapRecoverForceBudgetMax: readInt('VITE_CHAT_SYNC_GAP_RECOVER_FORCE_BUDGET_MAX', 6, 1, 20),
  syncReconnectMinDisconnectMs: readInt('VITE_CHAT_SYNC_RECONNECT_MIN_DISCONNECT_MS', 1000, 0, 30000),
  syncReconnectMinIntervalMs: readInt('VITE_CHAT_SYNC_RECONNECT_MIN_INTERVAL_MS', 2000, 200, 30000),
  mediaWorkerPoolEnabled: readBool('VITE_CHAT_MEDIA_WORKER_POOL', true),
  mediaWorkerPoolSize: readInt('VITE_CHAT_MEDIA_WORKER_POOL_SIZE', 2, 1, 6),
  mediaWorkerQueueLimit: readInt('VITE_CHAT_MEDIA_WORKER_QUEUE_LIMIT', 36, 8, 256),
  strictWorkerBaseline: readBool('VITE_CHAT_STRICT_BASELINE', true),
  socketLegacyRealtimeFallback: readBool('VITE_CHAT_SOCKET_LEGACY_FALLBACK', false),
};
