/**
 * Socket.IO消息传输和持久化测试脚本
 * 测试客户端发送消息是否能通过Socket.IO正确传输并持久化到MongoDB
 */

const { io } = require('socket.io-client');
const http = require('http');
const mongoose = require('mongoose');
require('dotenv').config();

// 测试用的JWT token（需要是有效的用户token）
const TEST_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJkNzViNjY1OS0zNWQ4LTRjOGUtODRmNi0yYzYyNTI3Yjk2NGEiLCJpYXQiOjE3NTM5MzU3MjAsImV4cCI6MTc1NDA1NDEyMH0.EbkGlsn2TkZGbBQOJGjGSYzckJzwxMf8c6hfMQOGjWM';

// 消息Schema（与后端保持一致）
const MessageSchema = new mongoose.Schema({
  sender: String,
  receiver: String,
  content: String,
  type: { type: String, default: 'text' },
  timestamp: { type: Date, default: Date.now },
  status: { type: String, default: 'sent' },
  isGroupChat: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

async function testSocketMessaging() {
  console.log('🧪 Socket.IO消息传输和持久化测试\n');

  let client = null;
  let Message = null;

  try {
    // 1. 连接MongoDB以验证消息持久化
    console.log('📡 连接MongoDB...');
    const mongoUri = process.env.MONGODB_URI;
    try {
      const safeUri = mongoUri.replace(/(mongodb(?:\+srv)?:\/\/)([^:@]+):([^@]+)@/i, '$1***:***@');
      console.log('   MongoDB URI:', safeUri);
    } catch {
      console.log('   MongoDB URI: (隐藏)');
    }
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 20000,
      connectTimeoutMS: 15000,
      maxPoolSize: 5,
      bufferCommands: false,
    });
    Message = mongoose.model('TestMessage', MessageSchema);
    console.log('✅ MongoDB连接成功');

    // 2. 检查后端服务器是否运行
    console.log('\n🌐 检查后端服务器...');
    const serverUrl = 'http://localhost:5000';
    
    await new Promise((resolve, reject) => {
      const req = http.get(serverUrl, (res) => {
        console.log('✅ 后端服务器运行中 (状态码:', res.statusCode, ')');
        resolve();
      });
      req.on('error', (err) => {
        reject(new Error('后端服务器未运行: ' + err.message));
      });
      req.setTimeout(3000, () => {
        req.abort();
        reject(new Error('连接超时'));
      });
    });

    // 3. 连接Socket.IO客户端
    console.log('\n🔗 连接Socket.IO客户端...');
    client = io(serverUrl, {
      auth: {
        token: TEST_TOKEN
      },
      timeout: 5000,
      reconnection: false
    });

    // 等待连接成功
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Socket.IO连接超时'));
      }, 5000);

      client.on('connect', () => {
        clearTimeout(timeout);
        console.log('✅ Socket.IO连接成功 (ID:', client.id, ')');
        resolve();
      });

      client.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(new Error('Socket.IO连接失败: ' + error.message));
      });
    });

    // 4. 设置消息监听器
    const receivedMessages = [];
    client.on('message', (data) => {
      console.log('📩 收到消息:', data);
      receivedMessages.push(data);
    });

    // 5. 发送测试消息
    console.log('\n📤 发送测试消息...');
    const testMessage = {
      content: `Socket.IO测试消息 - ${new Date().toISOString()}`,
      receiverId: 'broadcast',
      type: 'text',
      isGroupChat: true
    };

    // 记录发送前的消息数
    const messageCountBefore = await Message.countDocuments();
    console.log('   发送前消息数:', messageCountBefore);

    // 发送消息
    client.emit('sendMessage', testMessage);
    console.log('✅ 测试消息已发送');

    // 6. 等待消息处理
    console.log('\n⏳ 等待消息处理...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 7. 检查是否收到广播消息
    if (receivedMessages.length > 0) {
      console.log('✅ 收到', receivedMessages.length, '条广播消息');
      receivedMessages.forEach((msg, index) => {
        console.log(`   ${index + 1}. ${msg.type}: ${msg.data?.content || '无内容'}`);
      });
    } else {
      console.log('⚠️ 未收到任何广播消息');
    }

    // 8. 检查消息是否保存到数据库
    console.log('\n🔍 检查数据库中的消息...');
    const messageCountAfter = await Message.countDocuments();
    console.log('   发送后消息数:', messageCountAfter);

    if (messageCountAfter > messageCountBefore) {
      console.log('✅ 消息已成功保存到数据库');
      
      // 查询最新消息
      const latestMessage = await Message.findOne()
        .sort({ timestamp: -1 })
        .lean();
      
      if (latestMessage && latestMessage.content.includes('Socket.IO测试消息')) {
        console.log('✅ 最新消息内容匹配:', latestMessage.content);
      } else {
        console.log('⚠️ 最新消息内容不匹配');
      }
    } else {
      console.log('❌ 消息未保存到数据库');
    }

    // 9. 测试结果总结
    console.log('\n📋 测试结果总结:');
    console.log('   ✅ Socket.IO连接成功');
    console.log('   ✅ 消息发送成功');
    console.log(`   ${receivedMessages.length > 0 ? '✅' : '❌'} 消息广播${receivedMessages.length > 0 ? '成功' : '失败'}`);
    console.log(`   ${messageCountAfter > messageCountBefore ? '✅' : '❌'} 消息持久化${messageCountAfter > messageCountBefore ? '成功' : '失败'}`);

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 解决方案:');
      console.log('   • 确保后端服务器正在运行 (npm run dev)');
      console.log('   • 检查端口5000是否被占用');
    } else if (error.message.includes('Socket.IO')) {
      console.log('\n💡 解决方案:');
      console.log('   • 检查JWT token是否有效');
      console.log('   • 确认Socket.IO服务配置正确');
      console.log('   • 查看服务器端日志');
    }
  } finally {
    // 清理连接
    if (client) {
      client.disconnect();
      console.log('\n🔌 Socket.IO客户端已断开');
    }
    
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('📡 MongoDB连接已关闭');
    }
  }
}

// 运行测试
testSocketMessaging().then(() => {
  console.log('\n✨ Socket.IO消息测试完成！');
  process.exit(0);
}).catch(error => {
  console.error('❌ 测试脚本执行失败:', error);
  process.exit(1);
});
