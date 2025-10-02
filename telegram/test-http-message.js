/**
 * HTTP方式测试消息发送API
 * 通过REST API发送消息，测试消息持久化
 */

const http = require('http');

// 使用最新获取的token
const TEST_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJkNzViNjY1OS0zNWQ4LTRjOGUtODRmNi0yYzYyNTI3Yjk2NGEiLCJ1c2VybmFtZSI6InJvb3QiLCJpYXQiOjE3NTM5Mzc3MzUsImV4cCI6MTc1NDU0MjUzNSwiYXVkIjoidGVsZWdyYW0tY2xvbmUtdXNlcnMiLCJpc3MiOiJ0ZWxlZ3JhbS1jbG9uZSJ9.8eTkk1r3KSjU5Gvi7ZsEa9w50P-rrJYDI9WdsgqeeEY';

async function testHttpMessage() {
  console.log('🧪 HTTP消息发送测试\n');

  try {
    // 1. 准备消息数据
    const messageData = JSON.stringify({
      content: `HTTP测试消息 - ${new Date().toISOString()}`,
      receiverId: 'broadcast',
      type: 'text',
      isGroupChat: true  // 对于广播消息，设置为群聊模式
    });

    // 2. 配置HTTP请求
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: '/api/messages/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + TEST_TOKEN,
        'Content-Length': Buffer.byteLength(messageData)
      }
    };

    console.log('📤 发送HTTP消息请求...');
    console.log('   内容:', JSON.parse(messageData).content);

    // 3. 发送请求
    const response = await new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve({ statusCode: res.statusCode, data: result });
          } catch (error) {
            resolve({ statusCode: res.statusCode, data: data });
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(messageData);
      req.end();
    });

    // 4. 处理响应
    if (response.statusCode === 200 || response.statusCode === 201) {
      console.log('✅ 消息发送成功');
      console.log('   状态码:', response.statusCode);
      console.log('   响应:', JSON.stringify(response.data, null, 2));
    } else {
      console.log('❌ 消息发送失败');
      console.log('   状态码:', response.statusCode);
      console.log('   响应:', response.data);
    }

    console.log('\n🎯 请查看后端服务器日志确认消息是否被正确处理！');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 解决方案:');
      console.log('   • 确保后端服务器正在运行 (npm run dev)');
      console.log('   • 检查端口5000是否正确');
    }
  }
}

// 运行测试
testHttpMessage().then(() => {
  console.log('\n✨ HTTP消息测试完成！');
  process.exit(0);
}).catch(error => {
  console.error('❌ 测试执行失败:', error);
  process.exit(1);
});
