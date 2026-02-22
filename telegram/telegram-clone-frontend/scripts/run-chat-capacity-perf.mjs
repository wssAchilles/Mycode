import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const REPORT_MARKER = 'CHAT_CAPACITY_REPORT::';
const REPORT_DIR = path.resolve(process.cwd(), 'perf-reports');

function runVitestCapacity() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      ['vitest', 'run', 'src/test/chatCapacityPerfReport.test.ts'],
      {
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        env: process.env,
      },
    );

    let stdoutBuffer = '';
    let stderrBuffer = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdoutBuffer += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBuffer += text;
      process.stderr.write(text);
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout: stdoutBuffer, stderr: stderrBuffer });
        return;
      }
      reject(new Error(`vitest exited with code ${code}`));
    });
  });
}

function extractCapacityReport(output) {
  const lines = String(output || '').split(/\r?\n/);
  const payloads = lines
    .map((line) => {
      const idx = line.indexOf(REPORT_MARKER);
      if (idx < 0) return null;
      return line.slice(idx + REPORT_MARKER.length).trim();
    })
    .filter(Boolean);
  if (!payloads.length) return null;
  try {
    return JSON.parse(payloads[payloads.length - 1]);
  } catch {
    return null;
  }
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const beforeFiles = await fs.readdir(REPORT_DIR).catch(() => []);
  const beforeSet = new Set(beforeFiles);

  const { stdout, stderr } = await runVitestCapacity();
  const mergedOutput = `${stdout}\n${stderr}`;
  const report = extractCapacityReport(mergedOutput);
  if (!report) {
    throw new Error(
      `capacity benchmark marker not found in vitest output (${REPORT_MARKER})`,
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(REPORT_DIR, `chat-capacity-perf-${stamp}.json`);
  await fs.writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  // Lightweight pointer file for dashboards/automation readers.
  const latestFile = path.join(REPORT_DIR, 'chat-capacity-perf-latest.json');
  await fs.writeFile(latestFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const afterFiles = await fs.readdir(REPORT_DIR).catch(() => []);
  const generated = afterFiles.filter(
    (name) => !beforeSet.has(name) && /^chat-capacity-perf-.*\.json$/i.test(name),
  );

  // eslint-disable-next-line no-console
  console.log(`[capacity-perf] wrote report: ${outFile}`);
  // eslint-disable-next-line no-console
  console.log(`[capacity-perf] latest pointer: ${latestFile}`);
  // eslint-disable-next-line no-console
  console.log(
    `[capacity-perf] generated files this run: ${generated.sort().join(', ') || '(none)'}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[capacity-perf] summary status=${report?.summary?.status} smoothP95Median=${report?.summary?.smoothBatchP95MedianMs}ms totalMedian=${report?.summary?.totalRoundMedianMs}ms`,
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[capacity-perf] failed:', error?.message || error);
  process.exit(1);
});
