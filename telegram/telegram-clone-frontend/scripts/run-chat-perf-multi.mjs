import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const REPORT_DIR = path.resolve(process.cwd(), 'perf-reports');
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
const IS_LOCAL_BASE = /(^https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?/i.test(BASE_URL);
const PROFILE = String(process.env.PERF_MULTI_PROFILE || (IS_LOCAL_BASE ? 'local' : 'remote')).trim().toLowerCase();

const PROFILE_DEFAULTS = {
  local: { measureRounds: 5, warmupRounds: 1, maxFailedRounds: 0 },
  remote: { measureRounds: 5, warmupRounds: 1, maxFailedRounds: 2 },
  remote_strict: { measureRounds: 5, warmupRounds: 1, maxFailedRounds: 1 },
};
const profileDefaults = PROFILE_DEFAULTS[PROFILE] || PROFILE_DEFAULTS.remote;

function parseIntEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function parseFloatEnv(name, fallback) {
  const parsed = Number.parseFloat(process.env[name] || '');
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

const MEASURE_ROUNDS = Math.max(1, parseIntEnv('PERF_MULTI_ROUNDS', profileDefaults.measureRounds) || profileDefaults.measureRounds);
const WARMUP_ROUNDS = Math.max(0, parseIntEnv('PERF_MULTI_WARMUP_ROUNDS', profileDefaults.warmupRounds) || profileDefaults.warmupRounds);
const TARGET_SUCCESS_ROUNDS = MEASURE_ROUNDS + WARMUP_ROUNDS;
const MAX_FAILED_ROUNDS = Math.max(0, parseIntEnv('PERF_MULTI_MAX_FAILED_ROUNDS', profileDefaults.maxFailedRounds) || profileDefaults.maxFailedRounds);
const MAX_ATTEMPTS = TARGET_SUCCESS_ROUNDS + MAX_FAILED_ROUNDS;
const TRIM_RATIO = Math.min(
  0.34,
  Math.max(0, parseFloatEnv('PERF_MULTI_TRIM_RATIO', 0.2) || 0.2),
);

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((acc, next) => acc + next, 0) / values.length;
}

function stddev(values) {
  if (!values.length) return 0;
  const avg = mean(values);
  const variance = values.reduce((acc, next) => acc + (next - avg) ** 2, 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
}

function trimOutliers(values) {
  const finite = values
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (finite.length < 5) return finite;

  const trimCount = Math.min(
    Math.floor(finite.length * TRIM_RATIO),
    Math.floor((finite.length - 1) / 2),
  );
  if (trimCount <= 0) return finite;
  return finite.slice(trimCount, finite.length - trimCount);
}

function robustQuantile(values, q) {
  const trimmed = trimOutliers(values);
  if (!trimmed.length) return 0;
  return quantile(trimmed, q);
}

function robustQuantileOrNull(values, q) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const trimmed = trimOutliers(values);
  if (!trimmed.length) return null;
  return quantile(trimmed, q);
}

function listChatReports(files) {
  return files
    .filter((f) => /^chat-perf-.*\.json$/i.test(f) && !/^chat-perf-multi-.*\.json$/i.test(f))
    .sort();
}

function runSingleRound(round) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'perf:e2e:chat'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`round ${round} exited with code ${code}`));
    });
  });
}

async function findNewReport(prevFiles) {
  const nextFiles = await fs.readdir(REPORT_DIR).catch(() => []);
  const prevSet = new Set(listChatReports(prevFiles));
  const nextCandidates = listChatReports(nextFiles);
  const delta = nextCandidates.filter((name) => !prevSet.has(name));
  if (!delta.length) return null;
  return path.join(REPORT_DIR, delta[delta.length - 1]);
}

