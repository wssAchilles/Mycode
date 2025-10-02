// test-gemini.js
const axios = require('axios');
const dotenv = require('dotenv');
const { HttpsProxyAgent } = require('https-proxy-agent');

// 加载环境变量
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BASE_API_URL = 'https://generativelanguage.googleapis.com/v1beta';

// 设置代理，请确保端口号与你的 Clash for Windows 端口一致
const proxyAgent = new HttpsProxyAgent('http://127.0.0.1:7890');

if (!GEMINI_API_KEY) {
  console.error('❌ 错误: GEMINI_API_KEY 环境变量未设置。');
  process.exit(1);
}

console.log('🧪 开始测试Google Gemini集成...');

async function findAndTestGemini() {
  try {
    // 第一步：调用 ListModels API 查找正确的模型 ID
    console.log('🔎 正在查找可用的Gemini模型...');
    const listModelsResponse = await axios.get(
      `${BASE_API_URL}/models?key=${GEMINI_API_KEY}`,
      { httpsAgent: proxyAgent }
    );

    const availableModels = listModelsResponse.data.models;
    console.log(`✅ 成功找到 ${availableModels.length} 个模型.`);

    // === 新的查找条件，寻找 gemini-1.5-pro ===
    const modelToUse = availableModels.find(model =>
      model.name.includes('gemini-1.5-pro') && model.supportedGenerationMethods.includes('generateContent')
    );

    if (!modelToUse) {
      console.error('❌ 错误: 未找到支持 generateContent 方法的gemini-1.5-pro模型。');
      process.exit(1);
    }

    const modelId = modelToUse.name.replace('models/', ''); // <-- 移除多余的 'models/' 前缀
    const generateContentUrl = `${BASE_API_URL}/models/${modelId}:generateContent`;

    console.log(`✅ 已选择模型ID: ${modelId}`);
    console.log(`🔗 完整API URL: ${generateContentUrl}`);

    // 第二步：使用找到的模型 ID 调用 generateContent API
    console.log('📤 正在发送聊天请求...');
    const chatResponse = await axios.post(
      `${generateContentUrl}?key=${GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: '你是谁' }] }],
      },
      { httpsAgent: proxyAgent }
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

findAndTestGemini();