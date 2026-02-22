import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPORT_DIR = path.resolve(process.cwd(), 'perf-reports');
const E2E_HISTORY_LIMIT = Math.max(
  2,
  Number.parseInt(process.env.PERF_REPORT_E2E_HISTORY_LIMIT || '8', 10) || 8,
);
const CAPACITY_HISTORY_LIMIT = Math.max(
  2,
  Number.parseInt(process.env.PERF_REPORT_CAPACITY_HISTORY_LIMIT || '8', 10) || 8,
);
const REALDATA_HISTORY_LIMIT = Math.max(
  2,
  Number.parseInt(process.env.PERF_REPORT_REALDATA_HISTORY_LIMIT || '8', 10) || 8,
);

const WARM_SWITCH_P50_MEDIAN_BUDGET = Number.parseFloat(
  process.env.PERF_BUDGET_MULTI_WARM_SWITCH_P50_MEDIAN_MS || '80',
);
const FRAME_P95_MEDIAN_BUDGET = Number.parseFloat(
  process.env.PERF_BUDGET_MULTI_FRAME_P95_MEDIAN_MS || '26',
);
const E2E_MAX_WARM_LONGTASK_MEDIAN = Number.parseInt(
  process.env.PERF_BUDGET_MULTI_MAX_WARM_LONGTASK_MEDIAN || '0',
  10,
);
const E2E_COLD_SWITCH_HIT_MEDIAN_BUDGET = Number.parseFloat(
  process.env.PERF_BUDGET_MULTI_COLD_SWITCH_HIT_MEDIAN_MS || '360',
);
const E2E_COLD_SWITCH_MISS_MEDIAN_BUDGET = Number.parseFloat(
  process.env.PERF_BUDGET_MULTI_COLD_SWITCH_MISS_MEDIAN_MS || '500',
);
const E2E_MIN_COLD_HIT_SAMPLES = Math.max(
  1,
  Number.parseInt(process.env.PERF_BUDGET_MULTI_MIN_COLD_HIT_SAMPLES || '2', 10) || 2,
);
const E2E_MIN_COLD_MISS_SAMPLES = Math.max(
  1,
  Number.parseInt(process.env.PERF_BUDGET_MULTI_MIN_COLD_MISS_SAMPLES || '2', 10) || 2,
);
const E2E_MIN_SAMPLE_QUALITY_SCORE = Number.parseFloat(
  process.env.PERF_BUDGET_MULTI_MIN_SAMPLE_QUALITY_SCORE || '0.55',
);
const parsedE2eMinSampleCompletedRate = Number.parseFloat(String(process.env.PERF_BUDGET_MULTI_MIN_SAMPLE_COMPLETED_RATE || '').trim());
const E2E_MIN_SAMPLE_COMPLETED_RATE = Math.min(
  1,
  Math.max(0, Number.isFinite(parsedE2eMinSampleCompletedRate) ? parsedE2eMinSampleCompletedRate : 0.7),
);
const E2E_MAX_SAMPLE_FAILURE_RATE = Math.min(
  1,
  Math.max(0, Number.parseFloat(process.env.PERF_BUDGET_MULTI_MAX_FAILURE_RATE || '0.45') || 0.45),
);
const E2E_MAX_SAMPLE_ANOMALY_COUNT = Math.max(
  0,
  Number.parseInt(process.env.PERF_BUDGET_MULTI_MAX_ANOMALY_COUNT || '5', 10) || 5,
);
const E2E_MAX_LEGACY_MESSAGE_REQUESTS = Math.max(
  0,
  Number.parseInt(process.env.PERF_BUDGET_MULTI_MAX_LEGACY_MESSAGE_REQUESTS || '0', 10) || 0,
);

