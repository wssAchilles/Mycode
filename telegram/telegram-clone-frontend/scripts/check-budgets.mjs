import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(process.cwd());
const ASSETS_DIR = path.join(ROOT, 'dist', 'assets');

const KB = 1024;

// Baseline budgets (raw bytes, not gzip). Tune over time.
const BUDGETS = {
  // Worker bundle should stay small; it loads on every session.
  workerMaxBytes: 160 * KB,
  // WASM payload should remain tiny; it's fetched once and cached by SW.
  wasmMaxBytes: 64 * KB,
  // Largest main-thread JS chunk budget (excluding worker).
  mainLargestJsMaxBytes: 550 * KB,
};

function fmtBytes(n) {
  if (!Number.isFinite(n)) return String(n);
  if (n < KB) return `${n} B`;
  const kb = n / KB;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

async function listFiles(dir) {
  try {
    return await fs.readdir(dir);
  } catch {
    return null;
  }
}

async function statBytes(p) {
  const st = await fs.stat(p);
  return st.size;
}

function isWorkerFile(name) {
  return /^chatCore\.worker-.*\.js$/i.test(name);
}

function isWasmFile(name) {
  return /^chat_wasm_bg-.*\.wasm$/i.test(name);
}

function isJsFile(name) {
  return /\.js$/i.test(name);
}

function fail(msg) {
  // eslint-disable-next-line no-console
  console.error(`[budget] ${msg}`);
  process.exitCode = 1;
}

function info(msg) {
  // eslint-disable-next-line no-console
  console.log(`[budget] ${msg}`);
}

const files = await listFiles(ASSETS_DIR);
if (!files) {
  fail(`Missing ${ASSETS_DIR}. Run \`npm run build\` first.`);
  process.exit(process.exitCode || 1);
}

const worker = files.find(isWorkerFile) || null;
const wasm = files.find(isWasmFile) || null;

// Compute largest main-thread JS chunk (exclude worker).
const mainJsFiles = files.filter((f) => isJsFile(f) && !isWorkerFile(f));

let workerBytes = null;
let wasmBytes = null;
let mainLargest = { file: null, bytes: 0 };

if (worker) workerBytes = await statBytes(path.join(ASSETS_DIR, worker));
if (wasm) wasmBytes = await statBytes(path.join(ASSETS_DIR, wasm));

for (const f of mainJsFiles) {
  const bytes = await statBytes(path.join(ASSETS_DIR, f));
  if (bytes > mainLargest.bytes) mainLargest = { file: f, bytes };
}

info(`budgets: worker<=${fmtBytes(BUDGETS.workerMaxBytes)}, wasm<=${fmtBytes(BUDGETS.wasmMaxBytes)}, mainLargestJs<=${fmtBytes(BUDGETS.mainLargestJsMaxBytes)}`);

if (!workerBytes) {
  fail('Worker asset not found (expected chatCore.worker-*.js).');
} else {
  info(`worker: ${worker} (${fmtBytes(workerBytes)})`);
  if (workerBytes > BUDGETS.workerMaxBytes) {
    fail(`Worker bundle too large: ${fmtBytes(workerBytes)} > ${fmtBytes(BUDGETS.workerMaxBytes)}`);
  }
}

if (!wasmBytes) {
  fail('WASM asset not found (expected chat_wasm_bg-*.wasm).');
} else {
  info(`wasm: ${wasm} (${fmtBytes(wasmBytes)})`);
  if (wasmBytes > BUDGETS.wasmMaxBytes) {
    fail(`WASM bundle too large: ${fmtBytes(wasmBytes)} > ${fmtBytes(BUDGETS.wasmMaxBytes)}`);
  }
}

if (!mainLargest.file) {
  fail('No main-thread JS chunks found.');
} else {
  info(`mainLargestJs: ${mainLargest.file} (${fmtBytes(mainLargest.bytes)})`);
  if (mainLargest.bytes > BUDGETS.mainLargestJsMaxBytes) {
    fail(`Main JS chunk too large: ${fmtBytes(mainLargest.bytes)} > ${fmtBytes(BUDGETS.mainLargestJsMaxBytes)}`);
  }
}

if (process.exitCode) {
  info('budget check: FAIL');
} else {
  info('budget check: OK');
}

