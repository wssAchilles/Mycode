import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { chatRuntimeMetrics } from '../services/chatRuntimeMetrics';

const SAFE_METRIC_LABEL_RE = /^[a-zA-Z0-9._:-]{1,32}$/;
const MAX_TRACKED_WORKER_BUILDS = 16;
const trackedWorkerBuilds = new Set<string>();

const ALLOWED_RUNTIME_PROFILES = new Set<string>([
  'default',
  'safe',
  'canary',
  'baseline',
  'high_throughput',
  'low_memory',
  'rust_edge',
  'compat',
  'unknown',
]);

function pickHeader(req: Request, key: string): string | null {
  const raw = req.header(key);
  if (!raw) return null;
  const value = String(raw).trim();
  return value || null;
}

function sanitizeTraceHeaderValue(raw: string | null, maxLen = 96): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[\r\n\0]/g, '').trim();
  if (!cleaned || cleaned.length > maxLen) return undefined;
  return cleaned;
}

function normalizeWorkerBuildMetricLabel(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (!SAFE_METRIC_LABEL_RE.test(raw)) {
    return 'invalid';
  }
  if (trackedWorkerBuilds.has(raw)) {
    return raw;
  }
  if (trackedWorkerBuilds.size >= MAX_TRACKED_WORKER_BUILDS) {
    return 'other';
  }
  trackedWorkerBuilds.add(raw);
  return raw;
}

function normalizeRuntimeProfileMetricLabel(raw?: string): string | undefined {
  if (!raw) return undefined;
  const normalized = raw.toLowerCase();
  if (!SAFE_METRIC_LABEL_RE.test(normalized)) {
    return 'invalid';
  }
  return ALLOWED_RUNTIME_PROFILES.has(normalized) ? normalized : 'other';
}

function sanitizePath(pathname: string): string {
  if (!pathname) return pathname;
  return pathname
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, ':uuid')
    .replace(/[0-9a-fA-F]{24}/g, ':id')
    .replace(/\b\d{3,}\b/g, ':n');
}

export function routeKeyOf(req: Request): string {
  const matchedRoutePath = (req as any).route?.path as string | undefined;
  // 未命中任何已注册 Express 路由的请求（如随机 404 扫描路径）统一归并，防止高基数撑爆指标 Map
  if (!matchedRoutePath) {
    return `${req.method.toUpperCase()} UNMATCHED_ROUTE`;
  }
  const routePath = sanitizePath(String(matchedRoutePath).split('?')[0]);
  const base = sanitizePath(req.baseUrl || '');
  return `${req.method.toUpperCase()} ${base}${routePath}`;
}

export function requestTraceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = sanitizeTraceHeaderValue(pickHeader(req, 'x-request-id'), 64) || randomUUID();
  const chatTraceId = sanitizeTraceHeaderValue(pickHeader(req, 'x-chat-trace-id'), 96);
  const workerBuild = sanitizeTraceHeaderValue(pickHeader(req, 'x-chat-worker-build'), 48);
  const runtimeProfile = sanitizeTraceHeaderValue(pickHeader(req, 'x-chat-runtime-profile'), 48);
  const startedAt = Date.now();

  (req as any).requestId = requestId;
  (req as any).chatTraceId = chatTraceId;
  (req as any).chatWorkerBuild = workerBuild;
  (req as any).chatRuntimeProfile = runtimeProfile;

  res.setHeader('X-Request-Id', requestId);
  if (chatTraceId) {
    res.setHeader('X-Chat-Trace-Id', chatTraceId);
  }

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const routeKey = routeKeyOf(req);

    chatRuntimeMetrics.increment('http.requests.total');
    chatRuntimeMetrics.increment(`http.requests.status.${res.statusCode}`);
    chatRuntimeMetrics.increment(`http.requests.route.${routeKey}`);
    chatRuntimeMetrics.observeDuration('http.latency.total', durationMs);
    chatRuntimeMetrics.observeDuration(`http.latency.route.${routeKey}`, durationMs);

    if (chatTraceId) {
      chatRuntimeMetrics.increment('http.requests.withChatTrace');
    }
    const workerBuildLabel = normalizeWorkerBuildMetricLabel(workerBuild);
    if (workerBuildLabel) {
      chatRuntimeMetrics.increment(`http.workerBuild.${workerBuildLabel}`);
    }
    const runtimeProfileLabel = normalizeRuntimeProfileMetricLabel(runtimeProfile);
    if (runtimeProfileLabel) {
      chatRuntimeMetrics.increment(`http.runtimeProfile.${runtimeProfileLabel}`);
    }

    chatRuntimeMetrics.recordRequest({
      at: new Date().toISOString(),
      requestId,
      chatTraceId,
      method: req.method.toUpperCase(),
      route: routeKey,
      status: res.statusCode,
      durationMs,
    });
  });

  next();
}

