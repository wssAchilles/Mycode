import { expect, test } from '@playwright/test';
import { loginWithRetry } from './helpers/login';

const USERNAME = process.env.PERF_CHAT_USERNAME || '';
const PASSWORD = process.env.PERF_CHAT_PASSWORD || '';

const SELECTORS = {
  loginUsername:
    process.env.PERF_LOGIN_USERNAME_SELECTOR ||
    'input[name="usernameOrEmail"], input[name="username"], input[name="email"], #usernameOrEmail',
  loginPassword: process.env.PERF_LOGIN_PASSWORD_SELECTOR || 'input[name="password"], #password',
  loginSubmit:
    process.env.PERF_LOGIN_SUBMIT_SELECTOR ||
    'button[type="submit"], button:has-text("登录"), button:has-text("Log in")',
  loginError: process.env.PERF_LOGIN_ERROR_SELECTOR || '.error-message',
  chatReady: process.env.PERF_CHAT_READY_SELECTOR || '.chat-container',
  chatItem: process.env.PERF_CHAT_ITEM_SELECTOR || '.tg-chat-item, .chat-item, [data-chat-id]',
  messageRow: process.env.PERF_MESSAGE_ROW_SELECTOR || '.tg-chat-area__messages, .chat-history, .message-row, .chat-message',
  messageList: process.env.PERF_MESSAGE_LIST_SELECTOR || '.chat-history, .tg-chat-area__messages, .message-list, [data-message-list]',
  chatPanel:
    process.env.PERF_CHAT_PANEL_SELECTOR ||
    '.tg-chat-area, .chat-main, .chat-content, .chat-container',
};

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
}

test('chat weak-network perf guard (3g simulated)', async ({ page, context, baseURL }) => {
  test.skip(!USERNAME || !PASSWORD, 'Missing PERF_CHAT_USERNAME / PERF_CHAT_PASSWORD');
  test.skip(!baseURL, 'Missing Playwright baseURL');
  test.setTimeout(240_000);

  await page.addInitScript(() => {
    (window as any).__weakPerf = {
      longTasks: [] as Array<{ startTime: number; duration: number }>,
    };

    const perf = (window as any).__weakPerf;
    const PerfObs = (window as any).PerformanceObserver as typeof PerformanceObserver | undefined;
    if (PerfObs) {
      try {
        const obs = new PerfObs((list) => {
          for (const entry of list.getEntries()) {
            perf.longTasks.push({
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
        });
        obs.observe({ entryTypes: ['longtask'] as any });
      } catch {
        // ignore
      }
    }
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: Math.floor((750 * 1024) / 8),
    uploadThroughput: Math.floor((250 * 1024) / 8),
    connectionType: 'cellular3g',
  });

  await loginWithRetry({
    page,
    username: USERNAME,
    password: PASSWORD,
    selectors: SELECTORS,
  });

  if (/\/login(?:[/?#]|$)/i.test(page.url())) {
    await page.goto('/chat');
  }

  await page.waitForURL(/chat|dashboard|\/$/i, { timeout: 90_000 });
  await expect(page.locator(SELECTORS.chatReady).first()).toBeVisible({ timeout: 120_000 });

  await page.waitForFunction(
    (selector) => document.querySelectorAll(selector).length >= 1,
    SELECTORS.chatItem,
    { timeout: 120_000 },
  );
  await page.waitForTimeout(1_200);

  const chatCount = await page.locator(SELECTORS.chatItem).count();
  const sample = Math.min(chatCount, 5);
  expect(sample).toBeGreaterThanOrEqual(3);

  const switchDurations: number[] = [];

  for (let i = 0; i < sample; i += 1) {
    const item = page.locator(SELECTORS.chatItem).nth(i);
    await item.scrollIntoViewIfNeeded().catch(() => undefined);
    await expect(item).toBeVisible({ timeout: 30_000 });

    const t0 = Date.now();
    await item.click({ timeout: 30_000 });

    await page.waitForFunction(
      ({ messageRow, messageList, chatPanel }) => {
        const hasVisible = (selector: string) => {
          const nodes = Array.from(document.querySelectorAll(selector));
          return nodes.some((node) => {
            const el = node as HTMLElement;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            return el.offsetWidth > 0 || el.offsetHeight > 0;
          });
        };

        return hasVisible(messageRow) || hasVisible(messageList) || hasVisible(chatPanel);
      },
      {
        messageRow: SELECTORS.messageRow,
        messageList: SELECTORS.messageList,
        chatPanel: SELECTORS.chatPanel,
      },
      { timeout: 45_000 },
    );

    switchDurations.push(Date.now() - t0);
  }

  const weakPerf = await page.evaluate(() => (window as any).__weakPerf || { longTasks: [] });
  const longTasks = Array.isArray(weakPerf.longTasks) ? weakPerf.longTasks : [];
  const longTaskMaxMs = longTasks.length
    ? Math.max(...longTasks.map((t: any) => Number(t?.duration || 0)).filter((v: number) => Number.isFinite(v)))
    : 0;

  const p50 = quantile(switchDurations, 0.5);
  const p95 = quantile(switchDurations, 0.95);

  console.log(
    `WEAK_NETWORK_CHAT_REPORT::${JSON.stringify({ sample, switchDurationsMs: switchDurations, switchP50Ms: p50, switchP95Ms: p95, longTaskCount: longTasks.length, longTaskMaxMs })}`,
  );

  expect(p50).toBeLessThanOrEqual(1200);
  expect(p95).toBeLessThanOrEqual(2200);
  expect(longTasks.length).toBeLessThanOrEqual(6);
  expect(longTaskMaxMs).toBeLessThanOrEqual(120);
});
