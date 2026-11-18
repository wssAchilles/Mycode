import { createHash, timingSafeEqual } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

function readBearerToken(req: Request): string | null {
  const auth = req.header('authorization');
  if (!auth) return null;
  const value = String(auth).trim();
  if (!value.toLowerCase().startsWith('bearer ')) return null;
  const token = value.slice(7).trim();
  return token || null;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function isOpsTokenRequired(): boolean {
  const flag = String(process.env.OPS_TOKEN_REQUIRED || '').trim().toLowerCase();
  if (flag === 'true' || flag === '1' || flag === 'yes') {
    return true;
  }
  return (process.env.NODE_ENV || '').toLowerCase() === 'production';
}

export function verifyOpsToken(req: Request, res: Response, next: NextFunction): void {
  const expected = String(process.env.OPS_METRICS_TOKEN || '').trim();
  if (!expected) {
    if (isOpsTokenRequired()) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'OPS_METRICS_TOKEN 未配置，拒绝访问',
        },
      });
      return;
    }
    next();
    return;
  }

  const incoming = String(req.header('x-ops-token') || '').trim() || readBearerToken(req) || '';
  if (!incoming || !constantTimeEquals(incoming, expected)) {
    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'ops token 无效',
      },
    });
    return;
  }
  next();
}
