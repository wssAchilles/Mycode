import cors from 'cors';

const corsOptions = {
  origin: [
    'http://localhost:3000', // React 前端开发服务器
    'http://127.0.0.1:3000',
    'http://localhost:5173', // Vite 默认端口
    'http://127.0.0.1:5173',
    'http://localhost:5174', // 额外的Vite端口
    'http://127.0.0.1:5174'
  ],
  credentials: true, // 允许携带 cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization'
  ],
  maxAge: 86400 // 预检请求结果缓存 24 小时
};

export const corsMiddleware = cors(corsOptions);
