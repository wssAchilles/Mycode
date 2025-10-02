const axios = require('axios');
require('dotenv').config();

// 测试消息API
const testMessageAPI = async () => {
  try {
    console.log('🔍 测试消息API\n');

    // 1. 登录获取token
    console.log('🔐 用户登录...');
    const loginResponse = await axios.post('http://localhost:5000/api/auth/login', {
      usernameOrEmail: 'root',
      password: '123456'
    });
    
    const token = loginResponse.data.tokens.accessToken;
    console.log('✅ 登录成功\n');

    // 2. 测试获取对话消息
    const otherUserId = 'd75b6659-35d8-4c8e-84f6-2c62527b964a'; // root的ID
    console.log(`📨 获取与用户 ${otherUserId} 的对话消息:`);
    
    const messageResponse = await axios.get(
      `http://localhost:5000/api/messages/conversation/${otherUserId}?page=1&limit=10`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    console.log('✅ API响应:');
    console.log(JSON.stringify(messageResponse.data, null, 2));

    if (messageResponse.data.messages && messageResponse.data.messages.length > 0) {
      console.log('\n📋 消息字段分析:');
      const firstMessage = messageResponse.data.messages[0];
      console.log('第一条消息的字段:');
      Object.keys(firstMessage).forEach(key => {
        console.log(`  ${key}: ${firstMessage[key]}`);
      });
    }

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', error.response.data);
    }
  }
};

testMessageAPI();
