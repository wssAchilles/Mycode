import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const pkgDir = path.resolve(process.cwd(), 'src/core/wasm/chat_wasm/pkg');
const requiredFiles = [
  'chat_wasm.js',
  'chat_wasm_bg.wasm',
  'chat_wasm.d.ts',
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

const dtsFile = path.join(pkgDir, 'chat_wasm.d.ts');
const dtsSource = await fs.readFile(dtsFile, 'utf8');
const requiredExports = [
  'merge_sorted_unique_u32',
  'diff_sorted_unique_u32',
  'merge_and_diff_sorted_unique_u32',
  'search_contains_indices',
  'chat_wasm_version',
];

const exportMissing = requiredExports.filter((name) => {
  const re = new RegExp(`\\bfunction\\s+${name}\\b`);
  return !re.test(dtsSource);
});

if (exportMissing.length) {
  // eslint-disable-next-line no-console
  console.error('[wasm-artifacts] missing required exports in pkg/chat_wasm.d.ts:');
  for (const name of exportMissing) {
    // eslint-disable-next-line no-console
    console.error(`  - ${name}`);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[wasm-artifacts] OK');
