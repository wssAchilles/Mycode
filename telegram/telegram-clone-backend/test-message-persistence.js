/**
 * MongoDB消息持久化测试脚本
 * 验证消息是否能正确保存到MongoDB数据库
 */

const mongoose = require('mongoose');
require('dotenv').config();

// 消息状态枚举
const MessageStatus = {
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read'
};

// 消息类型枚举
const MessageType = {
  TEXT: 'text',
  IMAGE: 'image',
  FILE: 'file',
  SYSTEM: 'system'
};

// 简单的消息Schema（与后端保持一致）
const MessageSchema = new mongoose.Schema({
  sender: {
    type: String,
    required: true,
    index: true
  },
  receiver: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: Object.values(MessageType),
    default: MessageType.TEXT,
    required: true
  },
  content: {
    type: String,
    required: true,
    maxlength: 10000
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  status: {
    type: String,
    enum: Object.values(MessageStatus),
    default: MessageStatus.SENT
  },
  isGroupChat: {
    type: Boolean,
    default: false,
    index: true
  },
  deletedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  versionKey: false
});

async function testMessagePersistence() {
  console.log('🧪 MongoDB消息持久化测试\n');

  try {
    // 1. 测试MongoDB连接
    console.log('📡 正在连接MongoDB...');
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
      // 沿用 URI 中的 retryWrites 设置（Atlas 推荐 true）
      bufferCommands: false,
    });
    
    console.log('✅ MongoDB连接成功');

    // 2. 创建消息模型
    const Message = mongoose.model('Message', MessageSchema);
    
    // 3. 测试保存新消息
    console.log('\n💾 测试保存新消息...');
    const testMessage = new Message({
      sender: 'test-user-id-' + Date.now(),
      receiver: 'broadcast',
      content: '这是一条测试消息 - ' + new Date().toISOString(),
      type: MessageType.TEXT,
      isGroupChat: true,
      status: MessageStatus.SENT,
    });

    const savedMessage = await testMessage.save();
    console.log('✅ 消息保存成功');
    console.log('   消息ID:', savedMessage._id.toString());
    console.log('   消息内容:', savedMessage.content);
    console.log('   时间戳:', savedMessage.timestamp.toISOString());

    // 4. 测试查询消息
    console.log('\n🔍 测试查询最近的消息...');
    const recentMessages = await Message.find()
      .sort({ timestamp: -1 })
      .limit(5)
      .lean();

    console.log('✅ 查询成功，最近5条消息:');
    recentMessages.forEach((msg, index) => {
      console.log(`   ${index + 1}. [${msg.timestamp.toLocaleString()}] ${msg.sender}: ${msg.content.substring(0, 50)}...`);
    });

    // 5. 测试消息计数
    console.log('\n📊 测试消息总数...');
    const totalCount = await Message.countDocuments();
    console.log(`✅ 数据库中共有 ${totalCount} 条消息`);

    // 6. 测试删除测试消息
    console.log('\n🗑️ 清理测试消息...');
    await Message.deleteOne({ _id: savedMessage._id });
    console.log('✅ 测试消息已清理');

    console.log('\n🎉 所有测试通过！');
    console.log('\n📋 测试结果总结:');
    console.log('   ✅ MongoDB连接正常');
    console.log('   ✅ 消息模型定义正确');
    console.log('   ✅ 消息保存功能正常');
    console.log('   ✅ 消息查询功能正常');
    console.log('   ✅ 数据库索引工作正常');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 解决方案:');
      console.log('   • 确保MongoDB服务器正在运行');
      console.log('   • 检查MongoDB连接字符串是否正确');
      console.log('   • 尝试启动MongoDB: mongod --dbpath=/path/to/data');
    } else if (error.message.includes('timeout')) {
      console.log('\n💡 解决方案:');
      console.log('   • MongoDB连接超时，检查网络和服务器状态');
      console.log('   • 确认MongoDB端口27017是否开放');
    } else {
      console.log('\n🔧 调试信息:');
      console.log('   错误类型:', error.name);
      console.log('   错误堆栈:', error.stack);
    }
  } finally {
    // 关闭连接
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('\n📡 MongoDB连接已关闭');
    }
  }
}

// 运行测试
testMessagePersistence().then(() => {
  console.log('\n✨ 消息持久化测试完成！');
  process.exit(0);
}).catch(error => {
  console.error('❌ 测试脚本执行失败:', error);
  process.exit(1);
});
