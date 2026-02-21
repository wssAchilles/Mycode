import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from '@playwright/test';

type PerfReport = {
  runAt: string;
  baseURL: string;
  switchDurationsMs: number[];
  switchP50Ms: number;
  switchP95Ms: number;
  frameP95Ms: number;
  longTaskCount: number;
  longTaskMaxMs: number;
  notes: string[];
};

const USERNAME = process.env.PERF_CHAT_USERNAME || '';
const PASSWORD = process.env.PERF_CHAT_PASSWORD || '';

const SELECTORS = {
  loginUsername: process.env.PERF_LOGIN_USERNAME_SELECTOR || 'input[name="username"], input[name="email"]',
  loginPassword: process.env.PERF_LOGIN_PASSWORD_SELECTOR || 'input[name="password"]',
  loginSubmit: process.env.PERF_LOGIN_SUBMIT_SELECTOR || 'button[type="submit"]',
  chatReady: process.env.PERF_CHAT_READY_SELECTOR || '.chat-container',
  chatItem: process.env.PERF_CHAT_ITEM_SELECTOR || '.chat-item, [data-chat-id]',
  messageRow: process.env.PERF_MESSAGE_ROW_SELECTOR || '.message-row, .chat-message',
  messageList: process.env.PERF_MESSAGE_LIST_SELECTOR || '.chat-history, .message-list, [data-message-list]',
};

const SWITCH_SAMPLE = Number.parseInt(process.env.PERF_SWITCH_SAMPLE || '20', 10) || 20;
const HISTORY_SCROLL_PASSES = Number.parseInt(process.env.PERF_SCROLL_PASSES || '10', 10) || 10;

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
}

async function writePerfReport(report: PerfReport) {
  const outDir = path.resolve(process.cwd(), 'perf-reports');
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `chat-perf-${stamp}.json`);
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

test('chat switch + history perf baseline', async ({ page, baseURL }) => {
  test.skip(!USERNAME || !PASSWORD, 'Missing PERF_CHAT_USERNAME / PERF_CHAT_PASSWORD');
  test.skip(!baseURL, 'Missing Playwright baseURL');

  await page.addInitScript(() => {
    (window as any).__chatPerf = {
      frameDeltas: [] as number[],
      longTasks: [] as number[],
      rafActive: true,
    };

    const perf = (window as any).__chatPerf;
    let last = performance.now();
    const loop = (now: number) => {
      if (!perf.rafActive) return;
      perf.frameDeltas.push(now - last);
      last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    const PerfObs = (window as any).PerformanceObserver as typeof PerformanceObserver | undefined;
    if (PerfObs) {
      try {
        const obs = new PerfObs((list) => {
          for (const entry of list.getEntries()) {
            perf.longTasks.push(entry.duration);
          }
        });
        obs.observe({ entryTypes: ['longtask'] as any });
      } catch {
        // ignore
      }
    }
  });

  await page.goto('/login');
  await page.fill(SELECTORS.loginUsername, USERNAME);
  await page.fill(SELECTORS.loginPassword, PASSWORD);
  await Promise.all([
    page.waitForURL(/chat|dashboard|\/$/i, { timeout: 30_000 }),
    page.click(SELECTORS.loginSubmit),
  ]);
  await page.waitForSelector(SELECTORS.chatReady, { timeout: 30_000 });

  const notes: string[] = [];
  const switchDurationsMs: number[] = [];

  const chatCount = await page.locator(SELECTORS.chatItem).count();
  if (chatCount === 0) {
    notes.push('No chat items found with PERF_CHAT_ITEM_SELECTOR');
  } else {
    const sample = Math.min(chatCount, SWITCH_SAMPLE);
    for (let i = 0; i < sample; i += 1) {
      const item = page.locator(SELECTORS.chatItem).nth(i);
      const started = Date.now();
      await item.click({ timeout: 10_000 });
      await page.waitForSelector(SELECTORS.messageRow, { timeout: 10_000 });
      switchDurationsMs.push(Date.now() - started);
    }
  }

  const listCount = await page.locator(SELECTORS.messageList).count();
  if (listCount === 0) {
    notes.push('No message list found with PERF_MESSAGE_LIST_SELECTOR');
  } else {
    const list = page.locator(SELECTORS.messageList).first();
    for (let i = 0; i < HISTORY_SCROLL_PASSES; i += 1) {
      await list.evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.waitForTimeout(120);
    }
  }

  const perf = await page.evaluate(() => (window as any).__chatPerf || { frameDeltas: [], longTasks: [] });
  const frameDeltas = Array.isArray(perf.frameDeltas) ? perf.frameDeltas as number[] : [];
  const longTasks = Array.isArray(perf.longTasks) ? perf.longTasks as number[] : [];

  const report: PerfReport = {
    runAt: new Date().toISOString(),
    baseURL: String(baseURL),
    switchDurationsMs,
    switchP50Ms: quantile(switchDurationsMs, 0.5),
    switchP95Ms: quantile(switchDurationsMs, 0.95),
    frameP95Ms: quantile(frameDeltas, 0.95),
    longTaskCount: longTasks.filter((v) => v >= 50).length,
    longTaskMaxMs: longTasks.length ? Math.max(...longTasks) : 0,
    notes,
  };

  await writePerfReport(report);
});
