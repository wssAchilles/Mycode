import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';
import { createChildLogger } from '../utils/logger';

dotenv.config({ quiet: true });

const log = createChildLogger('config:sequelize');

const poolConfig = {
  max: 20,
  min: 2,
  acquire: 30000,
  idle: 10000,
};

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? (msg: string) => log.debug(msg) : false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
    pool: poolConfig,
  })
  : new Sequelize({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432'),
    username: process.env.PG_USERNAME || 'postgres',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'telegram_clone',
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? (msg: string) => log.debug(msg) : false,
    pool: poolConfig,
  });

const connectPostgreSQL = async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    log.info('PostgreSQL 连接成功');

    // 导入所有模型以确保它们被初始化
    await import('../models/User');
    await import('../models/Contact');
    await import('../models/Group');
    await import('../models/GroupMember');
    await import('../models/Message');
    await import('../models/NewsArticle');
    await import('../models/NewsSource');
    await import('../models/NewsUserEvent');
    await import('../models/NewsUserVector');
    await import('../models/Experiment');

    // 导入模型关联
    await import('../models/associations');

    if (process.env.NODE_ENV === 'development') {
      await sequelize.sync({ alter: true });
      log.info('数据库模型同步完成 (alter mode)');
    } else {
      await sequelize.sync();
      log.info('数据库模型同步完成 (create if not exists)');
    }
  } catch (error) {
    log.error({ err: error }, 'PostgreSQL 连接失败');
    throw error;
  }
};

export { sequelize, connectPostgreSQL };
