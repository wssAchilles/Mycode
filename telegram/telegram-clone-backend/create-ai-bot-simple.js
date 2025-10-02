// create-ai-bot-simple.js
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');

// 加载环境变量
dotenv.config();

async function createAiBot() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'telegram_clone',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '758205',
  });

  try {
    console.log('🤖 开始创建AI机器人用户...');

    // 连接数据库
    await client.connect();
    console.log('✅ 数据库连接成功');

    // 首先检查表结构，如果需要则添加新字段
    console.log('🔧 检查并更新用户表结构...');
    
    // 检查 lastSeen 字段是否存在
    const lastSeenCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'lastSeen'
    `);
    
    if (lastSeenCheck.rows.length === 0) {
      console.log('➕ 添加 lastSeen 字段...');
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN "lastSeen" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      `);
    }

    // 检查 isOnline 字段是否存在
    const isOnlineCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'isOnline'
    `);
    
    if (isOnlineCheck.rows.length === 0) {
      console.log('➕ 添加 isOnline 字段...');
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN "isOnline" BOOLEAN DEFAULT false
      `);
    }

    // 检查是否已存在AI机器人用户
    const existingBot = await client.query(`
      SELECT id, username, email 
      FROM users 
      WHERE username = 'Gemini AI'
    `);

    if (existingBot.rows.length > 0) {
      console.log('ℹ️ AI机器人用户已存在:', existingBot.rows[0]);
      return existingBot.rows[0];
    }

    // 创建AI机器人用户
    const botId = uuidv4();
    const hashedPassword = await bcrypt.hash('ai_bot_password_2024', 10);
    
    const insertQuery = `
      INSERT INTO users (
        id, username, email, password, "avatarUrl", "isOnline", "lastSeen", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, NOW(), NOW(), NOW()
      ) RETURNING id, username, email, "avatarUrl"
    `;

    const result = await client.query(insertQuery, [
      botId,
      'Gemini AI',
      'gemini-ai@telegram-clone.com',
      hashedPassword,
      'https://via.placeholder.com/150/4285f4/ffffff?text=AI',
      true // isOnline = true
    ]);

    const aiBot = result.rows[0];
    console.log('🎉 AI机器人用户创建成功!', aiBot);

    return aiBot;

  } catch (error) {
    console.error('❌ 创建AI机器人用户失败:', error);
    throw error;
  } finally {
    await client.end();
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
