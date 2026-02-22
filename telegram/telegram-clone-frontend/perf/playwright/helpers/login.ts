import type { Page, Response as PWResponse } from '@playwright/test';

export type PerfLoginSelectors = {
  loginUsername: string;
  loginPassword: string;
  loginSubmit: string;
  loginError: string;
};

export type PerfLoginParams = {
  page: Page;
  username: string;
  password: string;
  selectors: PerfLoginSelectors;
};

type LoginOutcome = 'ok' | 'error' | 'timeout';

const LOGIN_MAX_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.PERF_LOGIN_MAX_ATTEMPTS || '4', 10) || 4,
);
const LOGIN_OUTCOME_TIMEOUT_MS = Math.max(
  5_000,
  Number.parseInt(process.env.PERF_LOGIN_OUTCOME_TIMEOUT_MS || '30_000', 10) || 30_000,
);
const LOGIN_RETRY_BASE_DELAY_MS = Math.max(
  250,
  Number.parseInt(process.env.PERF_LOGIN_RETRY_BASE_DELAY_MS || '1_250', 10) || 1_250,
);
const LOGIN_RESPONSE_WAIT_TIMEOUT_MS = Math.max(
  2_000,
  Number.parseInt(process.env.PERF_LOGIN_RESPONSE_WAIT_TIMEOUT_MS || '20_000', 10) || 20_000,
);

function isLoginRequest(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\/api\/auth\/login\/?$/i.test(parsed.pathname);
  } catch {
    return /\/api\/auth\/login\/?(?:\?|$)/i.test(url);
  }
}

async function waitLoginOutcome(page: Page, loginErrorSelector: string, timeout: number): Promise<LoginOutcome> {
  try {
    const outcomeHandle = await page.waitForFunction(
      ({ selector }) => {
        const path = window.location.pathname || '';
        if (/^\/chat(?:\/|$)/i.test(path)) return 'ok';

        const localHasAuth = Boolean(localStorage.getItem('accessToken') && localStorage.getItem('user'));
        const sessionHasAuth = Boolean(sessionStorage.getItem('accessToken') && sessionStorage.getItem('user'));
        const hasAuth = localHasAuth || sessionHasAuth;
        if (hasAuth) return 'ok';

        const err = document.querySelector(selector);
        if (err && (err.textContent || '').trim().length > 0) return 'error';
        return null;
      },
      { selector: loginErrorSelector },
      { timeout },
    );
    const value = await outcomeHandle.jsonValue();
    if (value === 'ok' || value === 'error') return value;
    return 'timeout';
  } catch {
    return 'timeout';
  }
}

async function extractResponseMessage(response: PWResponse | null): Promise<string> {
  if (!response) return '';
  try {
    const asJson = await response.json();
    const message = asJson?.message || asJson?.error;
    return typeof message === 'string' ? message.trim() : '';
  } catch {
    try {
      const asText = await response.text();
      return String(asText || '').trim().slice(0, 120);
    } catch {
      return '';
    }
  }
}

export async function loginWithRetry(params: PerfLoginParams): Promise<void> {
  const { page, username, password, selectors } = params;
  const errors: string[] = [];

  for (let attempt = 1; attempt <= LOGIN_MAX_ATTEMPTS; attempt += 1) {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    // Already authenticated from previous successful attempt/session.
    if (/\/chat(?:[/?#]|$)/i.test(page.url())) {
      return;
    }

    await page.waitForSelector(selectors.loginUsername, { timeout: 15_000 });
    await page.waitForSelector(selectors.loginPassword, { timeout: 15_000 });
    await page.waitForSelector(selectors.loginSubmit, { timeout: 15_000 });

    await page.fill(selectors.loginUsername, username);
    await page.fill(selectors.loginPassword, password);

    const loginResponsePromise = page
      .waitForResponse(
        (response) => isLoginRequest(response.url()),
        { timeout: LOGIN_RESPONSE_WAIT_TIMEOUT_MS },
      )
      .catch(() => null);

    await page.locator(selectors.loginSubmit).first().click();

    const [outcome, loginResponse] = await Promise.all([
      waitLoginOutcome(page, selectors.loginError, LOGIN_OUTCOME_TIMEOUT_MS),
      loginResponsePromise,
    ]);
    if (outcome === 'ok') return;

    const uiError = (
      await page.locator(selectors.loginError).first().textContent().catch(() => '')
    ).trim();
    const apiStatus = loginResponse?.status();
    const apiMessage = await extractResponseMessage(loginResponse);
    const reason =
      `attempt=${attempt}/${LOGIN_MAX_ATTEMPTS}` +
      ` outcome=${outcome}` +
      (apiStatus ? ` apiStatus=${apiStatus}` : '') +
      (apiMessage ? ` apiMessage=${apiMessage}` : '') +
      (uiError ? ` uiError=${uiError}` : '');
    errors.push(reason);

    if (attempt < LOGIN_MAX_ATTEMPTS) {
      if (page.isClosed()) break;
      try {
        await page.waitForTimeout(LOGIN_RETRY_BASE_DELAY_MS * attempt);
      } catch {
        break;
      }
    }
  }

  throw new Error(
    `Login failed after ${LOGIN_MAX_ATTEMPTS} attempts. ${errors.join(' | ')}`,
  );
}
