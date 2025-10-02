// create-ai-bot.js
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const path = require('path');

// 加载环境变量
dotenv.config();

// 动态导入 TypeScript 模块
const { register } = require('ts-node');
register({
  project: path.join(__dirname, 'tsconfig.json'),
  transpileOnly: true
});

// 导入现有的用户模型
const User = require('./src/models/User.ts').default;
const { sequelize } = require('./src/config/sequelize.ts');

async function createAiBot() {
  try {
    console.log('🤖 开始创建AI机器人用户...');

    // 连接数据库
    await sequelize.authenticate();
    console.log('✅ 数据库连接成功');

    // 同步模型
    await sequelize.sync();

    // 检查是否已存在AI机器人用户
    const existingBot = await User.findOne({
      where: { username: 'Gemini AI' }
    });

    if (existingBot) {
      console.log('ℹ️ AI机器人用户已存在:', {
        id: existingBot.id,
        username: existingBot.username,
        email: existingBot.email
      });
      return existingBot;
    }

    // 创建AI机器人用户
    const hashedPassword = await bcrypt.hash('ai_bot_password_2024', 10);
    
    const aiBot = await User.create({
      username: 'Gemini AI',
      email: 'gemini-ai@telegram-clone.com',
      password: hashedPassword,
      avatarUrl: 'https://via.placeholder.com/150/4285f4/ffffff?text=AI',
      isOnline: true, // AI机器人始终在线
      lastSeen: new Date()
    });

    console.log('🎉 AI机器人用户创建成功!', {
      id: aiBot.id,
      username: aiBot.username,
      email: aiBot.email,
      avatarUrl: aiBot.avatarUrl
    });

    return aiBot;

  } catch (error) {
    console.error('❌ 创建AI机器人用户失败:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// 运行脚本
if (require.main === module) {
  createAiBot()
    .then(() => {
      console.log('✅ AI机器人用户设置完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 脚本执行失败:', error);
      process.exit(1);
    });
}

module.exports = { createAiBot };
