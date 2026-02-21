import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPORT_DIR = path.resolve(process.cwd(), 'perf-reports');

const WARM_SWITCH_P50_MEDIAN_BUDGET = Number.parseFloat(process.env.PERF_BUDGET_MULTI_WARM_SWITCH_P50_MEDIAN_MS || '80');
const WARM_SWITCH_P95_MEDIAN_BUDGET = Number.parseFloat(process.env.PERF_BUDGET_MULTI_WARM_SWITCH_P95_MEDIAN_MS || '160');
const FRAME_P95_MEDIAN_BUDGET = Number.parseFloat(process.env.PERF_BUDGET_MULTI_FRAME_P95_MEDIAN_MS || '18');
const COLD_SWITCH_MEDIAN_BUDGET = Number.parseFloat(process.env.PERF_BUDGET_MULTI_COLD_SWITCH_MEDIAN_MS || '400');
const MAX_WARM_LONGTASK_MEDIAN = Number.parseInt(process.env.PERF_BUDGET_MULTI_MAX_WARM_LONGTASK_MEDIAN || '0', 10);
const MIN_CACHE_HIT_RATE = Number.parseFloat(process.env.PERF_BUDGET_MULTI_MIN_CACHE_HIT_RATE || '0.2');
const MIN_ROUNDS = Math.max(1, Number.parseInt(process.env.PERF_BUDGET_MULTI_MIN_ROUNDS || '3', 10) || 3);

function fail(msg) {
  // eslint-disable-next-line no-console
  console.error(`[perf-multi-assert] ${msg}`);
  process.exitCode = 1;
}

async function pickLatestReport() {
  const files = await fs.readdir(REPORT_DIR);
  const candidates = files.filter((f) => /^chat-perf-multi-.*\.json$/i.test(f)).sort();
  if (!candidates.length) return null;
  return path.join(REPORT_DIR, candidates[candidates.length - 1]);
}

const reportFile = await pickLatestReport().catch(() => null);
if (!reportFile) {
  fail(`No chat perf multi report found in ${REPORT_DIR}`);
  process.exit(process.exitCode || 1);
}

const report = JSON.parse(await fs.readFile(reportFile, 'utf8'));
const summary = report.summary || {};

// eslint-disable-next-line no-console
console.log(`[perf-multi-assert] using report: ${reportFile}`);
// eslint-disable-next-line no-console
console.log(
  `[perf-multi-assert] rounds=${report.roundsCompleted}/${report.roundsRequested} warmP50Median=${summary.warmSwitchP50MedianMs}ms warmP95Median=${summary.warmSwitchP95MedianMs}ms coldMedian=${summary.coldSwitchMedianMs}ms frameMedian=${summary.frameP95MedianMs}ms warmLongTaskMedian=${summary.longTaskCountWarmMedian} cacheHitRate=${summary.cacheHitRate}`,
);

if ((report.roundsCompleted || 0) < MIN_ROUNDS) {
  fail(`insufficient rounds: ${report.roundsCompleted} < ${MIN_ROUNDS}`);
}
if (Number.isFinite(WARM_SWITCH_P50_MEDIAN_BUDGET) && summary.warmSwitchP50MedianMs > WARM_SWITCH_P50_MEDIAN_BUDGET) {
  fail(`warmSwitchP50Median exceeds budget: ${summary.warmSwitchP50MedianMs} > ${WARM_SWITCH_P50_MEDIAN_BUDGET}`);
}
if (Number.isFinite(WARM_SWITCH_P95_MEDIAN_BUDGET) && summary.warmSwitchP95MedianMs > WARM_SWITCH_P95_MEDIAN_BUDGET) {
  fail(`warmSwitchP95Median exceeds budget: ${summary.warmSwitchP95MedianMs} > ${WARM_SWITCH_P95_MEDIAN_BUDGET}`);
}
if (Number.isFinite(COLD_SWITCH_MEDIAN_BUDGET) && summary.coldSwitchMedianMs > COLD_SWITCH_MEDIAN_BUDGET) {
  fail(`coldSwitchMedian exceeds budget: ${summary.coldSwitchMedianMs} > ${COLD_SWITCH_MEDIAN_BUDGET}`);
}
if (Number.isFinite(FRAME_P95_MEDIAN_BUDGET) && summary.frameP95MedianMs > FRAME_P95_MEDIAN_BUDGET) {
  fail(`frameP95Median exceeds budget: ${summary.frameP95MedianMs} > ${FRAME_P95_MEDIAN_BUDGET}`);
}
if (Number.isFinite(MAX_WARM_LONGTASK_MEDIAN) && summary.longTaskCountWarmMedian > MAX_WARM_LONGTASK_MEDIAN) {
  fail(`warm longTask median exceeds budget: ${summary.longTaskCountWarmMedian} > ${MAX_WARM_LONGTASK_MEDIAN}`);
}
if (Number.isFinite(MIN_CACHE_HIT_RATE) && summary.cacheHitRate < MIN_CACHE_HIT_RATE) {
  fail(`cacheHitRate below budget: ${summary.cacheHitRate} < ${MIN_CACHE_HIT_RATE}`);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
// eslint-disable-next-line no-console
console.log('[perf-multi-assert] OK');
