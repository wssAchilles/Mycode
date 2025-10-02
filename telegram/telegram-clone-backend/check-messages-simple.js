const mongoose = require('mongoose');
require('dotenv').config();

// 连接 MongoDB
async function checkMessages() {
  try {
    // 连接MongoDB
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
    
    // 消息模型（简化版）
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
    
    // 查询最近的消息
    console.log('\n🔍 查询最近10条消息...');
    const recentMessages = await Message.find()
      .sort({ timestamp: -1 })
      .limit(10);
    
    if (recentMessages.length === 0) {
      console.log('❌ 没有找到任何消息！');
    } else {
      console.log(`✅ 找到 ${recentMessages.length} 条消息:`);
      recentMessages.forEach((msg, index) => {
        console.log(`${index + 1}. ${msg.content} (${msg.sender} -> ${msg.receiver}) [${msg.timestamp}]`);
      });
    }
    
    // 查询两个特定用户之间的消息
    const user1 = '9c1dbf36-a334-4a38-8ab8-c8fb8ba3a3b5'; // xzq
    const user2 = 'd75b6659-35d8-4c8e-84f6-2c62527b964a'; // root
    
    console.log(`\n🔍 查询 ${user1} 和 ${user2} 之间的消息...`);
    const conversationMessages = await Message.find({
      $or: [
        { sender: user1, receiver: user2 },
        { sender: user2, receiver: user1 }
      ]
    }).sort({ timestamp: 1 });
    
    if (conversationMessages.length === 0) {
      console.log('❌ 这两个用户之间没有消息！');
    } else {
      console.log(`✅ 找到 ${conversationMessages.length} 条对话消息:`);
      conversationMessages.forEach((msg, index) => {
        const direction = msg.sender === user1 ? 'xzq -> root' : 'root -> xzq';
        console.log(`${index + 1}. [${direction}] ${msg.content} [${msg.timestamp}]`);
      });
    }
    
  } catch (error) {
    console.error('❌ 检查失败:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ 数据库连接已关闭');
  }
}

checkMessages();
