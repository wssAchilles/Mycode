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
type PerfLoginMode = 'auto' | 'ui' | 'api';

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
const LOGIN_FORM_READY_TIMEOUT_MS = Math.max(
  5_000,
  Number.parseInt(process.env.PERF_LOGIN_FORM_READY_TIMEOUT_MS || '20_000', 10) || 20_000,
);
const LOGIN_API_BASE_URL = String(
  process.env.PERF_LOGIN_API_BASE_URL
  || process.env.PERF_REALDATA_API_BASE_URL
  || process.env.PERF_API_BASE_URL
  || process.env.VITE_API_BASE_URL
  || 'https://telegram-clone-backend-88ez.onrender.com',
).replace(/\/$/, '');
const LOGIN_MODE: PerfLoginMode = (() => {
  const raw = String(process.env.PERF_LOGIN_MODE || 'auto').trim().toLowerCase();
  if (raw === 'ui' || raw === 'api') return raw;
  return 'auto';
})();

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

async function tryApiLoginSeed(params: PerfLoginParams): Promise<{ ok: boolean; reason?: string }> {
  const { page, username, password, selectors } = params;
  let loginResponse: PWResponse | null = null;
  const loginUrl = LOGIN_API_BASE_URL
    ? `${LOGIN_API_BASE_URL}/api/auth/login`
    : '/api/auth/login';

  try {
    loginResponse = await page.request.post(loginUrl, {
      data: {
        usernameOrEmail: username,
        password,
      },
      timeout: LOGIN_RESPONSE_WAIT_TIMEOUT_MS,
    });
  } catch (error) {
    return { ok: false, reason: `apiRequestError=${String(error || 'unknown')}` };
  }

  if (!loginResponse.ok()) {
    const apiMessage = await extractResponseMessage(loginResponse);
    return {
      ok: false,
      reason:
        `apiStatus=${loginResponse.status()}` +
        (apiMessage ? ` apiMessage=${apiMessage}` : ''),
    };
  }

  let payload: any = null;
  try {
    payload = await loginResponse.json();
  } catch {
    return { ok: false, reason: 'apiPayloadInvalidJson' };
  }

  const accessToken = String(payload?.tokens?.accessToken || '');
  const refreshToken = String(payload?.tokens?.refreshToken || '');
  const user = payload?.user;
  if (!accessToken || !refreshToken || !user) {
    return { ok: false, reason: 'apiPayloadMissingTokensOrUser' };
  }

  const userRaw = JSON.stringify(user);
  await page.addInitScript(
    ({ seededAccessToken, seededRefreshToken, seededUserRaw }) => {
      const targets = [window.sessionStorage, window.localStorage];
      for (const storage of targets) {
        try {
          storage.setItem('accessToken', seededAccessToken);
          storage.setItem('refreshToken', seededRefreshToken);
          storage.setItem('user', seededUserRaw);
        } catch {
          // ignore
        }
      }
    },
    {
      seededAccessToken: accessToken,
      seededRefreshToken: refreshToken,
      seededUserRaw: userRaw,
    },
  );

  await page.goto('/chat');
  await page.waitForLoadState('domcontentloaded');

  const outcome = await waitLoginOutcome(page, selectors.loginError, LOGIN_OUTCOME_TIMEOUT_MS);
  if (outcome === 'ok' || /^https?:\/\/[^/]+\/chat(?:[/?#]|$)/i.test(page.url())) {
    return { ok: true };
  }

  const uiError = (
    await page.locator(selectors.loginError).first().textContent().catch(() => '')
  ).trim();
  return {
    ok: false,
    reason:
      `apiSeedOutcome=${outcome}` +
      (uiError ? ` uiError=${uiError}` : ''),
  };
}

export async function loginWithRetry(params: PerfLoginParams): Promise<void> {
  const { page, username, password, selectors } = params;
  const errors: string[] = [];

  if (LOGIN_MODE !== 'ui') {
    const apiSeed = await tryApiLoginSeed(params);
    if (apiSeed.ok) {
      return;
    }
    const seedReason = apiSeed.reason || 'unknown';
    if (LOGIN_MODE === 'api') {
      throw new Error(`API login seed failed. ${seedReason}`);
    }
    errors.push(`api_seed_failed=${seedReason}`);
  }

  for (let attempt = 1; attempt <= LOGIN_MAX_ATTEMPTS; attempt += 1) {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    // Already authenticated from previous successful attempt/session.
    if (/\/chat(?:[/?#]|$)/i.test(page.url())) {
      return;
    }

    await page.waitForSelector(selectors.loginUsername, { timeout: LOGIN_FORM_READY_TIMEOUT_MS });
    await page.waitForSelector(selectors.loginPassword, { timeout: LOGIN_FORM_READY_TIMEOUT_MS });
    await page.waitForSelector(selectors.loginSubmit, { timeout: LOGIN_FORM_READY_TIMEOUT_MS });

    await page.fill(selectors.loginUsername, '');
    await page.fill(selectors.loginUsername, username);
    await page.fill(selectors.loginPassword, '');
    await page.fill(selectors.loginPassword, password);

    const loginResponsePromise = page
      .waitForResponse(
        (response) => isLoginRequest(response.url()),
        { timeout: LOGIN_RESPONSE_WAIT_TIMEOUT_MS },
      )
      .catch(() => null);

    try {
      await page.locator(selectors.loginSubmit).first().click();
    } catch {
      await page.locator(selectors.loginPassword).first().press('Enter');
    }

    const [outcome, loginResponse] = await Promise.all([
      waitLoginOutcome(page, selectors.loginError, LOGIN_OUTCOME_TIMEOUT_MS),
      loginResponsePromise,
    ]);
    if (outcome === 'ok' || /^https?:\/\/[^/]+\/chat(?:[/?#]|$)/i.test(page.url())) return;

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
