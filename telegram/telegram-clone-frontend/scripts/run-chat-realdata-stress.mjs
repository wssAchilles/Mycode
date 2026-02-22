import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPORT_DIR = path.resolve(process.cwd(), 'perf-reports');
const API_BASE_URL = String(
  process.env.PERF_REALDATA_API_BASE_URL
  || process.env.PERF_API_BASE_URL
  || process.env.VITE_API_BASE_URL
  || 'https://telegram-clone-backend-88ez.onrender.com',
).replace(/\/$/, '');

const PERF_REALDATA_USERNAME = process.env.PERF_REALDATA_USERNAME || process.env.PERF_CHAT_USERNAME || '';
const PERF_REALDATA_PASSWORD = process.env.PERF_REALDATA_PASSWORD || process.env.PERF_CHAT_PASSWORD || '';

const REQUEST_TIMEOUT_MS = Math.max(
  2_000,
  Number.parseInt(process.env.PERF_REALDATA_REQUEST_TIMEOUT_MS || '30000', 10) || 30_000,
);
const REQUEST_RETRY_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.PERF_REALDATA_REQUEST_RETRY_ATTEMPTS || '2', 10) || 2,
);
const REQUEST_RETRY_BACKOFF_MS = Math.max(
  100,
  Number.parseInt(process.env.PERF_REALDATA_REQUEST_RETRY_BACKOFF_MS || '600', 10) || 600,
);
const LOGIN_REQUEST_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.PERF_REALDATA_LOGIN_ATTEMPTS || '4', 10) || 4,
);
const LOGIN_TIMEOUT_MS = Math.max(
  REQUEST_TIMEOUT_MS,
  Number.parseInt(process.env.PERF_REALDATA_LOGIN_TIMEOUT_MS || '45000', 10) || 45_000,
);
const TARGET_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.PERF_REALDATA_TARGET_LIMIT || '12', 10) || 12,
);
const ROUND_COUNT = Math.max(
  1,
  Number.parseInt(process.env.PERF_REALDATA_ROUNDS || '2', 10) || 2,
);
const PAGE_LIMIT = Math.max(
  10,
  Math.min(100, Number.parseInt(process.env.PERF_REALDATA_PAGE_LIMIT || '50', 10) || 50),
);
const MAX_PAGES_PER_TARGET = Math.max(
  1,
  Number.parseInt(process.env.PERF_REALDATA_MAX_PAGES || '3', 10) || 3,
);
const SYNC_STATE_ROUNDS = Math.max(
  1,
  Number.parseInt(process.env.PERF_REALDATA_SYNC_STATE_ROUNDS || '3', 10) || 3,
);
const SYNC_DIFF_ROUNDS = Math.max(
  1,
  Number.parseInt(process.env.PERF_REALDATA_SYNC_DIFF_ROUNDS || '3', 10) || 3,
);
const SYNC_DIFF_LAG_PTS = Math.max(
  1,
  Number.parseInt(process.env.PERF_REALDATA_SYNC_DIFF_LAG_PTS || '30', 10) || 30,
);
const SYNC_DIFF_LIMIT = Math.max(
  10,
  Math.min(200, Number.parseInt(process.env.PERF_REALDATA_SYNC_DIFF_LIMIT || '100', 10) || 100),
);

const BUDGET_CURSOR_P95_MS = Number.parseFloat(process.env.PERF_BUDGET_REALDATA_CURSOR_P95_MS || '1500');
const BUDGET_CURSOR_FIRST_PAGE_P95_MS = Number.parseFloat(process.env.PERF_BUDGET_REALDATA_CURSOR_FIRST_PAGE_P95_MS || '1700');
const BUDGET_SYNC_STATE_P95_MS = Number.parseFloat(process.env.PERF_BUDGET_REALDATA_SYNC_STATE_P95_MS || '1200');
const BUDGET_SYNC_DIFF_P95_MS = Number.parseFloat(process.env.PERF_BUDGET_REALDATA_SYNC_DIFF_P95_MS || '1500');
const BUDGET_MIN_TARGETS = Math.max(
  1,
  Number.parseInt(process.env.PERF_BUDGET_REALDATA_MIN_TARGETS || '1', 10) || 1,
);

function quantile(values, q) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
}

function buildPrivateChatId(userId1, userId2) {
  const [a, b] = [String(userId1), String(userId2)].sort();
  return `p:${a}:${b}`;
}

function buildGroupChatId(groupId) {
  return `g:${String(groupId)}`;
}

function safeArray(input) {
  return Array.isArray(input) ? input : [];
}

