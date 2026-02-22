import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const REPORT_DIR = path.resolve(process.cwd(), 'perf-reports');
const MEASURE_ROUNDS = Math.max(1, Number.parseInt(process.env.PERF_MULTI_ROUNDS || '5', 10) || 5);
const WARMUP_ROUNDS = Math.max(0, Number.parseInt(process.env.PERF_MULTI_WARMUP_ROUNDS || '1', 10) || 1);
const TOTAL_ROUNDS = MEASURE_ROUNDS + WARMUP_ROUNDS;
const TRIM_RATIO = Math.min(
  0.34,
  Math.max(0, Number.parseFloat(process.env.PERF_MULTI_TRIM_RATIO || '0.2') || 0.2),
);

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

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const rounds = [];
  for (let i = 0; i < TOTAL_ROUNDS; i += 1) {
    const isWarmupRound = i < WARMUP_ROUNDS;
    const displayIndex = i + 1;
    const role = isWarmupRound ? 'warmup' : 'measure';
    // eslint-disable-next-line no-console
    console.log(`[perf-multi] round ${displayIndex}/${TOTAL_ROUNDS} (${role})`);
    const before = await fs.readdir(REPORT_DIR).catch(() => []);
    await runSingleRound(i + 1);
    const reportFile = await findNewReport(before);
    if (!reportFile) {
      throw new Error(
        `failed to find generated chat perf report for round ${i + 1}; test may be skipped (check PLAYWRIGHT_BASE_URL / PERF_CHAT_USERNAME / PERF_CHAT_PASSWORD)`,
      );
    }
    const report = JSON.parse(await fs.readFile(reportFile, 'utf8'));
    rounds.push({
      round: i + 1,
      warmup: isWarmupRound,
      reportFile,
      runAt: report.runAt,
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
  }

  const measuredRounds = rounds.filter((r) => !r.warmup);
  const coldSwitchValues = measuredRounds.map((r) => r.coldSwitchMs);
  const warmSwitchP50Values = measuredRounds.map((r) => r.warmSwitchP50Ms);
  const warmSwitchP95Values = measuredRounds.map((r) => r.warmSwitchP95Ms);
  const frameP95Values = measuredRounds.map((r) => r.frameP95Ms);
  const longTaskCounts = measuredRounds.map((r) => r.longTaskCount);
  const warmLongTaskCounts = measuredRounds.map((r) => r.longTaskCountWarm);

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

  const aggregate = {
    runAt: new Date().toISOString(),
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173',
    roundsRequested: MEASURE_ROUNDS,
    warmupRoundsRequested: WARMUP_ROUNDS,
    roundsExecuted: rounds.length,
    roundsCompleted: measuredRounds.length,
    trimRatio: TRIM_RATIO,
    rounds,
    summary: {
      coldSwitchMedianMs: robustQuantile(coldSwitchValues, 0.5),
      coldSwitchP95Ms: robustQuantile(coldSwitchValues, 0.95),
      warmSwitchP50MedianMs: robustQuantile(warmSwitchP50Values, 0.5),
      warmSwitchP50P95Ms: robustQuantile(warmSwitchP50Values, 0.95),
      warmSwitchP95MedianMs: robustQuantile(warmSwitchP95Values, 0.5),
      frameP95MedianMs: robustQuantile(frameP95Values, 0.5),
      frameP95P95Ms: robustQuantile(frameP95Values, 0.95),
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
    },
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(REPORT_DIR, `chat-perf-multi-${stamp}.json`);
  await fs.writeFile(outFile, `${JSON.stringify(aggregate, null, 2)}\n`, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`[perf-multi] wrote aggregate report: ${outFile}`);
  // eslint-disable-next-line no-console
  console.log(
    `[perf-multi] warmSwitchP50 median=${aggregate.summary.warmSwitchP50MedianMs}ms, cacheHitRate=${Math.round(aggregate.summary.cacheHitRate * 100)}%`,
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[perf-multi] failed:', error?.message || error);
  process.exit(1);
});
