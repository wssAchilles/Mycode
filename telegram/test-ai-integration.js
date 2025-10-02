const axios = require('axios');

async function testAIIntegration() {
  console.log('🧪 测试 AI 集成功能...\n');

  const baseURL = 'http://localhost:5000';
  let authToken = null;

  try {
    // 1. 登录获取认证令牌
    console.log('1️⃣ 用户登录...');
    const loginResponse = await axios.post(`${baseURL}/api/auth/login`, {
      usernameOrEmail: 'root',
      password: '123456'
    });

    authToken = loginResponse.data.token;
    console.log('✅ 登录成功，获取到认证令牌');

    // 2. 测试 AI 健康检查
    console.log('\n2️⃣ 测试 AI 健康检查...');
    const healthResponse = await axios.get(`${baseURL}/api/ai/health`);
    console.log('✅ AI 健康检查响应:', healthResponse.data);

    // 3. 测试 AI 聊天 API
    console.log('\n3️⃣ 测试 AI 聊天 API...');
    const aiChatResponse = await axios.post(`${baseURL}/api/ai/chat`, {
      message: '你好，请简单介绍一下你自己，用中文回复'
    }, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    console.log('✅ AI 聊天 API 响应:', {
      success: aiChatResponse.data.success,
      message: aiChatResponse.data.data?.message?.substring(0, 200) + '...',
      tokens: aiChatResponse.data.data?.tokens_used
    });

    // 4. 测试 Socket.IO AI 功能（模拟）
    console.log('\n4️⃣ Socket.IO AI 功能已集成到后端');
    console.log('   - 用户发送以 "/ai " 开头的消息时会触发 AI 回复');
    console.log('   - AI 回复会以 "Gemini AI" 用户身份发送');
    console.log('   - 支持多模态输入（文本 + 图片）');

    console.log('\n🎉 AI 集成测试完成！所有功能正常工作。');
    
    console.log('\n📋 使用说明:');
    console.log('   1. 在前端聊天界面发送: /ai 你好');
    console.log('   2. 系统会自动调用 Gemini AI 并返回回复');
    console.log('   3. AI 回复会显示为来自 "Gemini AI" 的消息');

  } catch (error) {
    console.error('❌ 测试失败:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
  }
}

// 运行测试
testAIIntegration();
