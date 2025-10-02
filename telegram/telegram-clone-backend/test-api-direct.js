const axios = require('axios');
require('dotenv').config();

async function testAPI() {
  try {
    console.log('🔍 直接测试消息API（无需登录）...\n');
    
    // 直接调用消息API，模拟前端的请求
    const user1 = '9c1dbf36-a334-4a38-8ab8-c8fb8ba3a3b5'; // xzq (当前用户)
    const user2 = 'd75b6659-35d8-4c8e-84f6-2c62527b964a'; // root (对话对象)
    
    const apiUrl = `http://localhost:5000/api/messages/conversation/${user2}?page=1&limit=50`;
    
    console.log(`📞 调用API: ${apiUrl}`);
    
    // 这里我们需要模拟认证，但先看看未认证时的响应
    try {
      const response = await axios.get(apiUrl);
      console.log('✅ API调用成功!');
      console.log('📋 响应状态:', response.status);
      console.log('📋 消息数量:', response.data.messages ? response.data.messages.length : 0);
      
      if (response.data.messages && response.data.messages.length > 0) {
        console.log('\n📝 最近5条消息:');
        response.data.messages.slice(0, 5).forEach((msg, index) => {
          console.log(`${index + 1}. ${msg.content} (发送者: ${msg.senderUsername || msg.username || '未知'})`);
        });
      } else {
        console.log('❌ API返回了空的消息列表');
      }
      
    } catch (error) {
      if (error.response) {
        console.log('📋 API返回错误:');
        console.log('  状态码:', error.response.status);
        console.log('  错误消息:', error.response.data);
        
        if (error.response.status === 401) {
          console.log('\n💡 这是因为API需要认证，这是正常的。');
          console.log('   问题不在API本身，而可能在前端的token或请求头。');
        }
      } else {
        console.error('❌ 网络错误:', error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

testAPI();
