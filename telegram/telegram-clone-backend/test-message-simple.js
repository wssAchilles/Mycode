/**
 * 简化的消息持久化测试
 * 直接查询数据库验证消息是否被正确保存
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function checkMessagePersistence() {
  console.log('🔍 检查消息持久化状态\n');

  try {
    // 连接MongoDB
    const mongoUri = process.env.MONGODB_URI;
    // 安全打印连接字符串（隐藏账号密码）
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

    // 创建消息模型
    const MessageSchema = new mongoose.Schema({
      sender: String,
      receiver: String,
      content: String,
      type: String,
      timestamp: Date,
      status: String,
      isGroupChat: Boolean,
    }, { timestamps: true });

    const Message = mongoose.model('Message', MessageSchema);

    // 获取所有消息
    const messages = await Message.find()
      .sort({ timestamp: -1 })
      .limit(10)
      .lean();

    console.log(`\n📊 数据库中共有 ${await Message.countDocuments()} 条消息`);
    console.log('\n📝 最近10条消息:');
    
    if (messages.length === 0) {
      console.log('   (暂无消息)');
    } else {
      messages.forEach((msg, index) => {
        const time = new Date(msg.timestamp).toLocaleString();
        const content = msg.content ? msg.content.substring(0, 50) : '(无内容)';
        console.log(`   ${index + 1}. [${time}] ${msg.sender || '未知'}: ${content}${msg.content && msg.content.length > 50 ? '...' : ''}`);
      });
    }

    // 实时监听新消息（可选）
    console.log('\n👁️ 监听新消息变化 (10秒)...');
    const initialCount = await Message.countDocuments();
    
    await new Promise(resolve => {
      let checkCount = 0;
      const interval = setInterval(async () => {
        checkCount++;
        const currentCount = await Message.countDocuments();
        
        if (currentCount > initialCount) {
          console.log(`✅ 检测到新消息！总数从 ${initialCount} 增加到 ${currentCount}`);
          
          // 查询最新消息
          const newMessage = await Message.findOne().sort({ timestamp: -1 }).lean();
          console.log(`   最新消息: ${newMessage.content}`);
          console.log(`   发送者: ${newMessage.sender}`);
          console.log(`   时间: ${new Date(newMessage.timestamp).toLocaleString()}`);
        } else if (checkCount % 5 === 0) {
          console.log(`   检查中... (${checkCount}/10)`);
        }
        
        if (checkCount >= 10) {
          clearInterval(interval);
          if (currentCount === initialCount) {
            console.log('⚠️ 未检测到新消息');
          }
          resolve();
        }
      }, 1000);
    });

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('\n📡 MongoDB连接已关闭');
  }
}

checkMessagePersistence().then(() => {
  console.log('\n✨ 消息检查完成！');
  process.exit(0);
});
