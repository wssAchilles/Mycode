import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const pkgDir = path.resolve(process.cwd(), 'src/core/wasm/chat_wasm/pkg');
const requiredFiles = [
  'chat_wasm.js',
  'chat_wasm_bg.wasm',
];

const missing = [];
for (const name of requiredFiles) {
  const full = path.join(pkgDir, name);
  try {
    const st = await fs.stat(full);
    if (!st.isFile()) {
      missing.push(name);
    }
  } catch {
    missing.push(name);
  }
}

if (missing.length) {
  // eslint-disable-next-line no-console
  console.error('[wasm-artifacts] missing required wasm-pack outputs:');
  for (const name of missing) {
    // eslint-disable-next-line no-console
    console.error(`  - src/core/wasm/chat_wasm/pkg/${name}`);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[wasm-artifacts] OK');
