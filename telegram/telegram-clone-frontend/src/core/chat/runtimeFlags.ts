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
  searchTieredIndex: readBool('VITE_CHAT_SEARCH_TIERED_INDEX', true),
  searchTieredWasm: readBool('VITE_CHAT_SEARCH_TIERED_WASM', true),
  chatMemoryWindow: readInt('VITE_CHAT_MEMORY_WINDOW', 10000, 5000, 50000),
  workerSyncFallback: readBool('VITE_CHAT_WORKER_SYNC_FALLBACK', true),
  workerQosPatchQueue: readBool('VITE_CHAT_WORKER_QOS', true),
  workerSocketEnabled: readBool('VITE_CHAT_WORKER_SOCKET', true),
  workerSafetyChecks: readBool('VITE_CHAT_WORKER_SAFETY_CHECKS', true),
  mediaWorkerPoolEnabled: readBool('VITE_CHAT_MEDIA_WORKER_POOL', true),
  mediaWorkerPoolSize: readInt('VITE_CHAT_MEDIA_WORKER_POOL_SIZE', 2, 1, 6),
  mediaWorkerQueueLimit: readInt('VITE_CHAT_MEDIA_WORKER_QUEUE_LIMIT', 36, 8, 256),
  strictWorkerBaseline: readBool('VITE_CHAT_STRICT_BASELINE', true),
  socketLegacyRealtimeFallback: readBool('VITE_CHAT_SOCKET_LEGACY_FALLBACK', false),
};
