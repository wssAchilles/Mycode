const mongoose = require('mongoose');
require('dotenv').config();

async function testMessageOrder() {
  try {
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
    console.log('✅ MongoDB连接成功');
    
    // 消息模型
    const MessageSchema = new mongoose.Schema({
      sender: String,
      receiver: String,
      content: String,
      timestamp: { type: Date, default: Date.now },
      type: String,
      status: String,
      isGroupChat: Boolean
    });
    
    const Message = mongoose.model('Message', MessageSchema);
    
    const user1 = '9c1dbf36-a334-4a38-8ab8-c8fb8ba3a3b5'; // xzq
    const user2 = 'd75b6659-35d8-4c8e-84f6-2c62527b964a'; // root
    
    // 1. 查询MongoDB中的原始顺序
    console.log('\n🔍 MongoDB中的消息顺序（按时间降序，最新在前）:');
    const mongoMessages = await Message.find({
      $or: [
        { sender: user1, receiver: user2 },
        { sender: user2, receiver: user1 }
      ]
    }).sort({ timestamp: -1 }).limit(5);
    
    mongoMessages.forEach((msg, index) => {
      const direction = msg.sender === user1 ? 'xzq -> root' : 'root -> xzq';
      const time = msg.timestamp.toLocaleTimeString();
      console.log(`${index + 1}. [${direction}] "${msg.content}" (${time})`);
    });
    
    // 2. 模拟前端的reverse()操作
    console.log('\n🔄 前端reverse()后的顺序（最新在底部）:');
    const reversedMessages = [...mongoMessages].reverse();
    
    reversedMessages.forEach((msg, index) => {
      const direction = msg.sender === user1 ? 'xzq -> root' : 'root -> xzq';
      const time = msg.timestamp.toLocaleTimeString();
      console.log(`${index + 1}. [${direction}] "${msg.content}" (${time})`);
    });
    
    // 3. 检查最新消息是否在底部
    const latestMessage = reversedMessages[reversedMessages.length - 1];
    console.log(`\n✅ 最新消息："${latestMessage.content}" 现在在位置 ${reversedMessages.length}（底部）`);
    
  } catch (error) {
    console.error('❌ 测试失败:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ 数据库连接已关闭');
  }
}

testMessageOrder();
