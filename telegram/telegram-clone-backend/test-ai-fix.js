// test-ai-fix.js
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// 显式指定 .env 文件的路径
const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BASE_API_URL = 'https://generativelanguage.googleapis.com/v1beta';

// 设置代理，请确保端口号与你的 Clash for Windows 端口一致
const proxyAgent = new HttpsProxyAgent('http://127.0.0.1:7890');

if (!GEMINI_API_KEY) {
  console.error('❌ 错误: GEMINI_API_KEY 环境变量未设置。');
  console.error('请检查 .env 文件是否位于后端项目根目录，并且键值对是否正确。');
  process.exit(1);
}

console.log('✅ GEMINI_API_KEY 已找到！正在启动测试...');
console.log('🧪 开始测试Google Gemini集成...');

async function testGemini() {
  try {
    const modelId = 'gemini-1.5-pro-latest';
    const generateContentUrl = `${BASE_API_URL}/models/${modelId}:generateContent`;

    console.log(`✅ 已选择模型ID: ${modelId}`);
    console.log(`🔗 完整API URL: ${generateContentUrl}`);

    const chatResponse = await axios.post(
      `${generateContentUrl}?key=${GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: '你是谁' }] }],
      },
      {
        httpsAgent: proxyAgent,
        // 添加一个超时，以防网络卡住
        timeout: 15000 
      }
    );

    console.log('✅ 测试成功!');
    console.log('📄 Gemini响应:', JSON.stringify(chatResponse.data, null, 2));

  } catch (error) {
    console.error('❌ 请求失败!');
    console.error('🔍 错误详情:', {
      status: error.response?.status,
      message: error.response?.data || error.message,
      fullError: error.toJSON ? error.toJSON() : error,
    });
  }
}

testGemini();