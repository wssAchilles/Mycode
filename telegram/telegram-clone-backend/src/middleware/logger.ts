import morgan from 'morgan';
import { Request, Response } from 'express';

// 自定义日志格式
morgan.token('timestamp', () => {
  return new Date().toISOString();
});

// 开发环境日志格式
const devFormat = ':timestamp :method :url :status :res[content-length] - :response-time ms';

// 生产环境日志格式
const prodFormat = ':timestamp :remote-addr :method :url :status :res[content-length] - :response-time ms ":user-agent"';

// 选择日志格式
const logFormat = process.env.NODE_ENV === 'production' ? prodFormat : devFormat;

export const loggerMiddleware = morgan(logFormat);

// 自定义日志中间件（用于更详细的请求记录）
export const customLogger = (req: Request, res: Response, next: Function) => {
  const startTime = Date.now();
  
  console.log(`📨 [${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('   Body:', JSON.stringify(req.body, null, 2));
  }
  
  if (req.query && Object.keys(req.query).length > 0) {
    console.log('   Query:', req.query);
  }

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`📤 [${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });

  next();
};
