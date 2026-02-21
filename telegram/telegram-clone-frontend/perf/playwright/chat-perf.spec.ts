import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from '@playwright/test';

type PerfReport = {
  runAt: string;
  baseURL: string;
  chatSampleSize: number;
  switchDurationsMs: number[];
  coldSwitchMs: number;
  warmSwitchDurationsMs: number[];
  warmSwitchP50Ms: number;
  warmSwitchP95Ms: number;
  switchP50Ms: number;
  switchP95Ms: number;
  frameP95Ms: number;
  longTaskCount: number;
  longTaskCountWarm: number;
  longTaskMaxMs: number;
  longTasks: Array<{ startTime: number; duration: number; phase: string }>;
  phaseDurationsMs: Record<string, number>;
  firstSwitchMessageRequestCount: number;
  firstSwitchMessageRequestUrls: string[];
  firstSwitchMessageRequestKinds: string[];
  firstSwitchCacheHit: boolean | null;
  firstSwitchCacheReason: string;
  notes: string[];
};

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

const SWITCH_SAMPLE = Number.parseInt(process.env.PERF_SWITCH_SAMPLE || '20', 10) || 20;
const HISTORY_SCROLL_PASSES = Number.parseInt(process.env.PERF_SCROLL_PASSES || '10', 10) || 10;

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
}

function isMessageHistoryRequestUrl(url: string): boolean {
  return (
    /\/api\/messages\/chat\//i.test(url)
    || /\/api\/messages\/conversation\//i.test(url)
    || /\/api\/messages\/group\//i.test(url)
    || /\/api\/messages\/private\//i.test(url)
  );
}

