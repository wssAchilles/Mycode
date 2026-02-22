import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { chatRuntimeMetrics } from '../services/chatRuntimeMetrics';

function pickHeader(req: Request, key: string): string | null {
  const raw = req.header(key);
  if (!raw) return null;
  const value = String(raw).trim();
  return value || null;
}

function sanitizePath(pathname: string): string {
  if (!pathname) return pathname;
  return pathname
    .replace(/[0-9a-fA-F]{24}/g, ':id')
    .replace(/\b\d{3,}\b/g, ':n');
}

function routeKeyOf(req: Request): string {
  const routePathRaw = ((req as any).route?.path as string | undefined) || req.path || req.originalUrl || '';
  const routePath = sanitizePath(routePathRaw.split('?')[0]);
  const base = sanitizePath(req.baseUrl || '');
  return `${req.method.toUpperCase()} ${base}${routePath}`;
}

export function requestTraceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = pickHeader(req, 'x-request-id') || randomUUID();
  const chatTraceId = pickHeader(req, 'x-chat-trace-id') || undefined;
  const workerBuild = pickHeader(req, 'x-chat-worker-build') || undefined;
  const runtimeProfile = pickHeader(req, 'x-chat-runtime-profile') || undefined;
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
    if (workerBuild) {
      chatRuntimeMetrics.increment(`http.workerBuild.${workerBuild}`);
    }
    if (runtimeProfile) {
      chatRuntimeMetrics.increment(`http.runtimeProfile.${runtimeProfile}`);
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