function buildSampleQualitySummary({
  measuredRounds,
  warmSwitchP50Values,
  frameP95Values,
  longTaskCountsWarm,
  cacheHitValues,
  warmupRoundsRequested,
  failedRounds,
}) {
  const successfulRounds = measuredRounds.length + warmupRoundsRequested;
  const attemptedRounds = successfulRounds + failedRounds;
  const completedRate = attemptedRounds > 0 ? successfulRounds / attemptedRounds : 0;
  const cacheKnownRate = measuredRounds.length ? cacheHitValues.length / measuredRounds.length : 0;
  const cacheHitRounds = cacheHitValues.filter(Boolean).length;
  const cacheMissRounds = cacheHitValues.filter((v) => v === false).length;
  const cacheSplitScore = cacheHitRounds > 0 && cacheMissRounds > 0
    ? 1
    : (cacheHitRounds > 0 || cacheMissRounds > 0 ? 0.6 : 0);

  const warmCv = mean(warmSwitchP50Values) > 0 ? stddev(warmSwitchP50Values) / mean(warmSwitchP50Values) : 0;
  const frameCv = mean(frameP95Values) > 0 ? stddev(frameP95Values) / mean(frameP95Values) : 0;
  const jitterScore = clamp01(1 - Math.max(warmCv, frameCv));

  const longTaskMedian = robustQuantile(longTaskCountsWarm, 0.5);
  const longTaskScore = clamp01(1 - longTaskMedian / 2);

  const failureRate = TARGET_SUCCESS_ROUNDS > 0 ? failedRounds / Math.max(1, TARGET_SUCCESS_ROUNDS) : 0;
  const failureScore = clamp01(1 - failureRate);

  const score = clamp01(
    completedRate * 0.34 +
    cacheKnownRate * 0.14 +
    cacheSplitScore * 0.14 +
    jitterScore * 0.20 +
    longTaskScore * 0.12 +
    failureScore * 0.06,
  );

  const tier = score >= 0.85
    ? 'excellent'
    : score >= 0.7
      ? 'good'
      : score >= 0.55
        ? 'fair'
        : 'poor';

  return {
    score,
    tier,
    successfulRounds,
    attemptedRounds,
    completedRate,
    cacheKnownRate,
    cacheSplitScore,
    warmSwitchCv: warmCv,
    frameP95Cv: frameCv,
    jitterScore,
    longTaskScore,
    failureRate,
  };
}

