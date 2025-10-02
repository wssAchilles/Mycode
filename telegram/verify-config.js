const fs = require('fs');
const path = require('path');

console.log('🔍 验证 Telegram Clone 配置...\n');

// 检查前端环境变量文件
const frontendEnvPath = path.join(__dirname, 'telegram-clone-frontend', '.env');
console.log('📁 检查前端 .env 文件...');
if (fs.existsSync(frontendEnvPath)) {
  const envContent = fs.readFileSync(frontendEnvPath, 'utf8');
  console.log('✅ .env 文件存在');
  console.log('📄 内容:');
  console.log(envContent);
} else {
  console.log('❌ .env 文件不存在');
}

// 检查前端 apiClient.ts 配置
const apiClientPath = path.join(__dirname, 'telegram-clone-frontend', 'src', 'services', 'apiClient.ts');
console.log('\n📁 检查前端 apiClient.ts 配置...');
if (fs.existsSync(apiClientPath)) {
  const apiContent = fs.readFileSync(apiClientPath, 'utf8');
  const apiBaseUrlMatch = apiContent.match(/const API_BASE_URL = (.+);/);
  if (apiBaseUrlMatch) {
    console.log('✅ API_BASE_URL 配置:', apiBaseUrlMatch[1]);
  } else {
    console.log('❌ 未找到 API_BASE_URL 配置');
  }
} else {
  console.log('❌ apiClient.ts 文件不存在');
}

// 检查前端 socketService.ts 配置
const socketServicePath = path.join(__dirname, 'telegram-clone-frontend', 'src', 'services', 'socketService.ts');
console.log('\n📁 检查前端 socketService.ts 配置...');
if (fs.existsSync(socketServicePath)) {
  const socketContent = fs.readFileSync(socketServicePath, 'utf8');
  const socketUrlMatch = socketContent.match(/const SOCKET_URL = (.+);/);
  if (socketUrlMatch) {
    console.log('✅ SOCKET_URL 配置:', socketUrlMatch[1]);
  } else {
    console.log('❌ 未找到 SOCKET_URL 配置');
  }
} else {
  console.log('❌ socketService.ts 文件不存在');
}

// 检查后端端口配置
const backendIndexPath = path.join(__dirname, 'telegram-clone-backend', 'src', 'index.ts');
console.log('\n📁 检查后端端口配置...');
if (fs.existsSync(backendIndexPath)) {
  const backendContent = fs.readFileSync(backendIndexPath, 'utf8');
  const portMatch = backendContent.match(/const PORT = (.+);/);
  if (portMatch) {
    console.log('✅ 后端端口配置:', portMatch[1]);
  } else {
    console.log('❌ 未找到端口配置');
  }
} else {
  console.log('❌ 后端 index.ts 文件不存在');
}

console.log('\n🎯 配置验证完成！');
console.log('\n📝 配置总结：');
console.log('- 前端环境变量: VITE_API_BASE_URL=http://localhost:5000');
console.log('- 前端环境变量: VITE_SOCKET_URL=http://localhost:5000');
console.log('- 前端 API 客户端: 使用环境变量或默认 http://localhost:5000');
console.log('- 前端 Socket 服务: 使用环境变量或默认 http://localhost:5000');
console.log('- 后端服务器: 运行在端口 5000');
console.log('\n🚀 如果配置正确，请使用以下命令启动服务:');
console.log('1. 后端: cd telegram-clone-backend && npm run dev');
console.log('2. 前端: cd telegram-clone-frontend && npm run dev');
console.log('3. 访问: http://localhost:5173');
