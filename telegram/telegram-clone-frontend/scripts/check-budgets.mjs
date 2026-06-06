import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(process.cwd());
const ASSETS_DIR = path.join(ROOT, 'dist', 'assets');

const KB = 1024;

// Baseline budgets (raw bytes, not gzip). Tune over time.
// Hard budgets gate this frontend motion-governance work. Soft budgets report
// existing bundle debt without blocking unrelated animation/a11y changes.
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
  // Animation governance: keep Anime.js and Framer chunks observable.
  animeJsMaxBytes: 70 * KB,
  animationJsMaxBytes: 170 * KB,
  // Total initial JS budget (all main-thread chunks combined).
  totalInitialJsMaxBytes: 800 * KB,
  // Lazy-loaded chunk size limit.
  lazyChunkMaxBytes: 100 * KB,
  // Minimum number of lazy-loaded chunks (code-splitting guard).
  minLazyChunks: 3,
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
  console.error(`[budget] ${msg}`);
  process.exitCode = 1;
}

function info(msg) {
  console.log(`[budget] ${msg}`);
}

function soft(msg) {
  console.log(`[budget:soft] ${msg}`);
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
const animeJs = files.find((f) => /^animejs-.*\.js$/i.test(f)) || null;
const animationJs = files.find((f) => /^animation-.*\.js$/i.test(f)) || null;

// Compute largest main-thread JS chunk (exclude worker).
const mainJsFiles = files.filter((f) => isJsFile(f) && !isWorkerFile(f));

let workerBytes = null;
let wasmBytes = null;
let chatPageJsBytes = null;
let chatPageCssBytes = null;
let animeJsBytes = null;
let animationJsBytes = null;
let mainLargest = { file: null, bytes: 0 };

if (worker) workerBytes = await statBytes(path.join(ASSETS_DIR, worker));
if (wasm) wasmBytes = await statBytes(path.join(ASSETS_DIR, wasm));
if (chatPageJs) chatPageJsBytes = await statBytes(path.join(ASSETS_DIR, chatPageJs));
if (chatPageCss) chatPageCssBytes = await statBytes(path.join(ASSETS_DIR, chatPageCss));
if (animeJs) animeJsBytes = await statBytes(path.join(ASSETS_DIR, animeJs));
if (animationJs) animationJsBytes = await statBytes(path.join(ASSETS_DIR, animationJs));

for (const f of mainJsFiles) {
  const bytes = await statBytes(path.join(ASSETS_DIR, f));
  if (bytes > mainLargest.bytes) mainLargest = { file: f, bytes };
}

info(
  `hard budgets: chatPageJs<=${fmtBytes(BUDGETS.chatPageJsMaxBytes)}, chatPageCss<=${fmtBytes(BUDGETS.chatPageCssMaxBytes)}, animejs<=${fmtBytes(BUDGETS.animeJsMaxBytes)}, animation<=${fmtBytes(BUDGETS.animationJsMaxBytes)}`,
);
info(
  `soft budgets: worker<=${fmtBytes(BUDGETS.workerMaxBytes)}, wasm<=${fmtBytes(BUDGETS.wasmMaxBytes)}, mainLargestJs<=${fmtBytes(BUDGETS.mainLargestJsMaxBytes)}, totalInitialJs<=${fmtBytes(BUDGETS.totalInitialJsMaxBytes)}, lazyChunk<=${fmtBytes(BUDGETS.lazyChunkMaxBytes)}`,
);

if (!workerBytes) {
  soft('Worker asset not found (expected chatCore.worker-*.js).');
} else {
  soft(`worker: ${worker} (${fmtBytes(workerBytes)})`);
  if (workerBytes > BUDGETS.workerMaxBytes) {
    soft(`Worker bundle too large: ${fmtBytes(workerBytes)} > ${fmtBytes(BUDGETS.workerMaxBytes)}`);
  }
}

if (!wasmBytes) {
  soft('WASM asset not found (expected chat_wasm_bg-*.wasm).');
} else {
  soft(`wasm: ${wasm} (${fmtBytes(wasmBytes)})`);
  if (wasmBytes > BUDGETS.wasmMaxBytes) {
    soft(`WASM bundle too large: ${fmtBytes(wasmBytes)} > ${fmtBytes(BUDGETS.wasmMaxBytes)}`);
  }
}

if (!mainLargest.file) {
  soft('No main-thread JS chunks found.');
} else {
  soft(`mainLargestJs: ${mainLargest.file} (${fmtBytes(mainLargest.bytes)})`);
  if (mainLargest.bytes > BUDGETS.mainLargestJsMaxBytes) {
    soft(`Main JS chunk too large: ${fmtBytes(mainLargest.bytes)} > ${fmtBytes(BUDGETS.mainLargestJsMaxBytes)}`);
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

if (!animeJs || !Number.isFinite(animeJsBytes)) {
  fail('Anime.js chunk not found (expected animejs-*.js).');
} else {
  info(`animejs: ${animeJs} (${fmtBytes(animeJsBytes)})`);
  if (animeJsBytes > BUDGETS.animeJsMaxBytes) {
    fail(`Anime.js chunk too large: ${fmtBytes(animeJsBytes)} > ${fmtBytes(BUDGETS.animeJsMaxBytes)}`);
  }
}

if (!animationJs || !Number.isFinite(animationJsBytes)) {
  fail('Animation chunk not found (expected animation-*.js).');
} else {
  info(`animation: ${animationJs} (${fmtBytes(animationJsBytes)})`);
  if (animationJsBytes > BUDGETS.animationJsMaxBytes) {
    fail(`Animation chunk too large: ${fmtBytes(animationJsBytes)} > ${fmtBytes(BUDGETS.animationJsMaxBytes)}`);
  }
}

// --- Total initial JS budget ---
// Use actual sum of all main-thread JS files
let totalMainJsBytes = 0;
for (const f of mainJsFiles) {
  totalMainJsBytes += await statBytes(path.join(ASSETS_DIR, f));
}
soft(`totalInitialJs: ${fmtBytes(totalMainJsBytes)} (budget: ${fmtBytes(BUDGETS.totalInitialJsMaxBytes)})`);
if (totalMainJsBytes > BUDGETS.totalInitialJsMaxBytes) {
  soft(`Total initial JS too large: ${fmtBytes(totalMainJsBytes)} > ${fmtBytes(BUDGETS.totalInitialJsMaxBytes)}`);
}

// --- Lazy chunk checks ---
// Lazy chunks are JS files that are NOT the main entry and NOT the worker.
// In Vite, lazy chunks are typically named with content hashes and loaded via dynamic import.
const lazyChunks = files.filter((f) => {
  if (!isJsFile(f)) return false;
  if (isWorkerFile(f)) return false;
  if (f === chatPageJs || f === animeJs || f === animationJs) return false;
  // Exclude the main entry chunk (usually named index-*.js or app-*.js)
  if (/^(index|app)-/i.test(f)) return false;
  return true;
});

soft(`lazyChunks: ${lazyChunks.length} (min: ${BUDGETS.minLazyChunks})`);
if (lazyChunks.length < BUDGETS.minLazyChunks) {
  soft(`Too few lazy chunks: ${lazyChunks.length} < ${BUDGETS.minLazyChunks}. Ensure code splitting is working.`);
}

for (const f of lazyChunks) {
  const bytes = await statBytes(path.join(ASSETS_DIR, f));
  if (bytes > BUDGETS.lazyChunkMaxBytes) {
    soft(`Lazy chunk too large: ${f} (${fmtBytes(bytes)}) > ${fmtBytes(BUDGETS.lazyChunkMaxBytes)}`);
  }
}

if (process.exitCode) {
  info('budget check: FAIL');
} else {
  info('budget check: OK');
}
