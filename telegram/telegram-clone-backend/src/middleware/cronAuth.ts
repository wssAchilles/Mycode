import { createHash, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { errors } from '../utils/apiResponse';

/**
 * 定时任务 / ML 回调专用鉴权。
 *
 * - 仅接受 header `x-cron-secret`（不认 query，避免日志/Referer 泄露）。
 * - 与 `process.env.CRON_SECRET` 做定长哈希后的 timing-safe 比较。
 * - 未配置 CRON_SECRET 或校验失败一律 401。
 * - 成功时注入 `system-crawler` 身份，供日志与下游审计使用。
 */
export const CRON_USER_ID = 'system-crawler';

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function secretsMatch(provided: string, expected: string): boolean {
  // 先哈希成定长摘要，避免 timingSafeEqual 因长度不等抛错，也避免长度侧信道
  return timingSafeEqual(sha256(provided), sha256(expected));
}

export function requireCronSecret(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    errors.unauthorized(res, 'Cron 端点未启用');
    return;
  }

  const raw = req.headers['x-cron-secret'];
  const provided = Array.isArray(raw) ? raw[0] : raw;
  if (typeof provided !== 'string' || provided.length === 0) {
    errors.unauthorized(res, '缺少 cron 密钥');
    return;
  }

  if (!secretsMatch(provided, expected)) {
    errors.unauthorized(res, '无效的 cron 密钥');
    return;
  }

  req.userId = CRON_USER_ID;
  req.user = {
    id: CRON_USER_ID,
    username: 'SystemCrawler',
    email: 'crawler@system.local',
  };
  next();
}

function readOpsBearerToken(req: Request): string {
  const auth = req.header('authorization');
  if (!auth) return '';
  const trimmed = String(auth).trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return '';
  return trimmed.slice(7).trim();
}

/**
 * 批量新闻导入等管理/Webhook 专用鉴权（始终 fail-closed）。
 *
 * - 支持 `x-cron-secret` 与 `process.env.CRON_SECRET` 的 timing-safe 比对。
 * - 支持 `x-ops-token`（或 `Authorization: Bearer <OPS_METRICS_TOKEN>`）与已配置的 `process.env.OPS_METRICS_TOKEN` 做 timing-safe 比对。
 * - 任一密钥未配置时绝不放行，普通用户 JWT 无法通过校验。
 */
export function requireCronOrOpsAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const opsToken = String(process.env.OPS_METRICS_TOKEN || '').trim();

  if (!cronSecret && !opsToken) {
    errors.unauthorized(res, '管理/Webhook 端点未启用');
    return;
  }

  const rawCron = req.headers['x-cron-secret'];
  const providedCron = (Array.isArray(rawCron) ? rawCron[0] : rawCron)?.trim();
  if (providedCron) {
    if (cronSecret && secretsMatch(providedCron, cronSecret)) {
      req.userId = CRON_USER_ID;
      req.user = {
        id: CRON_USER_ID,
        username: 'SystemCrawler',
        email: 'crawler@system.local',
      };
      next();
      return;
    }
    errors.unauthorized(res, '无效的 cron 密钥');
    return;
  }

  const rawOpsHeader = req.headers['x-ops-token'];
  const providedOpsHeader = (Array.isArray(rawOpsHeader) ? rawOpsHeader[0] : rawOpsHeader)?.trim() || '';
  const providedOps = providedOpsHeader || readOpsBearerToken(req);

  if (opsToken && providedOps && secretsMatch(providedOps, opsToken)) {
    next();
    return;
  }

  if (providedOpsHeader) {
    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'ops token 无效',
      },
    });
    return;
  }

  errors.unauthorized(res, '缺少 cron 或管理员鉴权凭据');
}