function detectAnomalies(measuredRounds) {
  if (!measuredRounds.length) return [];
  const warmMedian = robustQuantile(measuredRounds.map((r) => r.warmSwitchP50Ms), 0.5);
  const frameMedian = robustQuantile(measuredRounds.map((r) => r.frameP95Ms), 0.5);
  const durationMedian = robustQuantile(measuredRounds.map((r) => r.roundDurationMs), 0.5);

  const anomalies = [];
  for (const round of measuredRounds) {
    const warmLimit = warmMedian + Math.max(20, warmMedian * 0.8);
    const frameLimit = frameMedian + Math.max(2, frameMedian * 0.35);
    const durationLimit = durationMedian + Math.max(12_000, durationMedian * 0.8);

    if (round.warmSwitchP50Ms > warmLimit) {
      anomalies.push({
        attempt: round.attempt,
        round: round.round,
        kind: 'warm_switch_spike',
        value: round.warmSwitchP50Ms,
        limit: warmLimit,
      });
    }
    if (round.frameP95Ms > frameLimit) {
      anomalies.push({
        attempt: round.attempt,
        round: round.round,
        kind: 'frame_jitter_spike',
        value: round.frameP95Ms,
        limit: frameLimit,
      });
    }
    if (round.roundDurationMs > durationLimit) {
      anomalies.push({
        attempt: round.attempt,
        round: round.round,
        kind: 'round_duration_spike',
        value: round.roundDurationMs,
        limit: durationLimit,
      });
    }
  }

  return anomalies;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const rounds = [];
  let successCount = 0;
  let failedRounds = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && successCount < TARGET_SUCCESS_ROUNDS; attempt += 1) {
    const isWarmupRound = successCount < WARMUP_ROUNDS;
    const roundSlot = successCount + 1;
    const role = isWarmupRound ? 'warmup' : 'measure';
    // eslint-disable-next-line no-console
    console.log(`[perf-multi] attempt ${attempt}/${MAX_ATTEMPTS} round ${roundSlot}/${TARGET_SUCCESS_ROUNDS} (${role})`);

    const before = await fs.readdir(REPORT_DIR).catch(() => []);
    const startedAt = Date.now();

    try {
      await runSingleRound(attempt);
      const reportFile = await findNewReport(before);
      if (!reportFile) {
        throw new Error(
          `failed to find generated chat perf report for attempt ${attempt}; test may be skipped (check PLAYWRIGHT_BASE_URL / PERF_CHAT_USERNAME / PERF_CHAT_PASSWORD)`,
        );
      }
      const report = JSON.parse(await fs.readFile(reportFile, 'utf8'));

      rounds.push({
        attempt,
        round: roundSlot,
        warmup: isWarmupRound,
        status: 'ok',
        reportFile,
        runAt: report.runAt,
        roundDurationMs: Date.now() - startedAt,
        coldSwitchMs: Number(report.coldSwitchMs || 0),
        warmSwitchP50Ms: Number(report.warmSwitchP50Ms || 0),
        warmSwitchP95Ms: Number(report.warmSwitchP95Ms || 0),
        switchP50Ms: Number(report.switchP50Ms || 0),
        switchP95Ms: Number(report.switchP95Ms || 0),
        frameP95Ms: Number(report.frameP95Ms || 0),
        longTaskCount: Number(report.longTaskCount || 0),
        longTaskCountWarm: Number(report.longTaskCountWarm || 0),
        firstSwitchCacheHit:
          typeof report.firstSwitchCacheHit === 'boolean' ? report.firstSwitchCacheHit : null,
        firstSwitchCacheReason: String(report.firstSwitchCacheReason || ''),
        firstSwitchMessageRequestCount: Number(report.firstSwitchMessageRequestCount || 0),
        firstSwitchMessageRequestKinds: Array.isArray(report.firstSwitchMessageRequestKinds)
          ? report.firstSwitchMessageRequestKinds.map((v) => String(v))
          : [],
      });

      successCount += 1;
    } catch (error) {
      failedRounds += 1;
      rounds.push({
        attempt,
        round: roundSlot,
        warmup: isWarmupRound,
        status: 'failed',
        roundDurationMs: Date.now() - startedAt,
        error: String(error?.message || error || 'unknown_error'),
      });

      // eslint-disable-next-line no-console
      console.warn(`[perf-multi] attempt ${attempt} failed (${failedRounds}/${MAX_FAILED_ROUNDS}): ${String(error?.message || error)}`);
      if (failedRounds > MAX_FAILED_ROUNDS) {
        throw new Error(`perf multi exceeded failure budget (${failedRounds} > ${MAX_FAILED_ROUNDS})`);
      }
    }
  }

  if (successCount < TARGET_SUCCESS_ROUNDS) {
    throw new Error(
      `insufficient successful rounds: ${successCount}/${TARGET_SUCCESS_ROUNDS} (failures=${failedRounds}, maxFailures=${MAX_FAILED_ROUNDS})`,
    );
  }

  const successfulRounds = rounds.filter((r) => r.status === 'ok');
  const measuredRounds = successfulRounds.filter((r) => !r.warmup);
  const coldSwitchValues = measuredRounds.map((r) => r.coldSwitchMs);
  const warmSwitchP50Values = measuredRounds.map((r) => r.warmSwitchP50Ms);
  const warmSwitchP95Values = measuredRounds.map((r) => r.warmSwitchP95Ms);
  const frameP95Values = measuredRounds.map((r) => r.frameP95Ms);
  const longTaskCounts = measuredRounds.map((r) => r.longTaskCount);
  const warmLongTaskCounts = measuredRounds.map((r) => r.longTaskCountWarm);
  const roundDurations = measuredRounds.map((r) => r.roundDurationMs);

  const cacheHitValues = measuredRounds
    .map((r) => r.firstSwitchCacheHit)
    .filter((v) => typeof v === 'boolean');
  const cacheHitTrueCount = cacheHitValues.filter(Boolean).length;
  const hitColdSwitchValues = measuredRounds
    .filter((r) => r.firstSwitchCacheHit === true)
    .map((r) => r.coldSwitchMs);
  const missColdSwitchValues = measuredRounds
    .filter((r) => r.firstSwitchCacheHit === false)
    .map((r) => r.coldSwitchMs);

  const sampleQuality = buildSampleQualitySummary({
    measuredRounds,
    warmSwitchP50Values,
    frameP95Values,
    longTaskCountsWarm: warmLongTaskCounts,
    cacheHitValues,
    warmupRoundsRequested: WARMUP_ROUNDS,
    failedRounds,
  });
  const anomalies = detectAnomalies(measuredRounds);

  const aggregate = {
    runAt: new Date().toISOString(),
    baseURL: BASE_URL,
    profile: PROFILE,
    roundsRequested: MEASURE_ROUNDS,
    warmupRoundsRequested: WARMUP_ROUNDS,
    roundsExecuted: rounds.length,
    roundsCompleted: measuredRounds.length,
    trimRatio: TRIM_RATIO,
    failures: {
      failedRounds,
      maxFailedRounds: MAX_FAILED_ROUNDS,
      maxAttempts: MAX_ATTEMPTS,
    },
    rounds,
    summary: {
      coldSwitchMedianMs: robustQuantile(coldSwitchValues, 0.5),
      coldSwitchP95Ms: robustQuantile(coldSwitchValues, 0.95),
      warmSwitchP50MedianMs: robustQuantile(warmSwitchP50Values, 0.5),
      warmSwitchP50P95Ms: robustQuantile(warmSwitchP50Values, 0.95),
      warmSwitchP95MedianMs: robustQuantile(warmSwitchP95Values, 0.5),
      frameP95MedianMs: robustQuantile(frameP95Values, 0.5),
      frameP95P95Ms: robustQuantile(frameP95Values, 0.95),
      roundDurationMedianMs: robustQuantile(roundDurations, 0.5),
      roundDurationP95Ms: robustQuantile(roundDurations, 0.95),
      longTaskCountMedian: robustQuantile(longTaskCounts, 0.5),
      longTaskCountWarmMedian: robustQuantile(warmLongTaskCounts, 0.5),
      cacheHitKnownRounds: cacheHitValues.length,
      cacheHitRounds: cacheHitTrueCount,
      cacheMissRounds: cacheHitValues.length - cacheHitTrueCount,
      cacheHitRate: cacheHitValues.length ? cacheHitTrueCount / cacheHitValues.length : 0,
      coldSwitchMedianMsWhenHit: robustQuantileOrNull(hitColdSwitchValues, 0.5),
      coldSwitchP95MsWhenHit: robustQuantileOrNull(hitColdSwitchValues, 0.95),
      coldSwitchMedianMsWhenMiss: robustQuantileOrNull(missColdSwitchValues, 0.5),
      coldSwitchP95MsWhenMiss: robustQuantileOrNull(missColdSwitchValues, 0.95),
      sampleQuality,
      anomalies,
    },
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(REPORT_DIR, `chat-perf-multi-${stamp}.json`);
  const latestFile = path.join(REPORT_DIR, 'chat-perf-multi-latest.json');
  await Promise.all([
    fs.writeFile(outFile, `${JSON.stringify(aggregate, null, 2)}\n`, 'utf8'),
    fs.writeFile(latestFile, `${JSON.stringify(aggregate, null, 2)}\n`, 'utf8'),
  ]);

  // eslint-disable-next-line no-console
  console.log(`[perf-multi] wrote aggregate report: ${outFile}`);
  // eslint-disable-next-line no-console
  console.log(`[perf-multi] latest pointer: ${latestFile}`);
  // eslint-disable-next-line no-console
  console.log(
    `[perf-multi] warmSwitchP50 median=${aggregate.summary.warmSwitchP50MedianMs}ms, cacheHitRate=${Math.round(aggregate.summary.cacheHitRate * 100)}%, sampleQuality=${aggregate.summary.sampleQuality.score.toFixed(2)} (${aggregate.summary.sampleQuality.tier})`,
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[perf-multi] failed:', error?.message || error);
  process.exit(1);
});
