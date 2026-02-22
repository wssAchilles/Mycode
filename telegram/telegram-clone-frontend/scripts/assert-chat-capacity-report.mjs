import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPORT_DIR = path.resolve(process.cwd(), 'perf-reports');

const SMOOTH_BATCH_P95_MEDIAN_BUDGET = Number.parseFloat(
  process.env.PERF_BUDGET_CAPACITY_SMOOTH_BATCH_P95_MEDIAN_MS || '18',
);
const TOTAL_ROUND_MEDIAN_BUDGET = Number.parseFloat(
  process.env.PERF_BUDGET_CAPACITY_TOTAL_ROUND_MEDIAN_MS || '7000',
);
const MAX_BATCH_OBSERVED_BUDGET = Number.parseFloat(
  process.env.PERF_BUDGET_CAPACITY_MAX_BATCH_OBSERVED_MS || '120',
);
const MIN_ROUNDS = Math.max(
  1,
  Number.parseInt(process.env.PERF_BUDGET_CAPACITY_MIN_ROUNDS || '3', 10) || 3,
);
const MIN_SMOOTH_PASS_RATE = Math.min(
  1,
  Math.max(0, Number.parseFloat(process.env.PERF_BUDGET_CAPACITY_MIN_SMOOTH_PASS_RATE || '1') || 1),
);
const MIN_USABLE_PASS_RATE = Math.min(
  1,
  Math.max(0, Number.parseFloat(process.env.PERF_BUDGET_CAPACITY_MIN_USABLE_PASS_RATE || '1') || 1),
);

function fail(msg) {
  // eslint-disable-next-line no-console
  console.error(`[capacity-assert] ${msg}`);
  process.exitCode = 1;
}

async function pickLatestReport() {
  const files = await fs.readdir(REPORT_DIR);
  const candidates = files
    .filter(
      (name) =>
        /^chat-capacity-perf-.*\.json$/i.test(name) &&
        !/^chat-capacity-perf-latest\.json$/i.test(name),
    )
    .sort();
  if (!candidates.length) return null;
  return path.join(REPORT_DIR, candidates[candidates.length - 1]);
}

const reportFile = await pickLatestReport().catch(() => null);
if (!reportFile) {
  fail(`No chat capacity report found in ${REPORT_DIR}`);
  process.exit(process.exitCode || 1);
}

const report = JSON.parse(await fs.readFile(reportFile, 'utf8'));
const summary = report.summary || {};
const profile = report.profile || {};

// eslint-disable-next-line no-console
console.log(`[capacity-assert] using report: ${reportFile}`);
// eslint-disable-next-line no-console
console.log(
  `[capacity-assert] rounds=${summary.roundsCompleted}/${profile.rounds} smoothP95Median=${summary.smoothBatchP95MedianMs}ms smoothP99Median=${summary.smoothBatchP99MedianMs}ms totalMedian=${summary.totalRoundMedianMs}ms maxBatchObserved=${summary.maxBatchObservedMs}ms smoothPassRate=${summary.smoothPassRate} usablePassRate=${summary.usablePassRate} integrityPassRate=${summary.integrityPassRate} status=${summary.status}`,
);

if ((summary.roundsCompleted || 0) < MIN_ROUNDS) {
  fail(`insufficient rounds: ${summary.roundsCompleted} < ${MIN_ROUNDS}`);
}
if (summary.integrityPassRate !== 1) {
  fail(`integrityPassRate must be 1, got ${summary.integrityPassRate}`);
}
if (
  Number.isFinite(SMOOTH_BATCH_P95_MEDIAN_BUDGET) &&
  Number(summary.smoothBatchP95MedianMs || 0) > SMOOTH_BATCH_P95_MEDIAN_BUDGET
) {
  fail(
    `smoothBatchP95Median exceeds budget: ${summary.smoothBatchP95MedianMs} > ${SMOOTH_BATCH_P95_MEDIAN_BUDGET}`,
  );
}
if (
  Number.isFinite(TOTAL_ROUND_MEDIAN_BUDGET) &&
  Number(summary.totalRoundMedianMs || 0) > TOTAL_ROUND_MEDIAN_BUDGET
) {
  fail(
    `totalRoundMedian exceeds budget: ${summary.totalRoundMedianMs} > ${TOTAL_ROUND_MEDIAN_BUDGET}`,
  );
}
if (
  Number.isFinite(MAX_BATCH_OBSERVED_BUDGET) &&
  Number(summary.maxBatchObservedMs || 0) > MAX_BATCH_OBSERVED_BUDGET
) {
  fail(
    `maxBatchObserved exceeds budget: ${summary.maxBatchObservedMs} > ${MAX_BATCH_OBSERVED_BUDGET}`,
  );
}
if (Number(summary.smoothPassRate || 0) < MIN_SMOOTH_PASS_RATE) {
  fail(`smoothPassRate below budget: ${summary.smoothPassRate} < ${MIN_SMOOTH_PASS_RATE}`);
}
if (Number(summary.usablePassRate || 0) < MIN_USABLE_PASS_RATE) {
  fail(`usablePassRate below budget: ${summary.usablePassRate} < ${MIN_USABLE_PASS_RATE}`);
}
if (String(summary.status || '').toLowerCase() !== 'pass') {
  fail(`status should be pass, got ${summary.status}`);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
// eslint-disable-next-line no-console
console.log('[capacity-assert] OK');
