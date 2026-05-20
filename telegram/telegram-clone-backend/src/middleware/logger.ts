/**
 * 请求日志中间件
 * - 为每个请求生成唯一 ID（贯穿整个请求链路）
 * - 跳过健康检查日志（减少噪音）
 * - 使用 pino 结构化日志
 */
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { createChildLogger } from '../utils/logger';

const log = createChildLogger('middleware:request');

// 需要跳过日志的路径
const SKIP_LOG_PATHS = new Set(['/health', '/ready']);

/**
 * 请求 ID 中间件
 * 为每个请求生成唯一的 X-Request-Id，存入 req 并设置到响应头
 */
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
};

/**
 * 请求日志中间件
 * 记录请求开始和结束，跳过健康检查路径
 */
export const loggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // 跳过健康检查日志
  if (SKIP_LOG_PATHS.has(req.path)) {
    return next();
  }

  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] as string;

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const level = res.statusCode >= 500 ? 'error'
      : res.statusCode >= 400 ? 'warn'
      : 'info';

    log[level]({
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration,
      requestId,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    }, `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });

  next();
};

/**
 * 开发环境详细日志（仅在 development 模式启用）
 */
export const devLogger = (req: Request, res: Response, next: NextFunction): void => {
  if (SKIP_LOG_PATHS.has(req.path)) {
    return next();
  }

  const requestId = req.headers['x-request-id'] as string;

  log.debug({
    method: req.method,
    url: req.originalUrl,
    requestId,
    body: req.body && Object.keys(req.body).length > 0 ? req.body : undefined,
    query: req.query && Object.keys(req.query).length > 0 ? req.query : undefined,
  }, `请求详情 ${req.method} ${req.originalUrl}`);

  next();
};