const CAP_SMOOTH_BATCH_P95_MEDIAN_BUDGET = Number.parseFloat(
  process.env.PERF_BUDGET_CAPACITY_SMOOTH_BATCH_P95_MEDIAN_MS || '18',
);
const CAP_TOTAL_ROUND_MEDIAN_BUDGET = Number.parseFloat(
  process.env.PERF_BUDGET_CAPACITY_TOTAL_ROUND_MEDIAN_MS || '7000',
);
const REALDATA_CURSOR_P95_BUDGET = Number.parseFloat(
  process.env.PERF_BUDGET_REALDATA_CURSOR_P95_MS || '1500',
);
const REALDATA_CURSOR_FIRST_PAGE_P95_BUDGET = Number.parseFloat(
  process.env.PERF_BUDGET_REALDATA_CURSOR_FIRST_PAGE_P95_MS || '1700',
);
const REALDATA_SYNC_STATE_P95_BUDGET = Number.parseFloat(
  process.env.PERF_BUDGET_REALDATA_SYNC_STATE_P95_MS || '1200',
);
const REALDATA_SYNC_DIFF_P95_BUDGET = Number.parseFloat(
  process.env.PERF_BUDGET_REALDATA_SYNC_DIFF_P95_MS || '1500',
);
const REALDATA_MIN_TARGETS_BUDGET = Math.max(
  1,
  Number.parseInt(process.env.PERF_BUDGET_REALDATA_MIN_TARGETS || '1', 10) || 1,
);

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseReportStamp(name, fallback) {
  const m = name.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
  if (!m) return fallback;
  return m[1].replace('T', ' ').replace(/-/g, ':').replace(':', '-').slice(5, 16);
}

function formatAxisLabel(isoOrFile, fallback = '-') {
  if (!isoOrFile) return fallback;
  const date = new Date(isoOrFile);
  if (!Number.isNaN(date.getTime())) {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${min}`;
  }
  return parseReportStamp(String(isoOrFile), fallback);
}

function chartYMax(values, fallback = 100) {
  if (!values.length) return fallback;
  const max = Math.max(...values.map((v) => toNum(v, 0)));
  if (!Number.isFinite(max) || max <= 0) return fallback;
  if (max < 10) return 10;
  if (max < 50) return Math.ceil(max + 10);
  if (max < 100) return Math.ceil(max + 20);
  return Math.ceil(max * 1.15);
}

function toMermaidXYChart({ title, yAxisLabel, labels, values }) {
  if (!labels.length || !values.length) {
    return '_No data_';
  }
  const safeLabels = labels.map((label) => String(label).replace(/"/g, "'"));
  const safeValues = values.map((value) => Number(toNum(value, 0).toFixed(2)));
  const yMax = chartYMax(safeValues);

  return [
    '```mermaid',
    'xychart-beta',
    `  title "${String(title).replace(/"/g, "'")}"`,
    `  x-axis ["${safeLabels.join('", "')}"]`,
    `  y-axis "${String(yAxisLabel).replace(/"/g, "'")}" 0 --> ${yMax}`,
    `  line [${safeValues.join(', ')}]`,
    '```',
  ].join('\n');
}

async function readReportsByPattern(regex, limit) {
  const entries = await fs.readdir(REPORT_DIR).catch(() => []);
  const files = entries
    .filter((name) => regex.test(name) && !/latest\.json$/i.test(name))
    .sort();
  const selected = files.slice(-limit);
  const parsed = [];

  for (const name of selected) {
    const fullPath = path.join(REPORT_DIR, name);
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      parsed.push({
        file: fullPath,
        name,
        json: JSON.parse(content),
      });
    } catch {
      // ignore malformed files
    }
  }
  return parsed;
}

