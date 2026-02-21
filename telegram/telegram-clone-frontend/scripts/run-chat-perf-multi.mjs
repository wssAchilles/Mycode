import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const REPORT_DIR = path.resolve(process.cwd(), 'perf-reports');
const ROUNDS = Math.max(1, Number.parseInt(process.env.PERF_MULTI_ROUNDS || '5', 10) || 5);

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
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
  if (delta.length) return path.join(REPORT_DIR, delta[delta.length - 1]);
  if (nextCandidates.length) return path.join(REPORT_DIR, nextCandidates[nextCandidates.length - 1]);
  return null;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const rounds = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    // eslint-disable-next-line no-console
    console.log(`[perf-multi] round ${i + 1}/${ROUNDS}`);
    const before = await fs.readdir(REPORT_DIR).catch(() => []);
    await runSingleRound(i + 1);
    const reportFile = await findNewReport(before);
    if (!reportFile) {
      throw new Error('failed to find generated chat perf report');
    }
    const report = JSON.parse(await fs.readFile(reportFile, 'utf8'));
    rounds.push({
      round: i + 1,
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

  const coldSwitchValues = rounds.map((r) => r.coldSwitchMs);
  const warmSwitchP50Values = rounds.map((r) => r.warmSwitchP50Ms);
  const warmSwitchP95Values = rounds.map((r) => r.warmSwitchP95Ms);
  const frameP95Values = rounds.map((r) => r.frameP95Ms);
  const longTaskCounts = rounds.map((r) => r.longTaskCount);
  const warmLongTaskCounts = rounds.map((r) => r.longTaskCountWarm);

  const cacheHitValues = rounds
    .map((r) => r.firstSwitchCacheHit)
    .filter((v) => typeof v === 'boolean');
  const cacheHitTrueCount = cacheHitValues.filter(Boolean).length;

  const aggregate = {
    runAt: new Date().toISOString(),
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173',
    roundsRequested: ROUNDS,
    roundsCompleted: rounds.length,
    rounds,
    summary: {
      coldSwitchMedianMs: quantile(coldSwitchValues, 0.5),
      coldSwitchP95Ms: quantile(coldSwitchValues, 0.95),
      warmSwitchP50MedianMs: quantile(warmSwitchP50Values, 0.5),
      warmSwitchP50P95Ms: quantile(warmSwitchP50Values, 0.95),
      warmSwitchP95MedianMs: quantile(warmSwitchP95Values, 0.5),
      frameP95MedianMs: quantile(frameP95Values, 0.5),
      frameP95P95Ms: quantile(frameP95Values, 0.95),
      longTaskCountMedian: quantile(longTaskCounts, 0.5),
      longTaskCountWarmMedian: quantile(warmLongTaskCounts, 0.5),
      cacheHitKnownRounds: cacheHitValues.length,
      cacheHitRounds: cacheHitTrueCount,
      cacheMissRounds: cacheHitValues.length - cacheHitTrueCount,
      cacheHitRate: cacheHitValues.length ? cacheHitTrueCount / cacheHitValues.length : 0,
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
