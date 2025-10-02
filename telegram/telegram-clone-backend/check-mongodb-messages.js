const mongoose = require('mongoose');
require('dotenv').config();

// MongoDB连接
const connectMongoDB = async () => {
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
  } catch (error) {
    console.error('❌ MongoDB连接失败:', error);
    process.exit(1);
  }
};

// 消息模型
const MessageSchema = new mongoose.Schema({
  sender: String,
  receiver: String, 
  content: String,
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'system'],
    default: 'text'
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  },
  isGroupChat: {
    type: Boolean,
    default: false
  }
});

const Message = mongoose.model('Message', MessageSchema);

// 主函数
const main = async () => {
  console.log('🔍 检查MongoDB中的消息数据\n');

  // 连接数据库
  await connectMongoDB();

  // 查询所有消息
  console.log('📊 MongoDB中的所有消息:');
  const allMessages = await Message.find({}).sort({ timestamp: -1 });
  
  if (allMessages.length === 0) {
    console.log('❌ MongoDB中没有消息');
  } else {
    console.log(`✅ 找到 ${allMessages.length} 条消息:`);
    allMessages.forEach((msg, index) => {
      const time = msg.timestamp.toLocaleString('zh-CN');
      console.log(`   ${index + 1}. [${time}] ${msg.sender} -> ${msg.receiver}: "${msg.content}"`);
      console.log(`      ID: ${msg._id}, 类型: ${msg.type}, 群聊: ${msg.isGroupChat}`);
    });
  }

  // 统计各发送者和接收者
  console.log('\n📈 统计信息:');
  const senders = [...new Set(allMessages.map(m => m.sender))];
  const receivers = [...new Set(allMessages.map(m => m.receiver))];
  
  console.log(`   发送者: ${senders.join(', ')}`);
  console.log(`   接收者: ${receivers.join(', ')}`);

  // 关闭连接
  await mongoose.connection.close();
  console.log('\n✨ 检查完成！');
};

main().catch(error => {
  console.error('❌ 脚本执行失败:', error);
  process.exit(1);
});