function evaluateE2EGate(latest) {
  const summary = latest?.json?.summary || {};
  const rounds = toNum(latest?.json?.roundsCompleted, 0);
  const warm = toNum(summary.warmSwitchP50MedianMs, Number.POSITIVE_INFINITY);
  const frame = toNum(summary.frameP95MedianMs, Number.POSITIVE_INFINITY);
  const warmLongTaskMedian = toNum(summary.longTaskCountWarmMedian, Number.POSITIVE_INFINITY);
  const cacheHitRounds = toNum(summary.cacheHitRounds, 0);
  const cacheMissRounds = toNum(summary.cacheMissRounds, 0);
  const coldHitMedian = toNum(summary.coldSwitchMedianMsWhenHit, Number.POSITIVE_INFINITY);
  const coldMissMedian = toNum(summary.coldSwitchMedianMsWhenMiss, Number.POSITIVE_INFINITY);
  const sampleQualityScore = toNum(summary.sampleQuality?.score, -1);
  const sampleCompletedRate = toNum(summary.sampleQuality?.completedRate, 0);
  const sampleFailureRate = toNum(summary.sampleQuality?.failureRate, Number.POSITIVE_INFINITY);
  const anomalyCount = Array.isArray(summary.anomalies) ? summary.anomalies.length : 0;
  const legacyMessageRequestTotal = toNum(summary.legacyMessageRequestTotal, 0);
  const reasons = [];
  if (rounds < 3) reasons.push(`rounds<3 (${rounds})`);
  if (warm > WARM_SWITCH_P50_MEDIAN_BUDGET) {
    reasons.push(`warmP50>${WARM_SWITCH_P50_MEDIAN_BUDGET} (${warm.toFixed(2)})`);
  }
  if (frame > FRAME_P95_MEDIAN_BUDGET) {
    reasons.push(`frameP95>${FRAME_P95_MEDIAN_BUDGET} (${frame.toFixed(2)})`);
  }
  if (warmLongTaskMedian > E2E_MAX_WARM_LONGTASK_MEDIAN) {
    reasons.push(`warmLongTask>${E2E_MAX_WARM_LONGTASK_MEDIAN} (${warmLongTaskMedian.toFixed(2)})`);
  }
  if (
    cacheHitRounds >= E2E_MIN_COLD_HIT_SAMPLES &&
    coldHitMedian > E2E_COLD_SWITCH_HIT_MEDIAN_BUDGET
  ) {
    reasons.push(`coldHit>${E2E_COLD_SWITCH_HIT_MEDIAN_BUDGET} (${coldHitMedian.toFixed(2)})`);
  }
  if (
    cacheMissRounds >= E2E_MIN_COLD_MISS_SAMPLES &&
    coldMissMedian > E2E_COLD_SWITCH_MISS_MEDIAN_BUDGET
  ) {
    reasons.push(`coldMiss>${E2E_COLD_SWITCH_MISS_MEDIAN_BUDGET} (${coldMissMedian.toFixed(2)})`);
  }
  if (sampleQualityScore < E2E_MIN_SAMPLE_QUALITY_SCORE) {
    reasons.push(`sampleQuality<${E2E_MIN_SAMPLE_QUALITY_SCORE} (${sampleQualityScore.toFixed(3)})`);
  }
  if (sampleCompletedRate < E2E_MIN_SAMPLE_COMPLETED_RATE) {
    reasons.push(`sampleCompletedRate<${E2E_MIN_SAMPLE_COMPLETED_RATE} (${sampleCompletedRate.toFixed(3)})`);
  }
  if (sampleFailureRate > E2E_MAX_SAMPLE_FAILURE_RATE) {
    reasons.push(`sampleFailureRate>${E2E_MAX_SAMPLE_FAILURE_RATE} (${sampleFailureRate.toFixed(3)})`);
  }
  if (anomalyCount > E2E_MAX_SAMPLE_ANOMALY_COUNT) {
    reasons.push(`anomalies>${E2E_MAX_SAMPLE_ANOMALY_COUNT} (${anomalyCount})`);
  }
  if (legacyMessageRequestTotal > E2E_MAX_LEGACY_MESSAGE_REQUESTS) {
    reasons.push(`legacyMessageRequests>${E2E_MAX_LEGACY_MESSAGE_REQUESTS} (${legacyMessageRequestTotal})`);
  }
  return {
    pass: reasons.length === 0,
    reasons,
    metrics: {
      roundsCompleted: rounds,
      warmSwitchP50MedianMs: warm,
      frameP95MedianMs: frame,
      longTaskCountWarmMedian: warmLongTaskMedian,
      cacheHitRounds,
      cacheMissRounds,
      coldSwitchMedianMsWhenHit: coldHitMedian,
      coldSwitchMedianMsWhenMiss: coldMissMedian,
      sampleQualityScore,
      sampleCompletedRate,
      sampleFailureRate,
      sampleAnomalyCount: anomalyCount,
      legacyMessageRequestTotal,
    },
  };
}

