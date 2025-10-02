const mongoose = require('mongoose');
const { Sequelize } = require('sequelize');
const Redis = require('ioredis');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

async function testDatabases() {
  console.log('🧪 测试数据库连接...\n');

  // 测试 MongoDB
  console.log('📊 测试 MongoDB 连接...');
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
    console.log('✅ MongoDB 连接成功');
    await mongoose.disconnect();
  } catch (error) {
    console.log('❌ MongoDB 连接失败:', error.message);
  }

  // 测试 PostgreSQL
  console.log('\n🐘 测试 PostgreSQL 连接...');
  try {
    const sequelize = new Sequelize({
      host: process.env.PG_HOST || 'localhost',
      port: process.env.PG_PORT || 5432,
      username: process.env.PG_USERNAME || 'postgres',
      password: process.env.PG_PASSWORD || '',
      database: process.env.PG_DATABASE || 'telegram_clone',
      dialect: 'postgres',
      logging: false
    });
    
    await sequelize.authenticate();
    console.log('✅ PostgreSQL 连接成功');
    await sequelize.close();
  } catch (error) {
    console.log('❌ PostgreSQL 连接失败:', error.message);
  }

  // 测试 Redis
  console.log('\n🔴 测试 Redis 连接...');
  try {
    const client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined
    });
    
    await client.ping();
    console.log('✅ Redis 连接成功');
    client.disconnect();
  } catch (error) {
    console.log('❌ Redis 连接失败:', error.message);
  }

  console.log('\n🎯 数据库连接测试完成！');
}

testDatabases().catch(console.error);
