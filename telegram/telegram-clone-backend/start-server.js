const { spawn } = require('child_process');
const path = require('path');

// 启动 TypeScript 服务器
const tsNode = spawn('npx', ['ts-node', 'src/index.ts'], {
  cwd: __dirname,
  stdio: 'inherit'
});

tsNode.on('close', (code) => {
  console.log(`服务器进程退出，代码: ${code}`);
});

tsNode.on('error', (err) => {
  console.error('启动服务器失败:', err);
});

console.log('正在启动 Telegram Clone 后端服务器...');
