const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
// 优先加载后端目录下的 .env
try {
  const envPathBackend = path.resolve(__dirname, 'telegram-clone-backend/.env');
  if (fs.existsSync(envPathBackend)) {
    require('dotenv').config({ path: envPathBackend });
  } else {
    require('dotenv').config();
  }
} catch {
  require('dotenv').config();
}

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

// 测试用户登录获取token
const loginUser = async () => {
  try {
    const response = await axios.post('http://localhost:5000/api/auth/login', {
      username: 'root',
      password: '123456'
    });
    return response.data.tokens.accessToken;
  } catch (error) {
    console.error('❌ 登录失败:', error.message);
    return null;
  }
};

// 查询特定对话的消息
const getConversationMessages = async (token, otherUserId) => {
  try {
    const response = await axios.get(
      `http://localhost:5000/api/messages/conversation/${otherUserId}?page=1&limit=50`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error(`❌ 查询对话失败 (${otherUserId}):`, error.message);
    return null;
  }
};

// 主函数
const main = async () => {
  console.log('🔍 测试对话消息查询\n');

  // 连接数据库
  await connectMongoDB();

  // 用户登录
  console.log('🔐 用户登录中...');
  const token = await loginUser();
  if (!token) {
    console.log('❌ 无法获取token，退出');
    process.exit(1);
  }
  console.log('✅ 登录成功\n');

  // 查询MongoDB中最近的消息
  console.log('📊 MongoDB中最近的消息:');
  const recentMessages = await Message.find({})
    .sort({ timestamp: -1 })
    .limit(5);
  
  if (recentMessages.length === 0) {
    console.log('❌ MongoDB中没有消息');
    process.exit(0);
  }

  recentMessages.forEach((msg, index) => {
    const time = msg.timestamp.toLocaleString('zh-CN');
    console.log(`   ${index + 1}. [${time}] ${msg.sender} -> ${msg.receiver}: ${msg.content}`);
  });

  // 获取最新消息的接收者ID，测试查询对话
  const latestMessage = recentMessages[0];
  const otherUserId = latestMessage.receiver;
  
  console.log(`\n🔍 测试查询与用户 ${otherUserId} 的对话:`);
  
  const conversationData = await getConversationMessages(token, otherUserId);
  if (conversationData && conversationData.messages) {
    console.log(`✅ API返回 ${conversationData.messages.length} 条消息:`);
    conversationData.messages.forEach((msg, index) => {
      const time = new Date(msg.timestamp).toLocaleString('zh-CN');
      console.log(`   ${index + 1}. [${time}] ${msg.senderUsername}: ${msg.content}`);
    });
  } else {
    console.log('❌ API查询失败或返回空结果');
  }

  // 关闭连接
  await mongoose.connection.close();
  console.log('\n✨ 测试完成！');
};

main().catch(error => {
  console.error('❌ 脚本执行失败:', error);
  process.exit(1);
});
