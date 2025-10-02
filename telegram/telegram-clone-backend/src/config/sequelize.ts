import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const sequelize = new Sequelize({
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
    
    // 在开发环境下同步数据库
    if (process.env.NODE_ENV === 'development') {
      // 先导入所有模型以确保它们被初始化
      await import('../models/User');
      await import('../models/Contact');
      await import('../models/Group');
      await import('../models/GroupMember');
      await import('../models/Message');
      
      // 导入模型关联
      await import('../models/associations');
      
      await sequelize.sync({ alter: true });
      console.log('✅ 数据库模型同步完成');
    }
  } catch (error) {
    console.error('❌ PostgreSQL 连接失败:', error);
    throw error;
  }
};

export { sequelize, connectPostgreSQL };
