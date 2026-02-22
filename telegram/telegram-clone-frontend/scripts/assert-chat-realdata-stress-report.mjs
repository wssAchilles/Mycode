import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPORT_DIR = path.resolve(process.cwd(), 'perf-reports');

const BUDGET_CURSOR_P95_MS = Number.parseFloat(process.env.PERF_BUDGET_REALDATA_CURSOR_P95_MS || '1500');
const BUDGET_CURSOR_FIRST_PAGE_P95_MS = Number.parseFloat(process.env.PERF_BUDGET_REALDATA_CURSOR_FIRST_PAGE_P95_MS || '1700');
const BUDGET_SYNC_STATE_P95_MS = Number.parseFloat(process.env.PERF_BUDGET_REALDATA_SYNC_STATE_P95_MS || '1200');
const BUDGET_SYNC_DIFF_P95_MS = Number.parseFloat(process.env.PERF_BUDGET_REALDATA_SYNC_DIFF_P95_MS || '1500');
const BUDGET_MIN_TARGETS = Math.max(
  1,
  Number.parseInt(process.env.PERF_BUDGET_REALDATA_MIN_TARGETS || '1', 10) || 1,
);

function fail(msg) {
  // eslint-disable-next-line no-console
  console.error(`[realdata-assert] ${msg}`);
  process.exitCode = 1;
}

async function pickLatestReport() {
  const latestPointer = path.join(REPORT_DIR, 'chat-realdata-stress-latest.json');
  try {
    await fs.access(latestPointer);
    return latestPointer;
  } catch {
    // fallback to timestamped reports
  }

  const files = await fs.readdir(REPORT_DIR).catch(() => []);
  const candidates = files
    .filter((name) => /^chat-realdata-stress-.*\.json$/i.test(name) && !/latest\.json$/i.test(name))
    .sort();
  if (!candidates.length) return latestPointer;
  return path.join(REPORT_DIR, candidates[candidates.length - 1]);
}

const reportFile = await pickLatestReport();
let report = null;
try {
  report = JSON.parse(await fs.readFile(reportFile, 'utf8'));
} catch {
  fail(`No valid realdata stress report found in ${REPORT_DIR}`);
  process.exit(process.exitCode || 1);
}

const summary = report?.summary || {};
// eslint-disable-next-line no-console
console.log(`[realdata-assert] using report: ${reportFile}`);
// eslint-disable-next-line no-console
console.log(
  `[realdata-assert] status=${summary.status} targets=${summary.targetsDiscovered} cursorReq=${summary.cursorRequestCount} cursorP95=${summary.cursorP95Ms}ms cursorFirstPageP95=${summary.cursorFirstPageP95Ms}ms syncStateP95=${summary.syncStateP95Ms}ms syncDiffP95=${summary.syncDiffP95Ms}ms reasons=${Array.isArray(summary.reasons) ? summary.reasons.join(';') : ''}`,
);

if (summary.status !== 'pass') {
  fail(`status is not pass: ${summary.status}`);
}
if (summary.fatalError) {
  fail(`fatalError present: ${summary.fatalError}`);
}
if (Number(summary.targetsDiscovered || 0) < BUDGET_MIN_TARGETS) {
  fail(`targetsDiscovered below budget: ${summary.targetsDiscovered} < ${BUDGET_MIN_TARGETS}`);
}
if (Number(summary.cursorRequestCount || 0) <= 0) {
  fail('cursorRequestCount must be > 0');
}
if (Number(summary.syncStateRequestCount || 0) <= 0) {
  fail('syncStateRequestCount must be > 0');
}
if (Number(summary.syncDiffRequestCount || 0) <= 0) {
  fail('syncDiffRequestCount must be > 0');
}
if (Number(summary.cursorContractMismatchCount || 0) > 0) {
  fail(`cursorContractMismatchCount should be 0, got ${summary.cursorContractMismatchCount}`);
}
if (Number(summary.cursorOrderingViolationCount || 0) > 0) {
  fail(`cursorOrderingViolationCount should be 0, got ${summary.cursorOrderingViolationCount}`);
}
if (Number(summary.cursorDuplicateSeqViolationCount || 0) > 0) {
  fail(`cursorDuplicateSeqViolationCount should be 0, got ${summary.cursorDuplicateSeqViolationCount}`);
}
if (Number(summary.syncContractMismatchCount || 0) > 0) {
  fail(`syncContractMismatchCount should be 0, got ${summary.syncContractMismatchCount}`);
}
if (Number(summary.cursorFailedRequestCount || 0) > 0) {
  fail(`cursorFailedRequestCount should be 0, got ${summary.cursorFailedRequestCount}`);
}
if (Number(summary.syncFailedRequestCount || 0) > 0) {
  fail(`syncFailedRequestCount should be 0, got ${summary.syncFailedRequestCount}`);
}
if (Number.isFinite(BUDGET_CURSOR_P95_MS) && Number(summary.cursorP95Ms || 0) > BUDGET_CURSOR_P95_MS) {
  fail(`cursorP95 above budget: ${summary.cursorP95Ms} > ${BUDGET_CURSOR_P95_MS}`);
}
if (
  Number.isFinite(BUDGET_CURSOR_FIRST_PAGE_P95_MS)
  && Number(summary.cursorFirstPageP95Ms || 0) > BUDGET_CURSOR_FIRST_PAGE_P95_MS
) {
  fail(`cursorFirstPageP95 above budget: ${summary.cursorFirstPageP95Ms} > ${BUDGET_CURSOR_FIRST_PAGE_P95_MS}`);
}
if (Number.isFinite(BUDGET_SYNC_STATE_P95_MS) && Number(summary.syncStateP95Ms || 0) > BUDGET_SYNC_STATE_P95_MS) {
  fail(`syncStateP95 above budget: ${summary.syncStateP95Ms} > ${BUDGET_SYNC_STATE_P95_MS}`);
}
if (Number.isFinite(BUDGET_SYNC_DIFF_P95_MS) && Number(summary.syncDiffP95Ms || 0) > BUDGET_SYNC_DIFF_P95_MS) {
  fail(`syncDiffP95 above budget: ${summary.syncDiffP95Ms} > ${BUDGET_SYNC_DIFF_P95_MS}`);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

// eslint-disable-next-line no-console
console.log('[realdata-assert] OK');
