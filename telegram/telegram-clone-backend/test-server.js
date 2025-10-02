const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

app.get('/api/test', (req, res) => {
  res.json({ message: '后端服务器运行正常', port: PORT, timestamp: new Date() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

app.listen(PORT, () => {
  console.log(`🚀 测试服务器运行在 http://localhost:${PORT}`);
  console.log(`📡 API 端点: http://localhost:${PORT}/api/test`);
  console.log(`💚 健康检查: http://localhost:${PORT}/api/health`);
});

process.on('SIGINT', () => {
  console.log('📴 服务器正在关闭...');
  process.exit(0);
});
