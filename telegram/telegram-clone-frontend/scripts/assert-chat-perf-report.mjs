import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPORT_DIR = path.resolve(process.cwd(), 'perf-reports');
const SWITCH_P50_BUDGET = Number.parseFloat(process.env.PERF_BUDGET_SWITCH_P50_MS || '100');
const SWITCH_P95_BUDGET = Number.parseFloat(process.env.PERF_BUDGET_SWITCH_P95_MS || '200');
const WARM_SWITCH_P50_BUDGET = Number.parseFloat(process.env.PERF_BUDGET_WARM_SWITCH_P50_MS || '80');
const WARM_SWITCH_P95_BUDGET = Number.parseFloat(process.env.PERF_BUDGET_WARM_SWITCH_P95_MS || '160');
const FRAME_P95_BUDGET = Number.parseFloat(process.env.PERF_BUDGET_FRAME_P95_MS || '18');
const MAX_LONG_TASKS = Number.parseInt(process.env.PERF_BUDGET_MAX_LONGTASKS || '1', 10);
const MAX_LONG_TASKS_WARM = Number.parseInt(process.env.PERF_BUDGET_MAX_LONGTASKS_WARM || '0', 10);

function fail(msg) {
  // eslint-disable-next-line no-console
  console.error(`[perf-assert] ${msg}`);
  process.exitCode = 1;
}

async function pickLatestReport() {
  const files = await fs.readdir(REPORT_DIR);
  const candidates = files
    .filter((f) => /^chat-perf-.*\.json$/i.test(f))
    .sort();
  if (!candidates.length) return null;
  const latest = candidates[candidates.length - 1];
  return path.join(REPORT_DIR, latest);
}

const reportFile = await pickLatestReport().catch(() => null);
if (!reportFile) {
  fail(`No chat perf report found in ${REPORT_DIR}`);
  process.exit(process.exitCode || 1);
}

const report = JSON.parse(await fs.readFile(reportFile, 'utf8'));

// eslint-disable-next-line no-console
console.log(`[perf-assert] using report: ${reportFile}`);
// eslint-disable-next-line no-console
console.log(
  `[perf-assert] cold=${report.coldSwitchMs}ms switchP50=${report.switchP50Ms}ms switchP95=${report.switchP95Ms}ms warmP50=${report.warmSwitchP50Ms}ms warmP95=${report.warmSwitchP95Ms}ms frameP95=${report.frameP95Ms}ms longTasks=${report.longTaskCount} warmLongTasks=${report.longTaskCountWarm}`,
);

if (Number.isFinite(SWITCH_P50_BUDGET) && report.switchP50Ms > SWITCH_P50_BUDGET) {
  fail(`switchP50 exceeds budget: ${report.switchP50Ms} > ${SWITCH_P50_BUDGET}`);
}
if (Number.isFinite(SWITCH_P95_BUDGET) && report.switchP95Ms > SWITCH_P95_BUDGET) {
  fail(`switchP95 exceeds budget: ${report.switchP95Ms} > ${SWITCH_P95_BUDGET}`);
}
if (Number.isFinite(WARM_SWITCH_P50_BUDGET) && report.warmSwitchP50Ms > WARM_SWITCH_P50_BUDGET) {
  fail(`warmSwitchP50 exceeds budget: ${report.warmSwitchP50Ms} > ${WARM_SWITCH_P50_BUDGET}`);
}
if (Number.isFinite(WARM_SWITCH_P95_BUDGET) && report.warmSwitchP95Ms > WARM_SWITCH_P95_BUDGET) {
  fail(`warmSwitchP95 exceeds budget: ${report.warmSwitchP95Ms} > ${WARM_SWITCH_P95_BUDGET}`);
}
if (Number.isFinite(FRAME_P95_BUDGET) && report.frameP95Ms > FRAME_P95_BUDGET) {
  fail(`frameP95 exceeds budget: ${report.frameP95Ms} > ${FRAME_P95_BUDGET}`);
}
if (Number.isFinite(MAX_LONG_TASKS) && report.longTaskCount > MAX_LONG_TASKS) {
  fail(`longTaskCount exceeds budget: ${report.longTaskCount} > ${MAX_LONG_TASKS}`);
}
if (Number.isFinite(MAX_LONG_TASKS_WARM) && report.longTaskCountWarm > MAX_LONG_TASKS_WARM) {
  fail(`longTaskCountWarm exceeds budget: ${report.longTaskCountWarm} > ${MAX_LONG_TASKS_WARM}`);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
// eslint-disable-next-line no-console
console.log('[perf-assert] OK');
