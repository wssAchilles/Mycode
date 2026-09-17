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
