import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { createChildLogger } from '../utils/logger';

dotenv.config({ quiet: true });

const log = createChildLogger('config:db');

const connectMongoDB = async (): Promise<void> => {
  try {
    const mongoUri = process.env.MONGODB_URI as string;
    if (!mongoUri) {
      throw new Error('环境变量 MONGODB_URI 未设置，请配置 MongoDB Atlas 连接字符串');
    }

    // 打印安全化后的连接信息（隐藏账号密码）
    try {
      const safeUri = mongoUri.replace(/(mongodb(?:\+srv)?:\/\/)([^:@]+):([^@]+)@/i, '$1***:***@');
      log.info({ uri: safeUri }, '正在连接 MongoDB');
    } catch {}

    // 连接选项：提升云端可用性与稳定性（支持通过环境变量调优）
    const options: mongoose.ConnectOptions = {
      serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS) || 30000,
      socketTimeoutMS: Number(process.env.MONGODB_SOCKET_TIMEOUT_MS) || 20000,
      connectTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS) || 30000,
      maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE) || 10,
      minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE) || 2,
      maxIdleTimeMS: Number(process.env.MONGODB_MAX_IDLE_TIME_MS) || 30000,
      heartbeatFrequencyMS: 10000,
      bufferCommands: false,
    };

    // 可选：强制使用 IPv4
    try {
      const forceIPv4 = String(process.env.MONGODB_FORCE_IPV4 || '').toLowerCase() === 'true';
      if (forceIPv4) {
        (options as Record<string, unknown>).family = 4;
        log.info('已启用 IPv4 连接偏好 (MONGODB_FORCE_IPV4=true)');
      }
    } catch {}

    // 可选：允许无效证书（仅限开发/排障）
    try {
      const allowInvalidCert = String(process.env.MONGODB_TLS_ALLOW_INVALID_CERTIFICATES || '').toLowerCase() === 'true';
      if (allowInvalidCert) {
        (options as Record<string, unknown>).tlsAllowInvalidCertificates = true;
        log.warn('已启用 tlsAllowInvalidCertificates（仅建议用于开发/排障）');
      }
    } catch {}

    // 可选：直连单节点
    try {
      const direct = String(process.env.MONGODB_DIRECT_CONNECTION || '').toLowerCase() === 'true';
      if (direct) {
        (options as Record<string, unknown>).directConnection = true;
        log.info('已启用 directConnection（MONGODB_DIRECT_CONNECTION=true）');
      }
    } catch {}

    await mongoose.connect(mongoUri, options);

    log.info('MongoDB 连接成功');

    // 自动重连调度
    let reconnectTimer: NodeJS.Timeout | null = null;
    const scheduleReconnect = () => {
      if (reconnectTimer) return;
      const delay = Number(process.env.MONGODB_RECONNECT_DELAY_MS) || 10000;
      reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        try {
          log.info('正在尝试重新连接 MongoDB...');
          await mongoose.connect(mongoUri, options);
          log.info('MongoDB 重新连接成功');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          log.warn({ err: message }, 'MongoDB 重新连接失败');
          scheduleReconnect();
        }
      }, delay);
    };

    mongoose.connection.on('error', (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log.warn({ err: message }, 'MongoDB 连接错误');
      const msg = message.toLowerCase();
      if (msg.includes('econnreset') || msg.includes('tls') || msg.includes('before secure tls')) {
        log.warn('排障提示: 可能存在 Atlas 网络访问或 TLS 握手问题');
      }
      scheduleReconnect();
    });

    mongoose.connection.on('disconnected', () => {
      log.warn('MongoDB 连接已断开');
      scheduleReconnect();
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: message }, 'MongoDB 连接失败');
    throw error;
  }
};

const isMongoConnected = (): boolean => {
  return (mongoose.connection.readyState === 1);
};

const waitForMongoReady = (timeoutMs: number = 15000): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    if (mongoose.connection.readyState === 1) {
      return resolve();
    }

    const onConnected = () => { cleanup(); resolve(); };
    const onError = (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ err: message }, '正在等待 MongoDB 连接期间发生错误');
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('MongoDB未就绪，等待超时'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      mongoose.connection.off('connected', onConnected);
      mongoose.connection.off('error', onError);
    };

    mongoose.connection.on('connected', onConnected);
    mongoose.connection.on('error', onError);
  });
};

export { connectMongoDB, waitForMongoReady, isMongoConnected };
