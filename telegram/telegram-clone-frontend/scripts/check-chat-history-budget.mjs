import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const tsxFile = path.resolve(process.cwd(), 'src/features/chat/components/ChatHistory.tsx');
const cssFile = path.resolve(process.cwd(), 'src/features/chat/components/ChatHistory.css');

const [tsx, css] = await Promise.all([
  fs.readFile(tsxFile, 'utf8'),
  fs.readFile(cssFile, 'utf8'),
]);

function readConst(source, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*([0-9_]+)`);
  const hit = source.match(re);
  if (!hit) return null;
  const numeric = Number(String(hit[1]).replace(/_/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

const overscanIdle = readConst(tsx, 'OVERSCAN_IDLE');
const overscanMedium = readConst(tsx, 'OVERSCAN_MEDIUM');
const overscanFast = readConst(tsx, 'OVERSCAN_FAST');
const overscanUpdateInterval = readConst(tsx, 'OVERSCAN_UPDATE_INTERVAL_MS');
const visibleRangeFlushInterval = readConst(tsx, 'VISIBLE_RANGE_FLUSH_INTERVAL_MS');

const violations = [];

if (overscanIdle === null || overscanIdle < 3 || overscanIdle > 12) {
  violations.push(`OVERSCAN_IDLE out of range [3,12]: ${overscanIdle}`);
}
if (overscanMedium === null || overscanMedium < overscanIdle || overscanMedium > 14) {
  violations.push(`OVERSCAN_MEDIUM out of range [OVERSCAN_IDLE,14]: ${overscanMedium}`);
}
if (overscanFast === null || overscanFast < overscanMedium || overscanFast > 16) {
  violations.push(`OVERSCAN_FAST out of range [OVERSCAN_MEDIUM,16]: ${overscanFast}`);
}
if (overscanUpdateInterval === null || overscanUpdateInterval < 80 || overscanUpdateInterval > 320) {
  violations.push(`OVERSCAN_UPDATE_INTERVAL_MS out of range [80,320]: ${overscanUpdateInterval}`);
}
if (visibleRangeFlushInterval === null || visibleRangeFlushInterval < 16 || visibleRangeFlushInterval > 80) {
  violations.push(`VISIBLE_RANGE_FLUSH_INTERVAL_MS out of range [16,80]: ${visibleRangeFlushInterval}`);
}

const requiredPatterns = [
  { label: 'virtualizer hook', re: /useVirtualizer\(/ },
  { label: 'raf-throttled scroll handler', re: /requestAnimationFrame\(\(\) => \{[\s\S]*processScroll\(/m },
  { label: 'load-more top trigger', re: /scrollTop < 80[\s\S]*onLoadMore\(\)/m },
  { label: 'store-mode selector row', re: /StoreMessageBubble/ },
  { label: 'visible range callback', re: /onVisibleRangeChange\(pending\.start, pending\.end\)/ },
  { label: 'css contain content', re: /\.chat-history\s*\{[\s\S]*contain:\s*content;/m, source: css },
];

for (const rule of requiredPatterns) {
  const src = rule.source || tsx;
  if (!rule.re.test(src)) {
    violations.push(`missing pattern: ${rule.label}`);
  }
}

if (violations.length) {
  // eslint-disable-next-line no-console
  console.error('[chat-history-budget] violations detected:');
  for (const item of violations) {
    // eslint-disable-next-line no-console
    console.error(`  - ${item}`);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[chat-history-budget] OK');
