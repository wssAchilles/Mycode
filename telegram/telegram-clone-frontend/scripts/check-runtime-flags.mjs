import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const file = path.resolve(process.cwd(), 'src/core/chat/runtimeFlags.ts');
const source = await fs.readFile(file, 'utf8');

const requiredDefaults = [
  { key: 'VITE_CHAT_WASM_SEQ_OPS', expected: true },
  { key: 'VITE_CHAT_WASM_REQUIRED', expected: true },
  { key: 'VITE_CHAT_WASM_SEARCH_FALLBACK', expected: true },
  { key: 'VITE_CHAT_WASM_SHADOW_COMPARE', expected: true },
  { key: 'VITE_CHAT_SEARCH_TIERED_INDEX', expected: true },
  { key: 'VITE_CHAT_SEARCH_TIERED_WASM', expected: true },
  { key: 'VITE_CHAT_WORKER_SOCKET', expected: true },
  { key: 'VITE_CHAT_WORKER_QOS', expected: true },
  { key: 'VITE_CHAT_WORKER_SYNC_FALLBACK', expected: true },
  { key: 'VITE_CHAT_WORKER_SAFETY_CHECKS', expected: true },
  { key: 'VITE_CHAT_MEDIA_WORKER_POOL', expected: true },
  { key: 'VITE_CHAT_STRICT_BASELINE', expected: true },
  { key: 'VITE_CHAT_SOCKET_LEGACY_FALLBACK', expected: false },
];

const requiredIntDefaults = [
  { key: 'VITE_CHAT_MEMORY_WINDOW', expected: 10_000, min: 5_000, max: 50_000 },
  { key: 'VITE_CHAT_WASM_SHADOW_COMPARE_SAMPLE_RATE', expected: 5, min: 0, max: 100 },
  { key: 'VITE_CHAT_SYNC_DISCONNECT_GRACE_MS', expected: 800, min: 100, max: 5000 },
  { key: 'VITE_CHAT_SYNC_FLAP_WINDOW_MS', expected: 12_000, min: 2000, max: 60_000 },
  { key: 'VITE_CHAT_SYNC_FLAP_MAX_TRANSITIONS', expected: 8, min: 3, max: 30 },
  { key: 'VITE_CHAT_SYNC_GAP_RECOVER_COOLDOWN_MS', expected: 1500, min: 100, max: 10_000 },
  { key: 'VITE_CHAT_SYNC_GAP_RECOVER_MAX_STEPS', expected: 10, min: 1, max: 50 },
  { key: 'VITE_CHAT_SYNC_GAP_RECOVER_STEP_DELAY_MS', expected: 24, min: 0, max: 200 },
  { key: 'VITE_CHAT_SYNC_GAP_RECOVER_FORCE_BUDGET_WINDOW_MS', expected: 20_000, min: 2000, max: 120_000 },
  { key: 'VITE_CHAT_SYNC_GAP_RECOVER_FORCE_BUDGET_MAX', expected: 6, min: 1, max: 20 },
  { key: 'VITE_CHAT_SYNC_RECONNECT_MIN_DISCONNECT_MS', expected: 1000, min: 0, max: 30_000 },
  { key: 'VITE_CHAT_SYNC_RECONNECT_MIN_INTERVAL_MS', expected: 2000, min: 200, max: 30_000 },
  { key: 'VITE_CHAT_WORKER_REALTIME_BATCH_SIZE', expected: 220, min: 32, max: 2000 },
  { key: 'VITE_CHAT_WORKER_REALTIME_QUEUE_HARD_MAX', expected: 8000, min: 512, max: 100000 },
  { key: 'VITE_CHAT_WORKER_REALTIME_QUEUE_WARN_AT', expected: 3000, min: 128, max: 80000 },
  { key: 'VITE_CHAT_MEDIA_WORKER_POOL_SIZE', expected: 2, min: 1, max: 6 },
  { key: 'VITE_CHAT_MEDIA_WORKER_QUEUE_LIMIT', expected: 36, min: 8, max: 256 },
];

const missing = [];
for (const rule of requiredDefaults) {
  const pattern = new RegExp(`readBool\\(\\s*['"]${rule.key}['"]\\s*,\\s*${rule.expected ? 'true' : 'false'}\\s*\\)`);
  if (!pattern.test(source)) {
    missing.push(`${rule.key} default should be ${rule.expected ? 'true' : 'false'}`);
  }
}

for (const rule of requiredIntDefaults) {
  const pattern = new RegExp(
    `readInt\\(\\s*['"]${rule.key}['"]\\s*,\\s*${rule.expected}\\s*,\\s*${rule.min}\\s*,\\s*${rule.max}\\s*\\)`,
  );
  if (!pattern.test(source)) {
    missing.push(
      `${rule.key} default/range should be (${rule.expected}, min=${rule.min}, max=${rule.max})`,
    );
  }
}

if (missing.length) {
  // eslint-disable-next-line no-console
  console.error('[runtime-flags] baseline mismatch:');
  for (const item of missing) {
    // eslint-disable-next-line no-console
    console.error(`  - ${item}`);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[runtime-flags] OK');
