import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { createChildLogger } from '../utils/logger';

dotenv.config({ quiet: true });

const log = createChildLogger('config:db');

export interface MongoConnectionOverrides {
  uri?: string;
  autoIndex?: boolean;
  autoCreate?: boolean;
  quiet?: boolean;
}

type ActiveMongoConnection = {
  uri: string;
  options: mongoose.ConnectOptions;
  quiet: boolean;
};

let activeConnection: ActiveMongoConnection | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let connectInFlight = false;

const connectMongoDB = async (overrides: MongoConnectionOverrides = {}): Promise<void> => {
  const quiet = overrides.quiet === true;
  try {
    const mongoUri = overrides.uri ?? process.env.MONGODB_URI as string;
    if (!mongoUri) {
      throw new Error('环境变量 MONGODB_URI 未设置，请配置 MongoDB Atlas 连接字符串');
    }
    assertUriOwnership(mongoUri);
    if (reconnectTimer && activeConnection?.uri === mongoUri) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // 打印安全化后的连接信息（隐藏账号密码）
    try {
      const safeUri = mongoUri.replace(/(mongodb(?:\+srv)?:\/\/)([^:@]+):([^@]+)@/i, '$1***:***@');
      if (!quiet) log.info({ uri: safeUri }, '正在连接 MongoDB');
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
    if (overrides.autoIndex !== undefined) options.autoIndex = overrides.autoIndex;
    if (overrides.autoCreate !== undefined) options.autoCreate = overrides.autoCreate;

    // 可选：强制使用 IPv4
    try {
      const forceIPv4 = String(process.env.MONGODB_FORCE_IPV4 || '').toLowerCase() === 'true';
      if (forceIPv4) {
        (options as Record<string, unknown>).family = 4;
        if (!quiet) log.info('已启用 IPv4 连接偏好 (MONGODB_FORCE_IPV4=true)');
      }
    } catch {}

    // 可选：允许无效证书（仅限开发/排障）
    try {
      const allowInvalidCert = String(process.env.MONGODB_TLS_ALLOW_INVALID_CERTIFICATES || '').toLowerCase() === 'true';
      if (allowInvalidCert) {
        (options as Record<string, unknown>).tlsAllowInvalidCertificates = true;
        if (!quiet) log.warn('已启用 tlsAllowInvalidCertificates（仅建议用于开发/排障）');
      }
    } catch {}

    // 可选：直连单节点
    try {
      const direct = String(process.env.MONGODB_DIRECT_CONNECTION || '').toLowerCase() === 'true';
      if (direct) {
        (options as Record<string, unknown>).directConnection = true;
        if (!quiet) log.info('已启用 directConnection（MONGODB_DIRECT_CONNECTION=true）');
      }
    } catch {}

    activeConnection = { uri: mongoUri, options, quiet };
    connectInFlight = true;
    try {
      await mongoose.connect(mongoUri, options);
    } finally {
      connectInFlight = false;
    }

    if (!quiet) log.info('MongoDB 连接成功');

    mongoose.connection.off('error', handleConnectionError);
    mongoose.connection.off('disconnected', handleDisconnected);
    mongoose.connection.on('error', handleConnectionError);
    mongoose.connection.on('disconnected', handleDisconnected);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!quiet) log.error({ err: message }, 'MongoDB 连接失败');
    throw error;
  }
};

function assertUriOwnership(uri: string): void {
  if (!activeConnection || activeConnection.uri === uri) return;
  if (mongoose.connection.readyState === 0 && !reconnectTimer && !connectInFlight) return;
  throw new Error(
    'mongodb_connection_uri_change_forbidden: active MongoDB connection owns a different URI',
  );
}

function scheduleReconnect(): void {
  if (reconnectTimer || connectInFlight || !activeConnection) return;
  const delay = Number(process.env.MONGODB_RECONNECT_DELAY_MS) || 10000;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    const connection = activeConnection;
    if (!connection) return;

    let failed = false;
    connectInFlight = true;
    try {
      if (!connection.quiet) log.info('正在尝试重新连接 MongoDB...');
      await mongoose.connect(connection.uri, connection.options);
      if (!connection.quiet) log.info('MongoDB 重新连接成功');
    } catch (err: unknown) {
      failed = true;
      const message = err instanceof Error ? err.message : String(err);
      if (!connection.quiet) log.warn({ err: message }, 'MongoDB 重新连接失败');
    } finally {
      connectInFlight = false;
    }
    if (failed) scheduleReconnect();
  }, delay);
}

function handleConnectionError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (!activeConnection?.quiet) {
    log.warn({ err: message }, 'MongoDB 连接错误');
    const msg = message.toLowerCase();
    if (msg.includes('econnreset') || msg.includes('tls') || msg.includes('before secure tls')) {
      log.warn('排障提示: 可能存在 Atlas 网络访问或 TLS 握手问题');
    }
  }
  scheduleReconnect();
}

function handleDisconnected(): void {
  if (!activeConnection?.quiet) log.warn('MongoDB 连接已断开');
  scheduleReconnect();
}

const disconnectMongoDB = async (): Promise<void> => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  mongoose.connection.off('error', handleConnectionError);
  mongoose.connection.off('disconnected', handleDisconnected);
  activeConnection = null;
  connectInFlight = false;
  await mongoose.disconnect();
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
      if (!activeConnection?.quiet) {
        log.warn({ err: message }, '正在等待 MongoDB 连接期间发生错误');
      }
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

export { connectMongoDB, disconnectMongoDB, waitForMongoReady, isMongoConnected };
