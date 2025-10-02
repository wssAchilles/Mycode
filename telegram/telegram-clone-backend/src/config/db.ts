import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const connectMongoDB = async (): Promise<void> => {
  try {
    const mongoUri = process.env.MONGODB_URI as string;
    if (!mongoUri) {
      throw new Error('环境变量 MONGODB_URI 未设置，请配置 MongoDB Atlas 连接字符串');
    }
    
    // 打印安全化后的连接信息（隐藏账号密码）
    try {
      const safeUri = mongoUri.replace(/(mongodb(?:\+srv)?:\/\/)([^:@]+):([^@]+)@/i, '$1***:***@');
      console.log('🌐 正在连接 MongoDB:', safeUri);
    } catch {}
    
    // 连接选项：提升云端可用性与稳定性（支持通过环境变量调优）
    const options: mongoose.ConnectOptions = {
      serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS) || 30000,
      socketTimeoutMS: Number(process.env.MONGODB_SOCKET_TIMEOUT_MS) || 20000,
      connectTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS) || 30000,
      maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE) || 10,
      heartbeatFrequencyMS: 10000,
      // 不再在这里覆盖 retryWrites，沿用 URI 中的设置（Atlas 推荐 true）
      bufferCommands: false, // 禁用缓冲，避免离线时积压
    };

    // 可选：在某些网络/IPv6受限环境下，强制使用 IPv4 进行握手
    try {
      const forceIPv4 = String(process.env.MONGODB_FORCE_IPV4 || '').toLowerCase() === 'true';
      if (forceIPv4) {
        (options as any).family = 4;
        console.log('🌐 已启用 IPv4 连接偏好 (MONGODB_FORCE_IPV4=true)');
      }
    } catch {}

    // 可选：允许无效证书（用于企业网络 TLS 检视排障，仅限开发或临时）
    try {
      const allowInvalidCert = String(process.env.MONGODB_TLS_ALLOW_INVALID_CERTIFICATES || '').toLowerCase() === 'true';
      if (allowInvalidCert) {
        (options as any).tlsAllowInvalidCertificates = true;
        console.warn('⚠️ 已启用 tlsAllowInvalidCertificates（仅建议用于开发/排障）');
      }
    } catch {}

    // 可选：直连单节点（本地 MongoDB 或直连地址时有用）
    try {
      const direct = String(process.env.MONGODB_DIRECT_CONNECTION || '').toLowerCase() === 'true';
      if (direct) {
        (options as any).directConnection = true;
        console.log('🔌 已启用 directConnection（MONGODB_DIRECT_CONNECTION=true）');
      }
    } catch {}

    await mongoose.connect(mongoUri, options);
    
    console.log('✅ MongoDB 连接成功');
    
    // 自动重连调度（防止频繁重复重连）
    let reconnectTimer: NodeJS.Timeout | null = null;
    const scheduleReconnect = () => {
      if (reconnectTimer) return;
      const delay = Number(process.env.MONGODB_RECONNECT_DELAY_MS) || 10000; // 默认 10s
      reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        try {
          console.log('🔄 正在尝试重新连接 MongoDB...');
          await mongoose.connect(mongoUri, options);
          console.log('✅ MongoDB 重新连接成功');
        } catch (err: any) {
          console.warn('⚠️ MongoDB 重新连接失败:', err?.message || err);
          // 继续排队下一次重连
          scheduleReconnect();
        }
      }, delay);
    };

    // 监听连接事件（但不要导致崩溃）
    mongoose.connection.on('error', (error: any) => {
      console.warn('⚠️ MongoDB 连接错误:', error?.message || error);
      const msg = String(error?.message || '').toLowerCase();
      if (msg.includes('econnreset') || msg.includes('tls') || msg.includes('before secure tls')) {
        console.warn('💡 排障提示: 可能存在 Atlas 网络访问或 TLS 握手问题');
        console.warn('   • 请在 Atlas Network Access 中添加当前公网IP，或临时使用 0.0.0.0/0 进行排查');
        console.warn('   • 确认本机/公司网络未拦截 *.mongodb.net:27017 的出站连接（含TLS检视/代理）');
        console.warn('   • 若位于受限网络，尝试切换网络/热点后再试');
      }
      scheduleReconnect();
    });

    mongoose.connection.on('disconnected', () => {
      console.log('⚠️ MongoDB 连接已断开');
      scheduleReconnect();
    });

  } catch (error: any) {
    console.error('❌ MongoDB 连接失败:', error?.message || error);
    // 不要退出进程，只抛出错误
    throw error;
  }
};

// 判断 MongoDB 是否已连接
const isMongoConnected = (): boolean => {
  return (mongoose.connection.readyState === 1);
};

// 等待 MongoDB 就绪（初次连接或断开后重连）
const waitForMongoReady = (timeoutMs: number = 15000): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    // 已连接，立即返回
    if (mongoose.connection.readyState === 1) {
      return resolve();
    }

    const onConnected = () => {
      cleanup();
      resolve();
    };

    const onError = (err: any) => {
      // 出错时不立即拒绝，继续等待可能的后续连接事件
      // 这里只记录日志，避免频繁抛错
      console.warn('⚠️ 正在等待 MongoDB 连接期间发生错误:', err?.message || err);
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
