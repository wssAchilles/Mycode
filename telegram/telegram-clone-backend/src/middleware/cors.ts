import cors from 'cors';
import type { CorsOptions } from 'cors';
import { isOriginAllowed } from '../config/allowedOrigins';

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS origin blocked: ${origin || 'unknown'}`));
  },
  credentials: true, // 允许携带 cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-Request-Id',
    'X-Chat-Trace-Id',
    'X-Chat-Worker-Build',
    'X-Chat-Runtime-Profile',
    'X-Ops-Token',
  ],
  maxAge: 86400 // 预检请求结果缓存 24 小时
};

export const corsMiddleware = cors(corsOptions);
