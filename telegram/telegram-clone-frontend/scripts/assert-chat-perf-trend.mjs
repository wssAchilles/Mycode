import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const reportsDir = path.resolve(process.cwd(), 'perf-reports');

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const entries = await fs.readdir(reportsDir).catch(() => []);
const files = entries
  .filter((name) => /^chat-perf-multi-.*\.json$/i.test(name))
  .sort();

if (files.length < 2) {
  // eslint-disable-next-line no-console
  console.log('[perf-trend] skipped: not enough multi-run reports');
  process.exit(0);
}

const fullPaths = files.map((name) => path.join(reportsDir, name));
const recentPaths = fullPaths.slice(-6);
const parsed = [];
for (const file of recentPaths) {
  try {
    const content = await fs.readFile(file, 'utf8');
    const json = JSON.parse(content);
    parsed.push({ file, summary: json.summary || {} });
  } catch {
    // ignore malformed report
  }
}

if (parsed.length < 2) {
  // eslint-disable-next-line no-console
  console.log('[perf-trend] skipped: insufficient valid reports');
  process.exit(0);
}

const latest = parsed[parsed.length - 1];
const baseline = parsed.slice(0, -1);

const baselineWarm = median(baseline.map((item) => item.summary.warmSwitchP50MedianMs));
const baselineFrame = median(baseline.map((item) => item.summary.frameP95MedianMs));
const baselineCacheHit = median(baseline.map((item) => item.summary.cacheHitRate));

const latestWarm = Number(latest.summary.warmSwitchP50MedianMs);
const latestFrame = Number(latest.summary.frameP95MedianMs);
const latestCacheHit = Number(latest.summary.cacheHitRate);

const violations = [];

if (Number.isFinite(baselineWarm) && Number.isFinite(latestWarm)) {
  const warmLimit = baselineWarm * 1.35 + 5;
  if (latestWarm > warmLimit) {
    violations.push(
      `warmSwitchP50Median regression: latest=${latestWarm.toFixed(2)}ms baseline=${baselineWarm.toFixed(2)}ms limit=${warmLimit.toFixed(2)}ms`,
    );
  }
}

if (Number.isFinite(baselineFrame) && Number.isFinite(latestFrame)) {
  const frameLimit = baselineFrame * 1.2 + 1;
  if (latestFrame > frameLimit) {
    violations.push(
      `frameP95Median regression: latest=${latestFrame.toFixed(2)}ms baseline=${baselineFrame.toFixed(2)}ms limit=${frameLimit.toFixed(2)}ms`,
    );
  }
}

if (Number.isFinite(baselineCacheHit) && Number.isFinite(latestCacheHit)) {
  const minAllowed = Math.max(0, baselineCacheHit - 0.15);
  if (latestCacheHit < minAllowed) {
    violations.push(
      `cacheHitRate regression: latest=${latestCacheHit.toFixed(3)} baseline=${baselineCacheHit.toFixed(3)} min=${minAllowed.toFixed(3)}`,
    );
  }
}

if (violations.length) {
  // eslint-disable-next-line no-console
  console.error('[perf-trend] regression detected:');
  for (const item of violations) {
    // eslint-disable-next-line no-console
    console.error(`  - ${item}`);
  }
  // eslint-disable-next-line no-console
  console.error(`[perf-trend] latest report: ${latest.file}`);
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log(
  `[perf-trend] OK latest=${path.basename(latest.file)} baselineCount=${baseline.length} warm=${Number.isFinite(latestWarm) ? latestWarm : 'n/a'} frame=${Number.isFinite(latestFrame) ? latestFrame : 'n/a'} cacheHit=${Number.isFinite(latestCacheHit) ? latestCacheHit : 'n/a'}`,
);
