import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  })
  : new Sequelize({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432'),
    username: process.env.PG_USERNAME || 'postgres',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'telegram_clone',
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  });

const connectPostgreSQL = async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    console.log('✅ PostgreSQL 连接成功');

    // 同步数据库模型（开发环境用 alter，生产环境用 sync）
    // 先导入所有模型以确保它们被初始化
    await import('../models/User');
    await import('../models/Contact');
    await import('../models/Group');
    await import('../models/GroupMember');
    await import('../models/Message');

    // 导入模型关联
    await import('../models/associations');

    if (process.env.NODE_ENV === 'development') {
      await sequelize.sync({ alter: true });
      console.log('✅ 数据库模型同步完成 (alter mode)');
    } else {
      // 生产环境：仅创建不存在的表，不修改已有表结构
      await sequelize.sync();
      console.log('✅ 数据库模型同步完成 (create if not exists)');
    }
  } catch (error) {
    console.error('❌ PostgreSQL 连接失败:', error);
    throw error;
  }
};

export { sequelize, connectPostgreSQL };
