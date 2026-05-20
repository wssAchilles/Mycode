import pino from 'pino';

const isDev = (process.env.NODE_ENV || 'development') === 'development';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  // 生产环境使用 JSON 格式，开发环境使用 pretty 格式
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
    : undefined,
  // 敏感字段脱敏
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.secret',
      '*.apiKey',
      '*.api_key',
    ],
    remove: true,
  },
  // 格式化日志级别为字符串
  formatters: {
    level: (label) => ({ level: label }),
  },
  // 序列化器
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});

/**
 * 创建模块级别的子日志器
 * 用法：const log = createChildLogger('services:socketService');
 */
export const createChildLogger = (module: string) => logger.child({ module });

export default logger;
