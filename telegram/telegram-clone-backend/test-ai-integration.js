const axios = require('axios');
const dotenv = require('dotenv');

// 加载环境变量
dotenv.config();

const BASE_URL = 'http://localhost:5000';

async function testAIIntegration() {
  console.log('🤖 开始测试 AI 聊天功能集成...\n');

  try {
    // 步骤1: 测试服务器健康状况
    console.log('📊 步骤1: 测试服务器连接...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    console.log('✅ 服务器健康状况:', healthResponse.data.status);
    console.log();

    // 步骤2: 测试AI服务健康检查（不需要认证）
    console.log('🏥 步骤2: 测试AI服务健康检查...');
    try {
      const aiHealthResponse = await axios.get(`${BASE_URL}/api/ai/health`);
      console.log('✅ AI服务健康状况:', aiHealthResponse.data);
    } catch (error) {
      console.log('❌ AI健康检查失败:', error.response?.data || error.message);
    }
    console.log();

    // 步骤3: 测试用户登录获取Token
    console.log('🔐 步骤3: 用户登录获取认证Token...');
    let authToken = null;
    
    try {
      const loginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
        usernameOrEmail: 'root',
        password: '123456'
      });
      
      authToken = loginResponse.data.tokens?.accessToken || loginResponse.data.token;
      console.log('✅ 登录成功，获得Token');
    } catch (error) {
      console.log('❌ 登录失败:', error.response?.data || error.message);
      console.log('ℹ️  如果用户不存在，请先创建root用户');
      return;
    }
    console.log();

    // 步骤4: 测试AI服务信息端点
    console.log('ℹ️  步骤4: 测试AI服务信息端点...');
    try {
      const aiInfoResponse = await axios.get(`${BASE_URL}/api/ai/info`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      console.log('✅ AI服务信息:', aiInfoResponse.data.data);
    } catch (error) {
      console.log('❌ AI服务信息获取失败:', error.response?.data || error.message);
    }
    console.log();

    // 步骤5: 测试AI聊天功能（如果配置了Azure AI）
    console.log('💬 步骤5: 测试AI聊天功能...');
    
    if (!process.env.AZURE_AI_ENDPOINT || !process.env.AZURE_API_KEY) {
      console.log('⚠️  未配置Azure AI Foundry凭据，跳过AI聊天测试');
      console.log('📝 请在.env文件中配置:');
      console.log('   AZURE_AI_ENDPOINT=your_endpoint');
      console.log('   AZURE_API_KEY=your_api_key');
      return;
    }

    try {
      const aiChatResponse = await axios.post(`${BASE_URL}/api/ai/chat`, {
        message: '你好，请简单介绍一下自己'
      }, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ AI聊天响应成功!');
      console.log('🤖 AI回复:', aiChatResponse.data.data.message);
      console.log('⏰ 响应时间:', aiChatResponse.data.data.timestamp);
      
      if (aiChatResponse.data.data.tokens_used) {
        console.log('🔢 使用Token数:', aiChatResponse.data.data.tokens_used);
      }
    } catch (error) {
      console.log('❌ AI聊天请求失败:', error.response?.data || error.message);
      
      if (error.response?.status === 401) {
        console.log('🔑 可能是Azure AI认证问题，请检查AZURE_API_KEY');
      } else if (error.response?.status === 404) {
        console.log('🔗 可能是Azure AI端点问题，请检查AZURE_AI_ENDPOINT');
      }
    }
    console.log();

    // 步骤6: 测试对话历史功能
    console.log('📚 步骤6: 测试带对话历史的AI聊天...');
    try {
      const conversationResponse = await axios.post(`${BASE_URL}/api/ai/chat`, {
        message: '那你能帮我做什么呢？',
        conversationHistory: [
          {
            role: 'user',
            content: '你好，请简单介绍一下自己'
          },
          {
            role: 'assistant',
            content: '你好！我是一个AI助手，很高兴为你提供帮助。'
          }
        ]
      }, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ 带历史记录的AI聊天成功!');
      console.log('🤖 AI回复:', conversationResponse.data.data.message.substring(0, 100) + '...');
    } catch (error) {
      console.log('❌ 带历史记录的聊天失败:', error.response?.data || error.message);
    }

  } catch (error) {
    console.error('❌ 测试过程出错:', error.message);
  }

  console.log('\n🎉 AI功能集成测试完成!');
  console.log('\n📋 后续集成建议:');
  console.log('1. 在前端创建AI聊天组件');
  console.log('2. 添加AI聊天窗口到主界面');
  console.log('3. 实现对话历史管理');
  console.log('4. 添加消息类型支持（AI消息 vs 用户消息）');
  console.log('5. 考虑添加AI响应的流式输出');
}

// 运行测试
if (require.main === module) {
  testAIIntegration().catch(console.error);
}

module.exports = { testAIIntegration };
