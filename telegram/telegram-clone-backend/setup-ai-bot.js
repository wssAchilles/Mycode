const { Sequelize } = require('sequelize');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

// 加载环境变量
dotenv.config();

// 数据库配置
const sequelize = new Sequelize({
  dialect: 'postgres',
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5432,
  username: process.env.PG_USERNAME || 'postgres',
  password: process.env.PG_PASSWORD || '758205',
  database: process.env.PG_DATABASE || 'telegram_clone',
  logging: console.log
});

async function setupAIBot() {
  try {
    console.log('🤖 设置 AI 机器人用户...');

    // 连接数据库
    await sequelize.authenticate();
    console.log('✅ 数据库连接成功');

    // 检查 AI 机器人是否已存在
    const [results] = await sequelize.query(
      "SELECT * FROM \"users\" WHERE username = 'Gemini AI'",
      { type: Sequelize.QueryTypes.SELECT }
    );

    if (results && results.length > 0) {
      console.log('✅ Gemini AI 机器人用户已存在:');
      console.log('   ID:', results[0].id);
      console.log('   用户名:', results[0].username);
      console.log('   邮箱:', results[0].email);
      return results[0];
    }

    // 创建 AI 机器人用户
    console.log('🔧 创建 Gemini AI 机器人用户...');
    
    const hashedPassword = await bcrypt.hash('ai_bot_password_2025', 10);
    
    const [aiBot] = await sequelize.query(`
      INSERT INTO "users" (
        id, 
        username, 
        email, 
        password, 
        "avatarUrl", 
        "lastSeen", 
        "isOnline", 
        "createdAt", 
        "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'Gemini AI',
        'gemini@ai.bot',
        :password,
        'https://via.placeholder.com/40/4285f4/ffffff?text=AI',
        NOW(),
        true,
        NOW(),
        NOW()
      ) RETURNING *
    `, {
      replacements: { password: hashedPassword },
      type: Sequelize.QueryTypes.INSERT
    });

    console.log('✅ Gemini AI 机器人用户创建成功:');
    console.log('   ID:', aiBot[0].id);
    console.log('   用户名:', aiBot[0].username);
    console.log('   邮箱:', aiBot[0].email);
    
    // 验证创建结果
    const [verification] = await sequelize.query(
      "SELECT * FROM \"users\" WHERE username = 'Gemini AI'",
      { type: Sequelize.QueryTypes.SELECT }
    );
    
    console.log('🔍 验证 AI 机器人用户创建成功');
    
    return aiBot[0];

  } catch (error) {
    console.error('❌ 设置 AI 机器人失败:', error.message);
    
    // 提供更详细的错误信息
    if (error.message.includes('relation') && error.message.includes('does not exist')) {
      console.error('\n💡 解决方案:');
      console.error('   1. 确保 PostgreSQL 数据库正在运行');
      console.error('   2. 确保数据库表已创建（运行后端服务器会自动创建表）');
      console.error('   3. 检查数据库连接配置');
    }
    
    throw error;
  } finally {
    await sequelize.close();
  }
}

// 运行设置
if (require.main === module) {
  setupAIBot()
    .then(() => {
      console.log('\n🎉 AI 机器人设置完成！');
      console.log('\n📋 下一步:');
      console.log('   1. 启动后端服务器: npm run dev');
      console.log('   2. 在前端发送: /ai 你好');
      console.log('   3. 享受 AI 聊天功能！');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 设置失败:', error.message);
      process.exit(1);
    });
}

module.exports = { setupAIBot };
