import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const file = path.resolve(process.cwd(), 'src/core/chat/runtimeFlags.ts');
const source = await fs.readFile(file, 'utf8');

const requiredDefaults = [
  { key: 'VITE_CHAT_WASM_SEQ_OPS', expected: true },
  { key: 'VITE_CHAT_WASM_REQUIRED', expected: true },
  { key: 'VITE_CHAT_WASM_SEARCH_FALLBACK', expected: true },
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
