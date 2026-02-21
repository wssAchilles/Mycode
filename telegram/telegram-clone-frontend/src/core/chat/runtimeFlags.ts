const env = import.meta.env;

function readBool(name: string, defaultValue: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const value = String(raw).trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export const runtimeFlags = {
  wasmSeqOps: readBool('VITE_CHAT_WASM_SEQ_OPS', true),
  wasmSearchFallback: readBool('VITE_CHAT_WASM_SEARCH_FALLBACK', true),
  workerSyncFallback: readBool('VITE_CHAT_WORKER_SYNC_FALLBACK', true),
  workerQosPatchQueue: readBool('VITE_CHAT_WORKER_QOS', true),
  workerSocketEnabled: readBool('VITE_CHAT_WORKER_SOCKET', true),
  socketLegacyRealtimeFallback: readBool('VITE_CHAT_SOCKET_LEGACY_FALLBACK', false),
};