function evaluateCapacityGate(latest) {
  const summary = latest?.json?.summary || {};
  const rounds = toNum(summary.roundsCompleted, 0);
  const smooth = toNum(summary.smoothBatchP95MedianMs, Number.POSITIVE_INFINITY);
  const total = toNum(summary.totalRoundMedianMs, Number.POSITIVE_INFINITY);
  const integrity = toNum(summary.integrityPassRate, 0);
  const status = String(summary.status || '').toLowerCase();
  const reasons = [];
  if (rounds < 3) reasons.push(`rounds<3 (${rounds})`);
  if (integrity !== 1) reasons.push(`integrityPassRate!=1 (${integrity})`);
  if (smooth > CAP_SMOOTH_BATCH_P95_MEDIAN_BUDGET) {
    reasons.push(`smoothP95>${CAP_SMOOTH_BATCH_P95_MEDIAN_BUDGET} (${smooth.toFixed(2)})`);
  }
  if (total > CAP_TOTAL_ROUND_MEDIAN_BUDGET) {
    reasons.push(`totalMedian>${CAP_TOTAL_ROUND_MEDIAN_BUDGET} (${total.toFixed(2)})`);
  }
  if (status !== 'pass') reasons.push(`status!=pass (${status || 'unknown'})`);
  return {
    pass: reasons.length === 0,
    reasons,
    metrics: {
      roundsCompleted: rounds,
      smoothBatchP95MedianMs: smooth,
      totalRoundMedianMs: total,
      integrityPassRate: integrity,
      status,
    },
  };
}

