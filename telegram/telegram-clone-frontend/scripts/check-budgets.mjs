import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(process.cwd());
const ASSETS_DIR = path.join(ROOT, 'dist', 'assets');

const KB = 1024;

// Baseline budgets (raw bytes, not gzip). Tune over time.
const BUDGETS = {
  // Worker bundle: includes socket runtime + sync FSM + patch protocol.
  // Keep a hard cap to catch regressions while allowing worker-first networking
  // plus reliable read-sync delivery fallback.
  workerMaxBytes: 222 * KB,
  // WASM payload should remain tiny; it's fetched once and cached by SW.
  wasmMaxBytes: 64 * KB,
  // Largest main-thread JS chunk budget (excluding worker).
  mainLargestJsMaxBytes: 550 * KB,
  // UI guardrail: chat page split chunk should stay within a predictable size.
  chatPageJsMaxBytes: 140 * KB,
  chatPageCssMaxBytes: 80 * KB,
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

function isCssFile(name) {
  return /\.css$/i.test(name);
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
const chatPageJs = files.find((f) => /^ChatPage-.*\.js$/i.test(f)) || null;
const chatPageCss = files.find((f) => /^ChatPage-.*\.css$/i.test(f)) || null;

// Compute largest main-thread JS chunk (exclude worker).
const mainJsFiles = files.filter((f) => isJsFile(f) && !isWorkerFile(f));

let workerBytes = null;
let wasmBytes = null;
let chatPageJsBytes = null;
let chatPageCssBytes = null;
let mainLargest = { file: null, bytes: 0 };

if (worker) workerBytes = await statBytes(path.join(ASSETS_DIR, worker));
if (wasm) wasmBytes = await statBytes(path.join(ASSETS_DIR, wasm));
if (chatPageJs) chatPageJsBytes = await statBytes(path.join(ASSETS_DIR, chatPageJs));
if (chatPageCss) chatPageCssBytes = await statBytes(path.join(ASSETS_DIR, chatPageCss));

for (const f of mainJsFiles) {
  const bytes = await statBytes(path.join(ASSETS_DIR, f));
  if (bytes > mainLargest.bytes) mainLargest = { file: f, bytes };
}

info(
  `budgets: worker<=${fmtBytes(BUDGETS.workerMaxBytes)}, wasm<=${fmtBytes(BUDGETS.wasmMaxBytes)}, mainLargestJs<=${fmtBytes(BUDGETS.mainLargestJsMaxBytes)}, chatPageJs<=${fmtBytes(BUDGETS.chatPageJsMaxBytes)}, chatPageCss<=${fmtBytes(BUDGETS.chatPageCssMaxBytes)}`,
);

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

if (!chatPageJs || !Number.isFinite(chatPageJsBytes)) {
  fail('ChatPage JS chunk not found (expected ChatPage-*.js).');
} else {
  info(`chatPageJs: ${chatPageJs} (${fmtBytes(chatPageJsBytes)})`);
  if (chatPageJsBytes > BUDGETS.chatPageJsMaxBytes) {
    fail(`ChatPage JS chunk too large: ${fmtBytes(chatPageJsBytes)} > ${fmtBytes(BUDGETS.chatPageJsMaxBytes)}`);
  }
}

if (!chatPageCss || !Number.isFinite(chatPageCssBytes)) {
  fail('ChatPage CSS chunk not found (expected ChatPage-*.css).');
} else {
  info(`chatPageCss: ${chatPageCss} (${fmtBytes(chatPageCssBytes)})`);
  if (chatPageCssBytes > BUDGETS.chatPageCssMaxBytes) {
    fail(`ChatPage CSS chunk too large: ${fmtBytes(chatPageCssBytes)} > ${fmtBytes(BUDGETS.chatPageCssMaxBytes)}`);
  }
}

if (process.exitCode) {
  info('budget check: FAIL');
} else {
  info('budget check: OK');
}
