import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const file = path.resolve(process.cwd(), 'src/core/chat/runtimeFlags.ts');
const source = await fs.readFile(file, 'utf8');

const requiredDefaults = [
  { key: 'VITE_CHAT_WASM_SEQ_OPS', expected: true },
  { key: 'VITE_CHAT_WASM_REQUIRED', expected: true },
  { key: 'VITE_CHAT_WASM_SEARCH_FALLBACK', expected: true },
  { key: 'VITE_CHAT_WORKER_SOCKET', expected: true },
  { key: 'VITE_CHAT_WORKER_QOS', expected: true },
  { key: 'VITE_CHAT_WORKER_SYNC_FALLBACK', expected: true },
  { key: 'VITE_CHAT_SOCKET_LEGACY_FALLBACK', expected: false },
];

const missing = [];
for (const rule of requiredDefaults) {
  const pattern = new RegExp(`readBool\\(\\s*['"]${rule.key}['"]\\s*,\\s*${rule.expected ? 'true' : 'false'}\\s*\\)`);
  if (!pattern.test(source)) {
    missing.push(`${rule.key} default should be ${rule.expected ? 'true' : 'false'}`);
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
