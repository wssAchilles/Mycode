import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPORT_DIR = path.resolve(process.cwd(), 'perf-reports');

const WARM_SWITCH_P50_MEDIAN_BUDGET = Number.parseFloat(process.env.PERF_BUDGET_MULTI_WARM_SWITCH_P50_MEDIAN_MS || '80');
const WARM_SWITCH_P95_MEDIAN_BUDGET = Number.parseFloat(process.env.PERF_BUDGET_MULTI_WARM_SWITCH_P95_MEDIAN_MS || '160');
const FRAME_P95_MEDIAN_BUDGET_ENV = process.env.PERF_BUDGET_MULTI_FRAME_P95_MEDIAN_MS;
const FRAME_P95_MEDIAN_TOLERANCE_MS = Number.parseFloat(process.env.PERF_BUDGET_MULTI_FRAME_P95_TOLERANCE_MS || '0.5');
const COLD_SWITCH_MEDIAN_BUDGET = Number.parseFloat(process.env.PERF_BUDGET_MULTI_COLD_SWITCH_MEDIAN_MS || '400');
const COLD_SWITCH_HIT_MEDIAN_BUDGET = Number.parseFloat(process.env.PERF_BUDGET_MULTI_COLD_SWITCH_HIT_MEDIAN_MS || '360');
const COLD_SWITCH_MISS_MEDIAN_BUDGET = Number.parseFloat(process.env.PERF_BUDGET_MULTI_COLD_SWITCH_MISS_MEDIAN_MS || '500');
const MAX_WARM_LONGTASK_MEDIAN = Number.parseInt(process.env.PERF_BUDGET_MULTI_MAX_WARM_LONGTASK_MEDIAN || '0', 10);
const MIN_CACHE_HIT_RATE = Number.parseFloat(process.env.PERF_BUDGET_MULTI_MIN_CACHE_HIT_RATE || '0.2');
const MIN_SAMPLE_COMPLETED_RATE_ENV = process.env.PERF_BUDGET_MULTI_MIN_SAMPLE_COMPLETED_RATE;
const MIN_SAMPLE_QUALITY_SCORE_ENV = process.env.PERF_BUDGET_MULTI_MIN_SAMPLE_QUALITY_SCORE;
const MAX_SAMPLE_FAILURE_RATE_ENV = process.env.PERF_BUDGET_MULTI_MAX_FAILURE_RATE;
const MAX_SAMPLE_ANOMALY_COUNT_ENV = process.env.PERF_BUDGET_MULTI_MAX_ANOMALY_COUNT;
const MAX_LEGACY_MESSAGE_REQUESTS = Math.max(
  0,
  Number.parseInt(process.env.PERF_BUDGET_MULTI_MAX_LEGACY_MESSAGE_REQUESTS || '0', 10) || 0,
);
const MIN_ROUNDS = Math.max(1, Number.parseInt(process.env.PERF_BUDGET_MULTI_MIN_ROUNDS || '3', 10) || 3);
const MIN_COLD_HIT_SAMPLES = Math.max(1, Number.parseInt(process.env.PERF_BUDGET_MULTI_MIN_COLD_HIT_SAMPLES || '2', 10) || 2);
const MIN_COLD_MISS_SAMPLES = Math.max(1, Number.parseInt(process.env.PERF_BUDGET_MULTI_MIN_COLD_MISS_SAMPLES || '2', 10) || 2);

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
const baseURL = String(report.baseURL || '');
const isLocalLabBase = /(^https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?/i.test(baseURL);
const parsedFrameBudget = Number.parseFloat(String(FRAME_P95_MEDIAN_BUDGET_ENV || '').trim());
const FRAME_P95_MEDIAN_BUDGET = Number.isFinite(parsedFrameBudget)
  ? parsedFrameBudget
  : (isLocalLabBase ? 18 : 26);
const parsedSampleQualityMin = Number.parseFloat(String(MIN_SAMPLE_QUALITY_SCORE_ENV || '').trim());
const MIN_SAMPLE_QUALITY_SCORE = Number.isFinite(parsedSampleQualityMin)
  ? parsedSampleQualityMin
  : (isLocalLabBase ? 0.72 : 0.55);
const parsedMinSampleCompletedRate = Number.parseFloat(String(MIN_SAMPLE_COMPLETED_RATE_ENV || '').trim());
const MIN_SAMPLE_COMPLETED_RATE = Number.isFinite(parsedMinSampleCompletedRate)
  ? Math.min(1, Math.max(0, parsedMinSampleCompletedRate))
  : (isLocalLabBase ? 1 : 0.7);
const parsedSampleFailureRateMax = Number.parseFloat(String(MAX_SAMPLE_FAILURE_RATE_ENV || '').trim());
const MAX_SAMPLE_FAILURE_RATE = Number.isFinite(parsedSampleFailureRateMax)
  ? Math.min(1, Math.max(0, parsedSampleFailureRateMax))
  : (isLocalLabBase ? 0.1 : 0.45);
const parsedMaxAnomalyCount = Number.parseInt(String(MAX_SAMPLE_ANOMALY_COUNT_ENV || '').trim(), 10);
const MAX_SAMPLE_ANOMALY_COUNT = Number.isFinite(parsedMaxAnomalyCount)
  ? Math.max(0, parsedMaxAnomalyCount)
  : (isLocalLabBase ? 2 : 5);
const sampleQualityScore = Number(summary?.sampleQuality?.score);
const sampleCompletedRate = Number(summary?.sampleQuality?.completedRate);
const sampleFailureRate = Number(summary?.sampleQuality?.failureRate);
const derivedFailureRate =
  Number(report?.failures?.failedRounds || 0) /
  Math.max(1, Number(report?.roundsRequested || 0) + Number(report?.warmupRoundsRequested || 0));
const effectiveSampleFailureRate = Number.isFinite(sampleFailureRate) ? sampleFailureRate : derivedFailureRate;
const anomalyCount = Array.isArray(summary?.anomalies) ? summary.anomalies.length : 0;

// eslint-disable-next-line no-console
console.log(`[perf-multi-assert] using report: ${reportFile}`);
// eslint-disable-next-line no-console
console.log(
  `[perf-multi-assert] rounds=${report.roundsCompleted}/${report.roundsRequested} warmP50Median=${summary.warmSwitchP50MedianMs}ms warmP95Median=${summary.warmSwitchP95MedianMs}ms coldMedian=${summary.coldSwitchMedianMs}ms coldHitMedian=${summary.coldSwitchMedianMsWhenHit}ms coldMissMedian=${summary.coldSwitchMedianMsWhenMiss}ms frameMedian=${summary.frameP95MedianMs}ms frameBudget=${FRAME_P95_MEDIAN_BUDGET}ms warmLongTaskMedian=${summary.longTaskCountWarmMedian} cacheHitRate=${summary.cacheHitRate} sampleQuality=${Number.isFinite(sampleQualityScore) ? sampleQualityScore.toFixed(3) : 'n/a'} anomalies=${anomalyCount} legacyReqTotal=${Number(summary.legacyMessageRequestTotal || 0)}`,
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
if (
  Number.isFinite(COLD_SWITCH_HIT_MEDIAN_BUDGET)
  && Number(summary.cacheHitRounds || 0) >= MIN_COLD_HIT_SAMPLES
  && Number.isFinite(summary.coldSwitchMedianMsWhenHit)
  && summary.coldSwitchMedianMsWhenHit > COLD_SWITCH_HIT_MEDIAN_BUDGET
) {
  fail(
    `coldSwitchMedian(hit) exceeds budget: ${summary.coldSwitchMedianMsWhenHit} > ${COLD_SWITCH_HIT_MEDIAN_BUDGET}`,
  );
}
if (
  Number.isFinite(COLD_SWITCH_MISS_MEDIAN_BUDGET)
  && Number(summary.cacheMissRounds || 0) >= MIN_COLD_MISS_SAMPLES
  && Number.isFinite(summary.coldSwitchMedianMsWhenMiss)
  && summary.coldSwitchMedianMsWhenMiss > COLD_SWITCH_MISS_MEDIAN_BUDGET
) {
  fail(
    `coldSwitchMedian(miss) exceeds budget: ${summary.coldSwitchMedianMsWhenMiss} > ${COLD_SWITCH_MISS_MEDIAN_BUDGET}`,
  );
}
if (
  Number.isFinite(FRAME_P95_MEDIAN_BUDGET)
  && summary.frameP95MedianMs > FRAME_P95_MEDIAN_BUDGET + Math.max(0, FRAME_P95_MEDIAN_TOLERANCE_MS)
) {
  fail(
    `frameP95Median exceeds budget: ${summary.frameP95MedianMs} > ${FRAME_P95_MEDIAN_BUDGET} (+${FRAME_P95_MEDIAN_TOLERANCE_MS} tolerance)`,
  );
}
if (Number.isFinite(MAX_WARM_LONGTASK_MEDIAN) && summary.longTaskCountWarmMedian > MAX_WARM_LONGTASK_MEDIAN) {
  fail(`warm longTask median exceeds budget: ${summary.longTaskCountWarmMedian} > ${MAX_WARM_LONGTASK_MEDIAN}`);
}
if (Number.isFinite(MIN_CACHE_HIT_RATE) && summary.cacheHitRate < MIN_CACHE_HIT_RATE) {
  fail(`cacheHitRate below budget: ${summary.cacheHitRate} < ${MIN_CACHE_HIT_RATE}`);
}
if (!Number.isFinite(sampleQualityScore)) {
  fail('sampleQuality.score missing from report summary');
} else if (sampleQualityScore < MIN_SAMPLE_QUALITY_SCORE) {
  fail(`sampleQuality.score below budget: ${sampleQualityScore} < ${MIN_SAMPLE_QUALITY_SCORE}`);
}
if (!Number.isFinite(sampleCompletedRate) || sampleCompletedRate < MIN_SAMPLE_COMPLETED_RATE) {
  fail(`sample completed rate below budget: ${sampleCompletedRate} < ${MIN_SAMPLE_COMPLETED_RATE}`);
}
if (Number.isFinite(effectiveSampleFailureRate) && effectiveSampleFailureRate > MAX_SAMPLE_FAILURE_RATE) {
  fail(`sample failure rate above budget: ${effectiveSampleFailureRate} > ${MAX_SAMPLE_FAILURE_RATE}`);
}
if (anomalyCount > MAX_SAMPLE_ANOMALY_COUNT) {
  fail(`sample anomaly count above budget: ${anomalyCount} > ${MAX_SAMPLE_ANOMALY_COUNT}`);
}
if (Number(summary.legacyMessageRequestTotal || 0) > MAX_LEGACY_MESSAGE_REQUESTS) {
  fail(
    `legacy message request count above budget: ${summary.legacyMessageRequestTotal} > ${MAX_LEGACY_MESSAGE_REQUESTS}`,
  );
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
// eslint-disable-next-line no-console
console.log('[perf-multi-assert] OK');