function evaluateRealdataGate(latest) {
  const summary = latest?.json?.summary || {};
  const status = String(summary.status || '').toLowerCase();
  const targets = toNum(summary.targetsDiscovered, 0);
  const cursorP95 = toNum(summary.cursorP95Ms, Number.POSITIVE_INFINITY);
  const cursorFirstPageP95 = toNum(summary.cursorFirstPageP95Ms, Number.POSITIVE_INFINITY);
  const syncStateP95 = toNum(summary.syncStateP95Ms, Number.POSITIVE_INFINITY);
  const syncDiffP95 = toNum(summary.syncDiffP95Ms, Number.POSITIVE_INFINITY);
  const cursorContractMismatch = toNum(summary.cursorContractMismatchCount, 0);
  const cursorOrderingViolation = toNum(summary.cursorOrderingViolationCount, 0);
  const cursorDuplicateViolation = toNum(summary.cursorDuplicateSeqViolationCount, 0);
  const syncContractMismatch = toNum(summary.syncContractMismatchCount, 0);
  const cursorFailedRequest = toNum(summary.cursorFailedRequestCount, 0);
  const syncFailedRequest = toNum(summary.syncFailedRequestCount, 0);
  const reasons = [];

  if (status !== 'pass') reasons.push(`status!=pass (${status || 'unknown'})`);
  if (targets < REALDATA_MIN_TARGETS_BUDGET) reasons.push(`targets<${REALDATA_MIN_TARGETS_BUDGET} (${targets})`);
  if (cursorP95 > REALDATA_CURSOR_P95_BUDGET) {
    reasons.push(`cursorP95>${REALDATA_CURSOR_P95_BUDGET} (${cursorP95.toFixed(2)})`);
  }
  if (cursorFirstPageP95 > REALDATA_CURSOR_FIRST_PAGE_P95_BUDGET) {
    reasons.push(`cursorFirstPageP95>${REALDATA_CURSOR_FIRST_PAGE_P95_BUDGET} (${cursorFirstPageP95.toFixed(2)})`);
  }
  if (syncStateP95 > REALDATA_SYNC_STATE_P95_BUDGET) {
    reasons.push(`syncStateP95>${REALDATA_SYNC_STATE_P95_BUDGET} (${syncStateP95.toFixed(2)})`);
  }
  if (syncDiffP95 > REALDATA_SYNC_DIFF_P95_BUDGET) {
    reasons.push(`syncDiffP95>${REALDATA_SYNC_DIFF_P95_BUDGET} (${syncDiffP95.toFixed(2)})`);
  }
  if (cursorContractMismatch > 0) reasons.push(`cursorContractMismatch>0 (${cursorContractMismatch})`);
  if (cursorOrderingViolation > 0) reasons.push(`cursorOrderingViolation>0 (${cursorOrderingViolation})`);
  if (cursorDuplicateViolation > 0) reasons.push(`cursorDuplicateViolation>0 (${cursorDuplicateViolation})`);
  if (syncContractMismatch > 0) reasons.push(`syncContractMismatch>0 (${syncContractMismatch})`);
  if (cursorFailedRequest > 0) reasons.push(`cursorFailedRequest>0 (${cursorFailedRequest})`);
  if (syncFailedRequest > 0) reasons.push(`syncFailedRequest>0 (${syncFailedRequest})`);
  if (summary.fatalError) reasons.push(`fatalError=${summary.fatalError}`);

  return {
    pass: reasons.length === 0,
    reasons,
    metrics: {
      status,
      targetsDiscovered: targets,
      cursorP95Ms: cursorP95,
      cursorFirstPageP95Ms: cursorFirstPageP95,
      syncStateP95Ms: syncStateP95,
      syncDiffP95Ms: syncDiffP95,
      cursorContractMismatchCount: cursorContractMismatch,
      cursorOrderingViolationCount: cursorOrderingViolation,
      cursorDuplicateSeqViolationCount: cursorDuplicateViolation,
      syncContractMismatchCount: syncContractMismatch,
      cursorFailedRequestCount: cursorFailedRequest,
      syncFailedRequestCount: syncFailedRequest,
      fatalError: summary.fatalError || null,
    },
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const [e2eReports, capacityReports, realdataReports] = await Promise.all([
    readReportsByPattern(/^chat-perf-multi-.*\.json$/i, E2E_HISTORY_LIMIT),
    readReportsByPattern(/^chat-capacity-perf-.*\.json$/i, CAPACITY_HISTORY_LIMIT),
    readReportsByPattern(/^chat-realdata-stress-.*\.json$/i, REALDATA_HISTORY_LIMIT),
  ]);

  if (!e2eReports.length) {
    throw new Error(`no e2e multi reports found in ${REPORT_DIR}`);
  }
  if (!capacityReports.length) {
    throw new Error(`no capacity reports found in ${REPORT_DIR}`);
  }
  if (!realdataReports.length) {
    throw new Error(`no realdata stress reports found in ${REPORT_DIR}`);
  }

  const latestE2E = e2eReports[e2eReports.length - 1];
  const latestCapacity = capacityReports[capacityReports.length - 1];
  const latestRealdata = realdataReports[realdataReports.length - 1];

  const e2eGate = evaluateE2EGate(latestE2E);
  const capacityGate = evaluateCapacityGate(latestCapacity);
  const realdataGate = evaluateRealdataGate(latestRealdata);
  const overallPass = e2eGate.pass && capacityGate.pass && realdataGate.pass;

  const e2eWarmSeries = e2eReports.map((item) => ({
    label: formatAxisLabel(item.json?.runAt, parseReportStamp(item.name, item.name)),
    value: toNum(item.json?.summary?.warmSwitchP50MedianMs, 0),
  }));
  const e2eFrameSeries = e2eReports.map((item) => ({
    label: formatAxisLabel(item.json?.runAt, parseReportStamp(item.name, item.name)),
    value: toNum(item.json?.summary?.frameP95MedianMs, 0),
  }));
  const e2eSampleQualitySeries = e2eReports.map((item) => ({
    label: formatAxisLabel(item.json?.runAt, parseReportStamp(item.name, item.name)),
    value: toNum(item.json?.summary?.sampleQuality?.score, 0),
  }));
  const capSmoothSeries = capacityReports.map((item) => ({
    label: formatAxisLabel(item.json?.runAt, parseReportStamp(item.name, item.name)),
    value: toNum(item.json?.summary?.smoothBatchP95MedianMs, 0),
  }));
  const capTotalSeries = capacityReports.map((item) => ({
    label: formatAxisLabel(item.json?.runAt, parseReportStamp(item.name, item.name)),
    value: toNum(item.json?.summary?.totalRoundMedianMs, 0),
  }));
  const realdataCursorSeries = realdataReports.map((item) => ({
    label: formatAxisLabel(item.json?.runAt, parseReportStamp(item.name, item.name)),
    value: toNum(item.json?.summary?.cursorP95Ms, 0),
  }));
  const realdataSyncDiffSeries = realdataReports.map((item) => ({
    label: formatAxisLabel(item.json?.runAt, parseReportStamp(item.name, item.name)),
    value: toNum(item.json?.summary?.syncDiffP95Ms, 0),
  }));

  const payload = {
    runAt: new Date().toISOString(),
    latest: {
      e2e: {
        file: latestE2E.file,
        summary: latestE2E.json?.summary || {},
        baseURL: latestE2E.json?.baseURL || '',
      },
      capacity: {
        file: latestCapacity.file,
        summary: latestCapacity.json?.summary || {},
        profile: latestCapacity.json?.profile || {},
      },
      realdata: {
        file: latestRealdata.file,
        summary: latestRealdata.json?.summary || {},
        profile: latestRealdata.json?.profile || {},
      },
    },
    gates: {
      e2e: e2eGate,
      capacity: capacityGate,
      realdata: realdataGate,
      overallPass,
    },
    budgets: {
      e2e: {
        warmSwitchP50MedianMs: WARM_SWITCH_P50_MEDIAN_BUDGET,
        frameP95MedianMs: FRAME_P95_MEDIAN_BUDGET,
        warmLongTaskMedian: E2E_MAX_WARM_LONGTASK_MEDIAN,
        coldSwitchHitMedianMs: E2E_COLD_SWITCH_HIT_MEDIAN_BUDGET,
        coldSwitchMissMedianMs: E2E_COLD_SWITCH_MISS_MEDIAN_BUDGET,
        minSampleQualityScore: E2E_MIN_SAMPLE_QUALITY_SCORE,
        minSampleCompletedRate: E2E_MIN_SAMPLE_COMPLETED_RATE,
        maxSampleFailureRate: E2E_MAX_SAMPLE_FAILURE_RATE,
        maxSampleAnomalyCount: E2E_MAX_SAMPLE_ANOMALY_COUNT,
        maxLegacyMessageRequests: E2E_MAX_LEGACY_MESSAGE_REQUESTS,
      },
      capacity: {
        smoothBatchP95MedianMs: CAP_SMOOTH_BATCH_P95_MEDIAN_BUDGET,
        totalRoundMedianMs: CAP_TOTAL_ROUND_MEDIAN_BUDGET,
      },
      realdata: {
        cursorP95Ms: REALDATA_CURSOR_P95_BUDGET,
        cursorFirstPageP95Ms: REALDATA_CURSOR_FIRST_PAGE_P95_BUDGET,
        syncStateP95Ms: REALDATA_SYNC_STATE_P95_BUDGET,
        syncDiffP95Ms: REALDATA_SYNC_DIFF_P95_BUDGET,
        minTargets: REALDATA_MIN_TARGETS_BUDGET,
      },
    },
    series: {
      e2eWarmSwitchP50MedianMs: e2eWarmSeries,
      e2eFrameP95MedianMs: e2eFrameSeries,
      e2eSampleQualityScore: e2eSampleQualitySeries,
      capacitySmoothBatchP95MedianMs: capSmoothSeries,
      capacityTotalRoundMedianMs: capTotalSeries,
      realdataCursorP95Ms: realdataCursorSeries,
      realdataSyncDiffP95Ms: realdataSyncDiffSeries,
    },
  };

  const reportTitle = overallPass ? 'PASS' : 'FAIL';
  const md = [
    '# Chat Performance Regression Report',
    '',
    `- Generated At: ${payload.runAt}`,
    `- Overall Gate: **${reportTitle}**`,
    `- Latest E2E Multi: \`${path.basename(latestE2E.file)}\``,
    `- Latest Capacity: \`${path.basename(latestCapacity.file)}\``,
    `- Latest Realdata Stress: \`${path.basename(latestRealdata.file)}\``,
    '',
    '## Gate Snapshot',
    '',
    '| Gate | Status | Notes |',
    '| --- | --- | --- |',
    `| E2E Multi | ${e2eGate.pass ? 'PASS' : 'FAIL'} | ${e2eGate.reasons.length ? e2eGate.reasons.join('; ') : 'within budget'} |`,
    `| Capacity 10k/50k | ${capacityGate.pass ? 'PASS' : 'FAIL'} | ${capacityGate.reasons.length ? capacityGate.reasons.join('; ') : 'within budget'} |`,
    `| Realdata Cursor/Sync | ${realdataGate.pass ? 'PASS' : 'FAIL'} | ${realdataGate.reasons.length ? realdataGate.reasons.join('; ') : 'within budget'} |`,
    '',
    '## E2E Trend (Median of Multi-Round)',
    '',
    toMermaidXYChart({
      title: 'Warm Switch P50 Median (ms)',
      yAxisLabel: 'ms',
      labels: e2eWarmSeries.map((item) => item.label),
      values: e2eWarmSeries.map((item) => item.value),
    }),
    '',
    toMermaidXYChart({
      title: 'Frame P95 Median (ms)',
      yAxisLabel: 'ms',
      labels: e2eFrameSeries.map((item) => item.label),
      values: e2eFrameSeries.map((item) => item.value),
    }),
    '',
    toMermaidXYChart({
      title: 'Sample Quality Score',
      yAxisLabel: 'score',
      labels: e2eSampleQualitySeries.map((item) => item.label),
      values: e2eSampleQualitySeries.map((item) => item.value),
    }),
    '',
    '## Capacity Trend (10k smooth / 50k usable)',
    '',
    toMermaidXYChart({
      title: 'Rolling Batch P95 Median (ms)',
      yAxisLabel: 'ms',
      labels: capSmoothSeries.map((item) => item.label),
      values: capSmoothSeries.map((item) => item.value),
    }),
    '',
    toMermaidXYChart({
      title: 'Total Round Median (ms)',
      yAxisLabel: 'ms',
      labels: capTotalSeries.map((item) => item.label),
      values: capTotalSeries.map((item) => item.value),
    }),
    '',
    '## Realdata Trend (Cursor/Sync on Remote Dataset)',
    '',
    toMermaidXYChart({
      title: 'Realdata Cursor P95 (ms)',
      yAxisLabel: 'ms',
      labels: realdataCursorSeries.map((item) => item.label),
      values: realdataCursorSeries.map((item) => item.value),
    }),
    '',
    toMermaidXYChart({
      title: 'Realdata Sync Difference P95 (ms)',
      yAxisLabel: 'ms',
      labels: realdataSyncDiffSeries.map((item) => item.label),
      values: realdataSyncDiffSeries.map((item) => item.value),
    }),
    '',
    '## Latest Metrics',
    '',
    '| Metric | Value | Budget |',
    '| --- | --- | --- |',
    `| E2E warm switch P50 median | ${toNum(payload.latest.e2e.summary.warmSwitchP50MedianMs, 0).toFixed(2)} ms | <= ${WARM_SWITCH_P50_MEDIAN_BUDGET} ms |`,
    `| E2E frame P95 median | ${toNum(payload.latest.e2e.summary.frameP95MedianMs, 0).toFixed(2)} ms | <= ${FRAME_P95_MEDIAN_BUDGET} ms |`,
    `| E2E cold switch median (cache hit) | ${toNum(payload.latest.e2e.summary.coldSwitchMedianMsWhenHit, 0).toFixed(2)} ms | <= ${E2E_COLD_SWITCH_HIT_MEDIAN_BUDGET} ms (if hit samples >= ${E2E_MIN_COLD_HIT_SAMPLES}) |`,
    `| E2E cold switch median (cache miss) | ${toNum(payload.latest.e2e.summary.coldSwitchMedianMsWhenMiss, 0).toFixed(2)} ms | <= ${E2E_COLD_SWITCH_MISS_MEDIAN_BUDGET} ms (if miss samples >= ${E2E_MIN_COLD_MISS_SAMPLES}) |`,
    `| E2E sample quality score | ${toNum(payload.latest.e2e.summary.sampleQuality?.score, 0).toFixed(3)} | >= ${E2E_MIN_SAMPLE_QUALITY_SCORE} |`,
    `| E2E sample anomaly count | ${Array.isArray(payload.latest.e2e.summary.anomalies) ? payload.latest.e2e.summary.anomalies.length : 0} | <= ${E2E_MAX_SAMPLE_ANOMALY_COUNT} |`,
    `| E2E legacy message requests | ${toNum(payload.latest.e2e.summary.legacyMessageRequestTotal, 0).toFixed(0)} | <= ${E2E_MAX_LEGACY_MESSAGE_REQUESTS} |`,
    `| Capacity rolling batch P95 median | ${toNum(payload.latest.capacity.summary.smoothBatchP95MedianMs, 0).toFixed(2)} ms | <= ${CAP_SMOOTH_BATCH_P95_MEDIAN_BUDGET} ms |`,
    `| Capacity total round median | ${toNum(payload.latest.capacity.summary.totalRoundMedianMs, 0).toFixed(2)} ms | <= ${CAP_TOTAL_ROUND_MEDIAN_BUDGET} ms |`,
    `| Realdata cursor P95 | ${toNum(payload.latest.realdata.summary.cursorP95Ms, 0).toFixed(2)} ms | <= ${REALDATA_CURSOR_P95_BUDGET} ms |`,
    `| Realdata cursor first-page P95 | ${toNum(payload.latest.realdata.summary.cursorFirstPageP95Ms, 0).toFixed(2)} ms | <= ${REALDATA_CURSOR_FIRST_PAGE_P95_BUDGET} ms |`,
    `| Realdata sync state P95 | ${toNum(payload.latest.realdata.summary.syncStateP95Ms, 0).toFixed(2)} ms | <= ${REALDATA_SYNC_STATE_P95_BUDGET} ms |`,
    `| Realdata sync difference P95 | ${toNum(payload.latest.realdata.summary.syncDiffP95Ms, 0).toFixed(2)} ms | <= ${REALDATA_SYNC_DIFF_P95_BUDGET} ms |`,
    `| Realdata targets discovered | ${toNum(payload.latest.realdata.summary.targetsDiscovered, 0).toFixed(0)} | >= ${REALDATA_MIN_TARGETS_BUDGET} |`,
    '',
  ].join('\n');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonFile = path.join(REPORT_DIR, `chat-regression-${stamp}.json`);
  const mdFile = path.join(REPORT_DIR, `chat-regression-${stamp}.md`);
  const latestJson = path.join(REPORT_DIR, 'chat-regression-latest.json');
  const latestMd = path.join(REPORT_DIR, 'chat-regression-latest.md');

  await Promise.all([
    fs.writeFile(jsonFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8'),
    fs.writeFile(mdFile, `${md}\n`, 'utf8'),
    fs.writeFile(latestJson, `${JSON.stringify(payload, null, 2)}\n`, 'utf8'),
    fs.writeFile(latestMd, `${md}\n`, 'utf8'),
  ]);

  // eslint-disable-next-line no-console
  console.log(`[perf-report] wrote: ${jsonFile}`);
  // eslint-disable-next-line no-console
  console.log(`[perf-report] wrote: ${mdFile}`);
  // eslint-disable-next-line no-console
  console.log(`[perf-report] latest json: ${latestJson}`);
  // eslint-disable-next-line no-console
  console.log(`[perf-report] latest markdown: ${latestMd}`);
  // eslint-disable-next-line no-console
  console.log(`[perf-report] overall gate: ${overallPass ? 'PASS' : 'FAIL'}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[perf-report] failed:', error?.message || error);
  process.exit(1);
});
