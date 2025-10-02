const { Sequelize } = require('sequelize');
const bcrypt = require('bcryptjs');

// 数据库配置
const sequelize = new Sequelize({
  dialect: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: '758205',
  database: 'telegram_clone',
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
      console.log('✅ Gemini AI 机器人用户已存在:', results[0]);
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

    console.log('✅ Gemini AI 机器人用户创建成功:', aiBot[0]);
    
    // 验证创建结果
    const [verification] = await sequelize.query(
      "SELECT * FROM \"users\" WHERE username = 'Gemini AI'",
      { type: Sequelize.QueryTypes.SELECT }
    );
    
    console.log('🔍 验证 AI 机器人用户:', verification[0]);
    
    return aiBot[0];

  } catch (error) {
    console.error('❌ 设置 AI 机器人失败:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// 运行设置
setupAIBot()
  .then(() => {
    console.log('🎉 AI 机器人设置完成！');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 设置失败:', error);
    process.exit(1);
  });
