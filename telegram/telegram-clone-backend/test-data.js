// 测试数据创建脚本
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// PostgreSQL 连接配置
const client = new Client({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USERNAME || 'postgres', // 使用 'user' 而不是 'username'
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DATABASE || 'telegram_clone',
});

async function createTestData() {
  try {
    await client.connect();
    console.log('✅ 连接到 PostgreSQL');

    // 创建测试用户
    const users = [
      { id: uuidv4(), username: 'alice', password: await bcrypt.hash('123456', 10) },
      { id: uuidv4(), username: 'bob', password: await bcrypt.hash('123456', 10) },
      { id: uuidv4(), username: 'charlie', password: await bcrypt.hash('123456', 10) }
    ];

    // 获取现有的 root 用户
    const rootUserQuery = await client.query(
      'SELECT id FROM users WHERE username = $1',
      ['root']
    );
    
    if (rootUserQuery.rows.length === 0) {
      console.log('❌ 找不到 root 用户');
      return;
    }
    
    const rootUserId = rootUserQuery.rows[0].id;
    console.log(`📝 Root 用户 ID: ${rootUserId}`);

    // 插入测试用户
    for (const user of users) {
      try {
        await client.query(
          'INSERT INTO users (id, username, password, "createdAt", "updatedAt") VALUES ($1, $2, $3, NOW(), NOW())',
          [user.id, user.username, user.password]
        );
        console.log(`✅ 创建用户: ${user.username}`);
      } catch (error) {
        if (error.code === '23505') { // 唯一约束冲突
          console.log(`⚠️ 用户 ${user.username} 已存在`);
        } else {
          console.error(`❌ 创建用户 ${user.username} 失败:`, error.message);
        }
      }
    }

    // 创建联系人关系 (root 和其他用户互为好友)
    const contactRelations = [
      { userId: rootUserId, contactId: users[0].id, status: 'accepted' }, // root -> alice
      { userId: users[0].id, contactId: rootUserId, status: 'accepted' }, // alice -> root
      { userId: rootUserId, contactId: users[1].id, status: 'accepted' }, // root -> bob
      { userId: users[1].id, contactId: rootUserId, status: 'accepted' }, // bob -> root
      { userId: users[2].id, contactId: rootUserId, status: 'pending' },   // charlie -> root (待处理)
    ];

    for (const relation of contactRelations) {
      try {
        await client.query(
          'INSERT INTO contacts (id, "userId", "contactId", status, added_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW())',
          [uuidv4(), relation.userId, relation.contactId, relation.status]
        );
        console.log(`✅ 创建联系人关系: ${relation.userId.substring(0, 8)} -> ${relation.contactId.substring(0, 8)} (${relation.status})`);
      } catch (error) {
        if (error.code === '23505') {
          console.log(`⚠️ 联系人关系已存在`);
        } else {
          console.error(`❌ 创建联系人关系失败:`, error.message);
        }
      }
    }

    console.log('🎉 测试数据创建完成!');
    console.log('📋 测试账户:');
    console.log('- alice / 123456');
    console.log('- bob / 123456');
    console.log('- charlie / 123456');
    console.log('- root 现在有 2 个好友和 1 个来自 charlie 的待处理请求');

  } catch (error) {
    console.error('❌ 创建测试数据失败:', error);
  } finally {
    await client.end();
  }
}

// 运行脚本
if (require.main === module) {
  createTestData();
}

module.exports = { createTestData };
