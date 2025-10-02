// test-ai-integration-gemini.js
const axios = require('axios');
const dotenv = require('dotenv');

// 加载环境变量
dotenv.config();

const BASE_URL = 'http://localhost:5000';

console.log('🧪 开始测试集成后的AI聊天功能...\n');

async function testAiIntegration() {
  try {
    // 1. 测试服务器连接
    console.log('1️⃣ 测试服务器连接...');
    try {
      const serverResponse = await axios.get(`${BASE_URL}/api/health`);
      console.log('✅ 服务器连接正常');
    } catch (error) {
      console.log('❌ 服务器连接失败，请确保后端服务器正在运行');
      return;
    }

    // 2. 测试AI服务健康检查
    console.log('\n2️⃣ 测试AI服务健康检查...');
    try {
      const healthResponse = await axios.get(`${BASE_URL}/api/ai/health`);
      console.log('✅ AI服务健康检查通过:', healthResponse.data);
    } catch (error) {
      console.log('❌ AI服务健康检查失败:', error.response?.data || error.message);
      return;
    }

    // 3. 模拟用户登录获取JWT token
    console.log('\n3️⃣ 模拟用户认证...');
    let authToken;
    try {
      const loginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
        usernameOrEmail: 'root',
        password: '758205'
      });
      authToken = loginResponse.data.accessToken;
      console.log('✅ 用户认证成功');
    } catch (error) {
      console.log('❌ 用户认证失败:', error.response?.data || error.message);
      console.log('ℹ️ 这是正常的，AI功能测试可以继续...');
    }

    // 4. 测试AI聊天功能（不需要认证）
    console.log('\n4️⃣ 测试AI聊天功能...');
    try {
      const aiResponse = await axios.post(`${BASE_URL}/api/ai/chat`, {
        message: '你好，请介绍一下你自己'
      }, {
        headers: authToken ? {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        } : {
          'Content-Type': 'application/json'
        },
        timeout: 60000 // 60秒超时
      });

      console.log('✅ AI聊天测试成功!');
      console.log('📄 AI回复:', {
        success: aiResponse.data.success,
        message: aiResponse.data.data?.message?.substring(0, 200) + '...',
        tokens: aiResponse.data.data?.tokens_used,
        timestamp: aiResponse.data.data?.timestamp
      });
    } catch (error) {
      console.log('❌ AI聊天测试失败:', error.response?.data || error.message);
      if (error.response?.status === 401) {
        console.log('ℹ️ 这可能是因为需要JWT认证，请检查路由配置');
      }
    }

    // 5. 测试带对话历史的AI聊天
    console.log('\n5️⃣ 测试带对话历史的AI聊天...');
    try {
      const aiResponse2 = await axios.post(`${BASE_URL}/api/ai/chat`, {
        message: '刚才我问了你什么问题？',
        conversationHistory: [
          {
            role: 'user',
            content: '你好，请介绍一下你自己'
          },
          {
            role: 'assistant',
            content: '你好！我是 Gemini，一个由 Google 开发的大型语言模型。'
          }
        ]
      }, {
        headers: authToken ? {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        } : {
          'Content-Type': 'application/json'
        },
        timeout: 60000
      });

      console.log('✅ 带历史对话的AI聊天测试成功!');
      console.log('📄 AI回复:', {
        success: aiResponse2.data.success,
        message: aiResponse2.data.data?.message?.substring(0, 200) + '...',
        tokens: aiResponse2.data.data?.tokens_used
      });
    } catch (error) {
      console.log('❌ 带历史对话的AI聊天测试失败:', error.response?.data || error.message);
    }

    console.log('\n🎉 AI集成测试完成！');

  } catch (error) {
    console.error('❌ 测试过程中发生错误:', error.message);
  }
}

// 运行测试
testAiIntegration();