async function requestJson(urlPath, { method = 'GET', token, body, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const url = urlPath.startsWith('http://') || urlPath.startsWith('https://')
    ? urlPath
    : `${API_BASE_URL}${urlPath.startsWith('/') ? '' : '/'}${urlPath}`;
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const rawText = await res.text();
    let json = null;
    try {
      json = rawText ? JSON.parse(rawText) : null;
    } catch {
      json = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      url,
      method,
      json,
      headers: res.headers,
      durationMs: performance.now() - startedAt,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      method,
      json: null,
      headers: new Headers(),
      durationMs: performance.now() - startedAt,
      error: String(error?.message || error || 'request_failed'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function shouldRetryRequest(result) {
  if (!result) return true;
  if (result.ok) return false;
  if (result.status === 0) return true;
  if (result.status >= 500) return true;
  if (result.status === 429) return true;
  return false;
}

async function requestJsonWithRetry(
  urlPath,
  { attempts = REQUEST_RETRY_ATTEMPTS, timeoutMs = REQUEST_TIMEOUT_MS, ...options } = {},
) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await requestJson(urlPath, { ...options, timeoutMs });
    if (!shouldRetryRequest(last) || attempt >= attempts) break;
    const delay = REQUEST_RETRY_BACKOFF_MS * attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return last;
}

function parseAuthResponse(json) {
  const accessToken = json?.tokens?.accessToken;
  const userId = json?.user?.id;
  if (!accessToken || !userId) return null;
  return {
    accessToken: String(accessToken),
    userId: String(userId),
  };
}

function normalizeTargets(userId, contactsPayload, groupsPayload, limit) {
  const out = [];
  const seen = new Set();

  const contacts = safeArray(contactsPayload?.contacts);
  for (const row of contacts) {
    const contactId = row?.contact?.id || row?.contactId;
    if (!contactId) continue;
    const otherUserId = String(contactId);
    if (otherUserId === userId) continue;
    const chatId = buildPrivateChatId(userId, otherUserId);
    if (seen.has(chatId)) continue;
    seen.add(chatId);
    out.push({
      chatId,
      kind: 'private',
      sourceId: otherUserId,
      label: String(row?.contact?.username || row?.contact?.email || otherUserId),
    });
    if (out.length >= limit) return out;
  }

  const groups = safeArray(groupsPayload?.groups);
  for (const group of groups) {
    const groupId = group?.id;
    if (!groupId) continue;
    const chatId = buildGroupChatId(groupId);
    if (seen.has(chatId)) continue;
    seen.add(chatId);
    out.push({
      chatId,
      kind: 'group',
      sourceId: String(groupId),
      label: String(group?.name || groupId),
    });
    if (out.length >= limit) return out;
  }

  return out;
}

function pushReason(reasons, reason) {
  if (!reason) return;
  if (!reasons.includes(reason)) reasons.push(reason);
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const runAt = new Date().toISOString();
  const budgets = {
    cursorP95Ms: BUDGET_CURSOR_P95_MS,
    cursorFirstPageP95Ms: BUDGET_CURSOR_FIRST_PAGE_P95_MS,
    syncStateP95Ms: BUDGET_SYNC_STATE_P95_MS,
    syncDiffP95Ms: BUDGET_SYNC_DIFF_P95_MS,
    minTargets: BUDGET_MIN_TARGETS,
  };
  const profile = {
    apiBaseUrl: API_BASE_URL,
    targetLimit: TARGET_LIMIT,
    rounds: ROUND_COUNT,
    pageLimit: PAGE_LIMIT,
    maxPagesPerTarget: MAX_PAGES_PER_TARGET,
    syncStateRounds: SYNC_STATE_ROUNDS,
    syncDiffRounds: SYNC_DIFF_ROUNDS,
    syncDiffLagPts: SYNC_DIFF_LAG_PTS,
    syncDiffLimit: SYNC_DIFF_LIMIT,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  };

  const summary = {
    status: 'fail',
    reasons: [],
    targetsDiscovered: 0,
    targetsTested: 0,
    cursorRequestCount: 0,
    cursorFailedRequestCount: 0,
    cursorP50Ms: 0,
    cursorP95Ms: 0,
    cursorFirstPageP95Ms: 0,
    cursorContractMismatchCount: 0,
    cursorOrderingViolationCount: 0,
    cursorDuplicateSeqViolationCount: 0,
    syncStateRequestCount: 0,
    syncDiffRequestCount: 0,
    syncFailedRequestCount: 0,
    syncStateP95Ms: 0,
    syncDiffP95Ms: 0,
    syncContractMismatchCount: 0,
    totalMessagesScanned: 0,
    fatalError: null,
  };

  const details = {
    targets: [],
    sync: [],
  };

  const cursorDurations = [];
  const cursorFirstPageDurations = [];
  const syncStateDurations = [];
  const syncDiffDurations = [];

  try {
    if (!PERF_REALDATA_USERNAME || !PERF_REALDATA_PASSWORD) {
      throw new Error('missing credentials: PERF_REALDATA_USERNAME/PERF_REALDATA_PASSWORD (or PERF_CHAT_USERNAME/PERF_CHAT_PASSWORD)');
    }

    const loginRes = await requestJsonWithRetry('/api/auth/login', {
      method: 'POST',
      body: {
        usernameOrEmail: PERF_REALDATA_USERNAME,
        password: PERF_REALDATA_PASSWORD,
      },
      attempts: LOGIN_REQUEST_ATTEMPTS,
      timeoutMs: LOGIN_TIMEOUT_MS,
    });
    if (!loginRes.ok) {
      throw new Error(`login failed: status=${loginRes.status} error=${String(loginRes.json?.message || loginRes.error || 'unknown')}`);
    }

    const auth = parseAuthResponse(loginRes.json);
    if (!auth) {
      throw new Error('login response missing accessToken/userId');
    }

    const [contactsRes, groupsRes] = await Promise.all([
      requestJsonWithRetry('/api/contacts?status=accepted', { token: auth.accessToken }),
      requestJsonWithRetry('/api/groups/my', { token: auth.accessToken }),
    ]);

    if (!contactsRes.ok) {
      throw new Error(`load contacts failed: status=${contactsRes.status}`);
    }
    if (!groupsRes.ok) {
      throw new Error(`load groups failed: status=${groupsRes.status}`);
    }

    const targets = normalizeTargets(auth.userId, contactsRes.json, groupsRes.json, TARGET_LIMIT);
    summary.targetsDiscovered = targets.length;
    if (targets.length < BUDGET_MIN_TARGETS) {
      pushReason(summary.reasons, `targets<${BUDGET_MIN_TARGETS} (${targets.length})`);
    }

    for (let round = 1; round <= ROUND_COUNT; round += 1) {
      for (const target of targets) {
        const perTarget = {
          round,
          chatId: target.chatId,
          kind: target.kind,
          label: target.label,
          pagesFetched: 0,
          requestCount: 0,
          failedRequests: 0,
          messagesScanned: 0,
          contractMismatchCount: 0,
          orderingViolationCount: 0,
          duplicateSeqViolationCount: 0,
        };

        let beforeSeq = null;
        let prevFirstSeq = Number.POSITIVE_INFINITY;
        const seenSeq = new Set();

        for (let page = 0; page < MAX_PAGES_PER_TARGET; page += 1) {
          const query = new URLSearchParams();
          query.set('limit', String(PAGE_LIMIT));
          if (Number.isFinite(beforeSeq) && beforeSeq > 0) {
            query.set('beforeSeq', String(beforeSeq));
          }

          const requestPath = `/api/messages/chat/${encodeURIComponent(target.chatId)}?${query.toString()}`;
          const res = await requestJsonWithRetry(requestPath, { token: auth.accessToken });
          perTarget.requestCount += 1;
          summary.cursorRequestCount += 1;
          cursorDurations.push(res.durationMs);
          if (page === 0) cursorFirstPageDurations.push(res.durationMs);

          if (!res.ok) {
            perTarget.failedRequests += 1;
            summary.cursorFailedRequestCount += 1;
            break;
          }

          const headerCursorOnly = String(res.headers.get('x-message-cursor-only') || '').toLowerCase();
          const headerProtocol = Number.parseInt(String(res.headers.get('x-message-cursor-protocol-version') || ''), 10);
          const headerCanonicalChatId = String(res.headers.get('x-message-cursor-canonical-chatid') || '');

          if (headerCursorOnly !== 'true') {
            perTarget.contractMismatchCount += 1;
            summary.cursorContractMismatchCount += 1;
          }
          if (!Number.isFinite(headerProtocol) || headerProtocol !== 1) {
            perTarget.contractMismatchCount += 1;
            summary.cursorContractMismatchCount += 1;
          }
          if (headerCanonicalChatId && headerCanonicalChatId !== target.chatId) {
            perTarget.contractMismatchCount += 1;
            summary.cursorContractMismatchCount += 1;
          }

          const messages = safeArray(res.json?.messages);
          const paging = res.json?.paging || {};
          perTarget.pagesFetched += 1;

          let localPrevSeq = Number.NEGATIVE_INFINITY;
          for (const message of messages) {
            const seq = Number(message?.seq);
            if (!Number.isFinite(seq) || seq <= 0) continue;
            perTarget.messagesScanned += 1;
            summary.totalMessagesScanned += 1;

            if (seq <= localPrevSeq) {
              perTarget.orderingViolationCount += 1;
              summary.cursorOrderingViolationCount += 1;
            }
            localPrevSeq = seq;

            if (seenSeq.has(seq)) {
              perTarget.duplicateSeqViolationCount += 1;
              summary.cursorDuplicateSeqViolationCount += 1;
            }
            seenSeq.add(seq);
          }

          const firstSeq = Number(messages[0]?.seq);
          if (Number.isFinite(firstSeq) && firstSeq >= prevFirstSeq) {
            perTarget.orderingViolationCount += 1;
            summary.cursorOrderingViolationCount += 1;
          }
          if (Number.isFinite(firstSeq)) {
            prevFirstSeq = firstSeq;
          }

          const nextBeforeSeq = Number(paging?.nextBeforeSeq);
          const hasMore = Boolean(paging?.hasMore);
          if (!hasMore) break;
          if (!Number.isFinite(nextBeforeSeq) || nextBeforeSeq <= 0) {
            perTarget.contractMismatchCount += 1;
            summary.cursorContractMismatchCount += 1;
            break;
          }
          beforeSeq = nextBeforeSeq;
        }

        if (perTarget.requestCount > 0) {
          summary.targetsTested += 1;
        }
        details.targets.push(perTarget);
      }
    }

    let latestPts = 0;
    for (let i = 0; i < SYNC_STATE_ROUNDS; i += 1) {
      const res = await requestJsonWithRetry('/api/sync/state', { token: auth.accessToken });
      summary.syncStateRequestCount += 1;
      syncStateDurations.push(res.durationMs);

      if (!res.ok) {
        summary.syncFailedRequestCount += 1;
        details.sync.push({
          type: 'state',
          ok: false,
          status: res.status,
          durationMs: res.durationMs,
        });
        continue;
      }

      const body = res.json?.data || res.json || {};
      const protocolHeader = Number.parseInt(String(res.headers.get('x-sync-protocol-version') || ''), 10);
      const watermarkHeader = String(res.headers.get('x-sync-watermark-field') || '');
      const protocolBody = Number(body?.protocolVersion);
      const watermarkBody = String(body?.watermarkField || '');
      if (protocolHeader !== 2 || protocolBody !== 2 || watermarkHeader !== 'updateId' || watermarkBody !== 'updateId') {
        summary.syncContractMismatchCount += 1;
      }
      latestPts = Math.max(latestPts, Number(body?.pts || body?.updateId || 0));
      details.sync.push({
        type: 'state',
        ok: true,
        status: res.status,
        durationMs: res.durationMs,
        pts: Number(body?.pts || body?.updateId || 0),
      });
    }

    for (let i = 0; i < SYNC_DIFF_ROUNDS; i += 1) {
      const fromPts = Math.max(0, latestPts - SYNC_DIFF_LAG_PTS - i);
      const res = await requestJsonWithRetry('/api/sync/difference', {
        method: 'POST',
        token: auth.accessToken,
        body: {
          pts: fromPts,
          limit: SYNC_DIFF_LIMIT,
        },
      });
      summary.syncDiffRequestCount += 1;
      syncDiffDurations.push(res.durationMs);

      if (!res.ok) {
        summary.syncFailedRequestCount += 1;
        details.sync.push({
          type: 'difference',
          ok: false,
          status: res.status,
          durationMs: res.durationMs,
          fromPts,
        });
        continue;
      }

      const body = res.json?.data || res.json || {};
      const protocolHeader = Number.parseInt(String(res.headers.get('x-sync-protocol-version') || ''), 10);
      const watermarkHeader = String(res.headers.get('x-sync-watermark-field') || '');
      const protocolBody = Number(body?.protocolVersion || body?.state?.protocolVersion);
      const watermarkBody = String(body?.watermarkField || body?.state?.watermarkField || '');
      if (protocolHeader !== 2 || protocolBody !== 2 || watermarkHeader !== 'updateId' || watermarkBody !== 'updateId') {
        summary.syncContractMismatchCount += 1;
      }

      details.sync.push({
        type: 'difference',
        ok: true,
        status: res.status,
        durationMs: res.durationMs,
        fromPts,
        updates: safeArray(body?.updates).length,
        isLatest: Boolean(body?.isLatest),
      });
    }
  } catch (error) {
    summary.fatalError = String(error?.message || error || 'realdata_stress_failed');
    pushReason(summary.reasons, `fatal:${summary.fatalError}`);
  }

  summary.cursorP50Ms = quantile(cursorDurations, 0.5);
  summary.cursorP95Ms = quantile(cursorDurations, 0.95);
  summary.cursorFirstPageP95Ms = quantile(cursorFirstPageDurations, 0.95);
  summary.syncStateP95Ms = quantile(syncStateDurations, 0.95);
  summary.syncDiffP95Ms = quantile(syncDiffDurations, 0.95);

  if (summary.cursorContractMismatchCount > 0) {
    pushReason(summary.reasons, `cursorContractMismatch=${summary.cursorContractMismatchCount}`);
  }
  if (summary.cursorOrderingViolationCount > 0) {
    pushReason(summary.reasons, `cursorOrderingViolation=${summary.cursorOrderingViolationCount}`);
  }
  if (summary.cursorDuplicateSeqViolationCount > 0) {
    pushReason(summary.reasons, `cursorDuplicateSeqViolation=${summary.cursorDuplicateSeqViolationCount}`);
  }
  if (summary.syncContractMismatchCount > 0) {
    pushReason(summary.reasons, `syncContractMismatch=${summary.syncContractMismatchCount}`);
  }
  if (summary.cursorFailedRequestCount > 0) {
    pushReason(summary.reasons, `cursorFailedRequest=${summary.cursorFailedRequestCount}`);
  }
  if (summary.syncFailedRequestCount > 0) {
    pushReason(summary.reasons, `syncFailedRequest=${summary.syncFailedRequestCount}`);
  }
  if (summary.targetsDiscovered < BUDGET_MIN_TARGETS) {
    pushReason(summary.reasons, `targets<${BUDGET_MIN_TARGETS}`);
  }
  if (Number.isFinite(BUDGET_CURSOR_P95_MS) && summary.cursorP95Ms > BUDGET_CURSOR_P95_MS) {
    pushReason(summary.reasons, `cursorP95>${BUDGET_CURSOR_P95_MS} (${summary.cursorP95Ms.toFixed(2)})`);
  }
  if (Number.isFinite(BUDGET_CURSOR_FIRST_PAGE_P95_MS) && summary.cursorFirstPageP95Ms > BUDGET_CURSOR_FIRST_PAGE_P95_MS) {
    pushReason(
      summary.reasons,
      `cursorFirstPageP95>${BUDGET_CURSOR_FIRST_PAGE_P95_MS} (${summary.cursorFirstPageP95Ms.toFixed(2)})`,
    );
  }
  if (Number.isFinite(BUDGET_SYNC_STATE_P95_MS) && summary.syncStateP95Ms > BUDGET_SYNC_STATE_P95_MS) {
    pushReason(summary.reasons, `syncStateP95>${BUDGET_SYNC_STATE_P95_MS} (${summary.syncStateP95Ms.toFixed(2)})`);
  }
  if (Number.isFinite(BUDGET_SYNC_DIFF_P95_MS) && summary.syncDiffP95Ms > BUDGET_SYNC_DIFF_P95_MS) {
    pushReason(summary.reasons, `syncDiffP95>${BUDGET_SYNC_DIFF_P95_MS} (${summary.syncDiffP95Ms.toFixed(2)})`);
  }

  summary.status = summary.reasons.length === 0 ? 'pass' : 'fail';

  const payload = {
    runAt,
    profile,
    budgets,
    summary,
    details,
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportFile = path.join(REPORT_DIR, `chat-realdata-stress-${stamp}.json`);
  const latestFile = path.join(REPORT_DIR, 'chat-realdata-stress-latest.json');
  await Promise.all([
    fs.writeFile(reportFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8'),
    fs.writeFile(latestFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8'),
  ]);

  // eslint-disable-next-line no-console
  console.log(`[realdata-stress] wrote report: ${reportFile}`);
  // eslint-disable-next-line no-console
  console.log(`[realdata-stress] latest pointer: ${latestFile}`);
  // eslint-disable-next-line no-console
  console.log(
    `[realdata-stress] status=${summary.status} targets=${summary.targetsDiscovered} cursorP95=${summary.cursorP95Ms.toFixed(2)}ms syncDiffP95=${summary.syncDiffP95Ms.toFixed(2)}ms reasons=${summary.reasons.join(';') || 'none'}`,
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[realdata-stress] unexpected failure:', error?.message || error);
  process.exit(1);
});
