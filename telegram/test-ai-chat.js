const axios = require('axios');

const API_BASE_URL = 'http://localhost:5000';

async function testAiChat() {
  console.log('🧪 开始测试AI聊天功能...\n');

  try {
    // 1. 测试用户登录
    console.log('1️⃣ 测试用户登录...');
    const loginResponse = await axios.post(`${API_BASE_URL}/api/auth/login`, {
      usernameOrEmail: 'root',
      password: '123456'
    });

    if (loginResponse.status === 200) {
      console.log('✅ 登录成功');
      const token = loginResponse.data.data.accessToken;
      console.log('🔑 获取到访问令牌');

      // 2. 测试获取AI聊天记录
      console.log('\n2️⃣ 测试获取AI聊天记录...');
      try {
        const messagesResponse = await axios.get(`${API_BASE_URL}/api/ai-chat/messages`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (messagesResponse.status === 200) {
          console.log('✅ AI聊天记录API正常');
          console.log('📊 当前AI消息数量:', messagesResponse.data.data.messages.length);
        }
      } catch (error) {
        console.log('❌ AI聊天记录API错误:', error.response?.data?.message || error.message);
      }

      // 3. 测试AI服务健康检查
      console.log('\n3️⃣ 测试AI服务健康检查...');
      try {
        const healthResponse = await axios.get(`${API_BASE_URL}/api/ai/health`);
        
        if (healthResponse.status === 200) {
          console.log('✅ AI服务健康检查正常');
          console.log('🤖 AI模型:', healthResponse.data.data.model);
          console.log('📈 可用模型数量:', healthResponse.data.data.availableModels);
        }
      } catch (error) {
        console.log('❌ AI服务健康检查失败:', error.response?.data?.message || error.message);
      }

      // 4. 测试AI聊天请求
      console.log('\n4️⃣ 测试AI聊天请求...');
      try {
        const aiChatResponse = await axios.post(`${API_BASE_URL}/api/ai/chat`, {
          message: '你好，请简单介绍一下你自己'
        }, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (aiChatResponse.status === 200) {
          console.log('✅ AI聊天请求成功');
          console.log('🤖 AI回复:', aiChatResponse.data.data.message.substring(0, 100) + '...');
        }
      } catch (error) {
        console.log('❌ AI聊天请求失败:', error.response?.data?.message || error.message);
      }

    } else {
      console.log('❌ 登录失败');
    }

  } catch (error) {
    console.error('❌ 测试过程中发生错误:', error.response?.data?.message || error.message);
  }

  console.log('\n🏁 AI聊天功能测试完成');
}

// 运行测试
testAiChat();
