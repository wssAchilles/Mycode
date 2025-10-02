/**
 * 简化的Socket.IO消息测试
 * 使用有效token连接并发送消息，测试消息持久化
 */

// 使用最新获取的token
const TEST_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJkNzViNjY1OS0zNWQ4LTRjOGUtODRmNi0yYzYyNTI3Yjk2NGEiLCJ1c2VybmFtZSI6InJvb3QiLCJpYXQiOjE3NTM5Mzc3MzUsImV4cCI6MTc1NDU0MjUzNSwiYXVkIjoidGVsZWdyYW0tY2xvbmUtdXNlcnMiLCJpc3MiOiJ0ZWxlZ3JhbS1jbG9uZSJ9.8eTkk1r3KSjU5Gvi7ZsEa9w50P-rrJYDI9WdsgqeeEY';

// 模拟Socket.IO客户端（简化版）
const WebSocket = require('ws');

async function testSocketMessage() {
  console.log('🧪 Socket.IO消息发送测试\n');

  try {
    // 1. 创建WebSocket连接到Socket.IO服务器
    console.log('🔗 正在连接Socket.IO服务器...');
    const ws = new WebSocket('ws://localhost:5000/socket.io/?EIO=4&transport=websocket', {
      headers: {
        'Authorization': 'Bearer ' + TEST_TOKEN
      }
    });

    // 2. 等待连接成功
    await new Promise((resolve, reject) => {
      ws.on('open', () => {
        console.log('✅ WebSocket连接成功');
        resolve();
      });

      ws.on('error', (error) => {
        console.log('❌ WebSocket连接失败:', error.message);
        reject(error);
      });

      setTimeout(() => {
        reject(new Error('连接超时'));
      }, 5000);
    });

    // 3. 发送Socket.IO认证消息
    console.log('\n🔐 发送认证消息...');
    ws.send('40{"token":"' + TEST_TOKEN + '"}');

    // 4. 等待一会儿让认证完成
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 5. 发送测试消息
    console.log('\n📤 发送测试消息...');
    const testMessage = {
      content: `WebSocket测试消息 - ${new Date().toISOString()}`,
      receiverId: 'broadcast',
      type: 'text',
      isGroupChat: true
    };

    // Socket.IO消息格式：42["sendMessage",{data}]
    const socketMessage = '42["sendMessage",' + JSON.stringify(testMessage) + ']';
    console.log('   发送数据:', testMessage.content);
    
    ws.send(socketMessage);
    console.log('✅ 消息已发送');

    // 6. 监听响应
    let responseReceived = false;
    ws.on('message', (data) => {
      console.log('📩 收到服务器响应:', data.toString());
      responseReceived = true;
    });

    // 7. 等待响应
    console.log('\n⏳ 等待服务器响应...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    if (!responseReceived) {
      console.log('⚠️ 未收到服务器响应');
    }

    // 8. 关闭连接
    ws.close();
    console.log('\n🔌 连接已关闭');

    console.log('\n✨ 测试完成！请查看后端服务器日志确认消息是否被正确处理。');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 解决方案:');
      console.log('   • 确保后端服务器正在运行 (npm run dev)');
      console.log('   • 检查端口5000是否正确');
    } else if (error.message.includes('timeout')) {
      console.log('\n💡 解决方案:');
      console.log('   • 检查网络连接');
      console.log('   • 确认Socket.IO服务配置正确');
    }
  }
}

// 运行测试
testSocketMessage().then(() => {
  console.log('\n🎯 如果看到后端日志中出现 "🎯 收到sendMessage事件"，说明消息处理正常！');
  process.exit(0);
}).catch(error => {
  console.error('❌ 测试执行失败:', error);
  process.exit(1);
});