function classifyMessageRequest(url: string): string {
  try {
    const parsed = new URL(url);
    const hasBefore = parsed.searchParams.has('beforeSeq');
    const hasAfter = parsed.searchParams.has('afterSeq');
    if (hasAfter) return 'cursor_after_seq';
    if (hasBefore) return 'cursor_before_seq';
    return 'cursor_initial_page';
  } catch {
    if (/afterSeq=/i.test(url)) return 'cursor_after_seq';
    if (/beforeSeq=/i.test(url)) return 'cursor_before_seq';
    return 'cursor_initial_page';
  }
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
      longTasks: [] as Array<{ startTime: number; duration: number; phase: string }>,
      rafActive: true,
      phase: 'boot',
      phaseStarts: {} as Record<string, number>,
      phaseDurationsMs: {} as Record<string, number>,
    };

    const perf = (window as any).__chatPerf;
    const now = () => performance.now();
    perf.phaseStarts[perf.phase] = now();
    perf.setPhase = (next: string) => {
      const t = now();
      const prev = perf.phase as string;
      if (prev) {
        const started = perf.phaseStarts[prev] ?? t;
        perf.phaseDurationsMs[prev] = (perf.phaseDurationsMs[prev] || 0) + Math.max(0, t - started);
      }
      perf.phase = next;
      perf.phaseStarts[next] = t;
    };
    perf.finishPhases = () => {
      perf.setPhase('done');
    };

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
            perf.longTasks.push({
              startTime: entry.startTime,
              duration: entry.duration,
              phase: perf.phase || 'unknown',
            });
          }
        });
        obs.observe({ entryTypes: ['longtask'] as any });
      } catch {
        // ignore
      }
    }
  });

  await page.goto('/login');
  await page.evaluate(() => (window as any).__chatPerf?.setPhase?.('login'));

  const waitLoginOutcome = async (): Promise<'ok' | 'error' | 'timeout'> => {
    try {
      const outcomeHandle = await page.waitForFunction(
        ({ loginErrorSelector }) => {
          const hasAuth = Boolean(localStorage.getItem('accessToken') && localStorage.getItem('user'));
          if (hasAuth) return 'ok';
          const err = document.querySelector(loginErrorSelector);
          if (err && (err.textContent || '').trim().length > 0) return 'error';
          return null;
        },
        { loginErrorSelector: SELECTORS.loginError },
        { timeout: 30_000 },
      );
      const outcome = await outcomeHandle.jsonValue();
      if (outcome === 'ok' || outcome === 'error') return outcome;
      return 'timeout';
    } catch {
      return 'timeout';
    }
  };

  let loginOk = false;
  let lastLoginError = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.fill(SELECTORS.loginUsername, USERNAME);
    await page.fill(SELECTORS.loginPassword, PASSWORD);
    await page.click(SELECTORS.loginSubmit);

    const outcome = await waitLoginOutcome();
    if (outcome === 'ok') {
      loginOk = true;
      break;
    }

    lastLoginError = (
      await page.locator(SELECTORS.loginError).first().textContent().catch(() => '')
    ).trim();
    if (attempt < 1) {
      await page.waitForTimeout(600);
    }
  }

  if (!loginOk) {
    throw new Error(`Login failed before perf sampling: ${lastLoginError || 'unknown error'}`);
  }

  if (/\/login(?:[/?#]|$)/i.test(page.url())) {
    await page.goto('/chat');
  }

  await page.waitForURL(/chat|dashboard|\/$/i, { timeout: 30_000 });
  await page.waitForSelector(SELECTORS.chatReady, { timeout: 30_000 });
  await page.evaluate(() => (window as any).__chatPerf?.setPhase?.('chat_ready'));

  const notes: string[] = [];
  const switchDurationsMs: number[] = [];
  let sampledChatCount = 0;
  let trackFirstSwitchRequests = false;
  const firstSwitchMessageRequestUrls: string[] = [];

  page.on('request', (request) => {
    if (!trackFirstSwitchRequests) return;
    const url = request.url();
    if (!isMessageHistoryRequestUrl(url)) return;
    firstSwitchMessageRequestUrls.push(url);
  });

  const waitForChatSwitchSettled = async () => {
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
      { timeout: 10_000 },
    );
  };

  try {
    await page.waitForFunction(
      (selector) => document.querySelectorAll(selector).length > 0,
      SELECTORS.chatItem,
      { timeout: 8_000 },
    );
  } catch {
    notes.push('Chat list did not populate within timeout window');
  }

  const chatCount = await page.locator(SELECTORS.chatItem).count();
  if (chatCount === 0) {
    notes.push('No chat items found with PERF_CHAT_ITEM_SELECTOR');
  } else {
    const sample = Math.min(chatCount, SWITCH_SAMPLE);
    sampledChatCount = sample;
    for (let i = 0; i < sample; i += 1) {
      const item = page.locator(SELECTORS.chatItem).nth(i);
      await page.evaluate((idx) => (window as any).__chatPerf?.setPhase?.(`switch_${idx}`), i);
      if (i === 0) {
        trackFirstSwitchRequests = true;
      }
      const started = Date.now();
      await item.click({ timeout: 10_000 });
      await waitForChatSwitchSettled();
      if (i === 0) {
        trackFirstSwitchRequests = false;
      }
      switchDurationsMs.push(Date.now() - started);
    }
  }

  const listCount = await page.locator(SELECTORS.messageList).count();
  if (listCount === 0) {
    notes.push('No message list found with PERF_MESSAGE_LIST_SELECTOR');
  } else {
    const list = page.locator(SELECTORS.messageList).first();
    await page.evaluate(() => (window as any).__chatPerf?.setPhase?.('history_scroll'));
    for (let i = 0; i < HISTORY_SCROLL_PASSES; i += 1) {
      await list.evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.waitForTimeout(120);
    }
  }

  await page.evaluate(() => (window as any).__chatPerf?.finishPhases?.());
  const perf = await page.evaluate(
    () =>
      (window as any).__chatPerf || { frameDeltas: [], longTasks: [], phaseDurationsMs: {} as Record<string, number> },
  );
  const frameDeltas = Array.isArray(perf.frameDeltas) ? perf.frameDeltas as number[] : [];
  const longTasksRaw = Array.isArray(perf.longTasks)
    ? (perf.longTasks as Array<{ startTime?: number; duration?: number; phase?: string }>)
    : [];
  const longTasks = longTasksRaw
    .map((task) => ({
      startTime: Number(task.startTime || 0),
      duration: Number(task.duration || 0),
      phase: String(task.phase || 'unknown'),
    }))
    .filter((task) => Number.isFinite(task.duration) && task.duration > 0);
  const longTasksOver50 = longTasks.filter((task) => task.duration >= 50);
  const warmSwitchDurationsMs = switchDurationsMs.slice(1);
  const firstSwitchMessageRequestCount = firstSwitchMessageRequestUrls.length;
  const firstSwitchMessageRequestKinds = Array.from(
    new Set(firstSwitchMessageRequestUrls.map((url) => classifyMessageRequest(url))),
  );
  const firstSwitchCacheHit = switchDurationsMs.length
    ? firstSwitchMessageRequestCount === 0
    : null;
  const firstSwitchCacheReason = switchDurationsMs.length
    ? (firstSwitchMessageRequestCount === 0
      ? 'cache_hit_no_history_fetch'
      : firstSwitchMessageRequestKinds.includes('cursor_after_seq')
        ? 'cache_hit_with_background_revalidate'
        : 'cache_miss_initial_history_fetch')
    : 'no_switch_sample';

  const report: PerfReport = {
    runAt: new Date().toISOString(),
    baseURL: String(baseURL),
    chatSampleSize: sampledChatCount,
    switchDurationsMs,
    coldSwitchMs: switchDurationsMs[0] || 0,
    warmSwitchDurationsMs,
    warmSwitchP50Ms: quantile(warmSwitchDurationsMs, 0.5),
    warmSwitchP95Ms: quantile(warmSwitchDurationsMs, 0.95),
    switchP50Ms: quantile(switchDurationsMs, 0.5),
    switchP95Ms: quantile(switchDurationsMs, 0.95),
    frameP95Ms: quantile(frameDeltas, 0.95),
    longTaskCount: longTasksOver50.length,
    longTaskCountWarm: longTasksOver50.filter((task) => task.phase.startsWith('switch_') || task.phase === 'history_scroll').length,
    longTaskMaxMs: longTasks.length ? Math.max(...longTasks.map((task) => task.duration)) : 0,
    longTasks: longTasks
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 20),
    phaseDurationsMs:
      perf.phaseDurationsMs && typeof perf.phaseDurationsMs === 'object'
        ? (perf.phaseDurationsMs as Record<string, number>)
        : {},
    firstSwitchMessageRequestCount,
    firstSwitchMessageRequestUrls: firstSwitchMessageRequestUrls.slice(0, 20),
    firstSwitchMessageRequestKinds,
    firstSwitchCacheHit,
    firstSwitchCacheReason,
    notes,
  };

  await writePerfReport(report);
});
