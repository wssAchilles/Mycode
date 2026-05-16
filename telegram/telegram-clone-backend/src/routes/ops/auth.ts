import { Request, Response, NextFunction } from 'express';

function readBearerToken(req: Request): string | null {
  const auth = req.header('authorization');
  if (!auth) return null;
  const value = String(auth).trim();
  if (!value.toLowerCase().startsWith('bearer ')) return null;
  const token = value.slice(7).trim();
  return token || null;
}

export function verifyOpsToken(req: Request, res: Response, next: NextFunction): void {
  const expected = String(process.env.OPS_METRICS_TOKEN || '').trim();
  if (!expected) {
    if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'OPS_METRICS_TOKEN 未配置，生产环境下拒绝访问',
        },
      });
      return;
    }
    next();
    return;
  }

  const incoming = String(req.header('x-ops-token') || '').trim() || readBearerToken(req) || '';
  if (incoming !== expected) {
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
