import rateLimit from 'express-rate-limit';

export const createRateLimiter = (options: {
  windowMs: number;
  max: number;
  message?: string;
  standardHeaders?: boolean;
}) =>
  rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: options.standardHeaders ?? true,
    legacyHeaders: false,
    message: options.message || 'Too many requests, please try again later.',
  });

export const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: '登录尝试过多，请稍后再试',
});

export const aiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'AI 请求过于频繁，请稍后再试',
});

export const uploadLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: '上传请求过于频繁，请稍后再试',
});
