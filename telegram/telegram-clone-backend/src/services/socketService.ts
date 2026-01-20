import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { verifyAccessToken } from '../utils/jwt';
import { redis } from '../config/redis';
import User from '../models/User';
import Message, { MessageType, MessageStatus } from '../models/Message';
import { callGeminiAI } from '../controllers/aiController';
import { waitForMongoReady } from '../config/db';

// 在线用户接口
interface OnlineUser {
  userId: string;
  username: string;
  socketId: string;
  connectedAt: string;
}

// Socket 事件接口
interface ServerToClientEvents {
  message: (data: any) => void;
  userOnline: (user: { userId: string; username: string }) => void;
  userOffline: (user: { userId: string; username: string }) => void;
  onlineUsers: (users: OnlineUser[]) => void;
  authenticated: (data: { userId: string; username: string; message: string }) => void;
  authError: (data: { type: string; message: string }) => void;
  userTyping: (data: { userId: string; username: string; isTyping: boolean }) => void;
  userStatusChanged: (data: { userId: string; username: string; status: string }) => void;
}

interface ClientToServerEvents {
  sendMessage: (data: any) => void;
  join: (data: { token: string }) => void;
  joinRoom: (data: { roomId: string }) => void;
  leaveRoom: (data: { roomId: string }) => void;
  updateStatus: (data: { status: 'online' | 'offline' | 'away' }) => void;
  typing: (data: { receiverId: string; isTyping: boolean }) => void;
}

interface InterServerEvents {
  ping: () => void;
}

interface SocketData {
  userId?: string;
  username?: string;
}

export class SocketService {
  private io: SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >;

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: [
          'http://localhost:3000',
          'http://127.0.0.1:3000',
          'http://localhost:5173',
          'http://127.0.0.1:5173',
          'https://telegram-liart-rho.vercel.app', // Vercel 生产环境
          /\.vercel\.app$/, // 允许所有 Vercel 预览部署
        ],
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      console.log(`🔌 新的 Socket 连接: ${socket.id}`);

      // 用户加入房间（认证）
      socket.on('authenticate', async (data) => {
        try {
          await this.handleUserJoin(socket, data.token);
        } catch (error) {
          console.error('用户加入失败:', error);
          socket.emit('authError', {
            type: 'error',
            message: '认证失败，请重新登录',
          });
        }
      });

      // 处理消息发送
      socket.on('sendMessage', async (data) => {
        console.log('🎯 收到sendMessage事件:', {
          从用户: socket.data.username || '未知',
          用户ID: socket.data.userId || '未知',
          消息内容: data.content || '无内容',
          接收者: data.receiverId || 'broadcast',
          消息类型: data.type || 'text',
          是否群聊: data.isGroupChat || false
        });

        try {
          await this.handleMessage(socket, data);
        } catch (error: any) {
          console.error('❌ 消息处理失败:', error);
          socket.emit('message', {
            type: 'error',
            message: '消息发送失败: ' + (error?.message || '未知错误'),
          });
        }
      });

      // 处理断开连接
      socket.on('disconnect', async () => {
        await this.handleUserDisconnect(socket);
      });

      // 加入房间 (群聊/频道)
      socket.on('joinRoom', async (data) => {
        if (!socket.data.userId) {
          socket.emit('message', { type: 'error', message: '请先登录' });
          return;
        }
        const { roomId } = data;
        if (roomId) {
          await socket.join(`room:${roomId}`);
          console.log(`👥 用户 ${socket.data.username} 加入房间 ${roomId}`);
          socket.emit('message', { type: 'success', message: `已加入房间 ${roomId}` });
        }
      });

      // 离开房间
      socket.on('leaveRoom', async (data) => {
        const { roomId } = data;
        if (roomId) {
          await socket.leave(`room:${roomId}`);
          console.log(`👋 用户 ${socket.data.username} 离开房间 ${roomId}`);
        }
      });

      // 更新在线状态
      socket.on('updateStatus', async (data) => {
        if (!socket.data.userId) return;
        const { status } = data;
        // 广播状态变更
        socket.broadcast.emit('userStatusChanged', {
          userId: socket.data.userId,
          username: socket.data.username,
          status,
        });
        console.log(`📊 用户 ${socket.data.username} 状态变更为 ${status}`);
      });

      // 输入状态
      socket.on('typing', async (data) => {
        if (!socket.data.userId) return;
        const { receiverId, isTyping } = data;
        // 发送给接收者
        this.io.to(`user:${receiverId}`).emit('userTyping', {
          userId: socket.data.userId,
          username: socket.data.username,
          isTyping,
        });
      });
    });
  }

  // 处理用户加入（认证）
  private async handleUserJoin(socket: Socket, token: string): Promise<void> {
    if (!token) {
      throw new Error('缺少认证令牌');
    }

    // 验证 JWT 令牌
    const decoded = await verifyAccessToken(token);

    // 获取用户信息
    const user = await User.findByPk(decoded.userId);
    if (!user) {
      throw new Error('用户不存在');
    }

    // 设置 socket 数据
    socket.data.userId = user.id;
    socket.data.username = user.username;

    // 将用户加入个人房间（用于私聊）
    await socket.join(`user:${user.id}`);

    // 更新 Redis 中的在线状态
    await this.setUserOnline(user.id, user.username, socket.id);

    // 通知其他用户有新用户上线
    socket.broadcast.emit('userOnline', {
      userId: user.id,
      username: user.username,
    });

    // 向当前用户发送在线用户列表
    const onlineUsers = await this.getOnlineUsers();
    socket.emit('onlineUsers', onlineUsers);

    // 发送认证成功事件
    socket.emit('authenticated', {
      userId: user.id,
      username: user.username,
      message: `欢迎, ${user.username}！您已成功连接到聊天服务器。`,
    });

    // 也发送一个消息事件
    socket.emit('message', {
      type: 'success',
      message: `欢迎, ${user.username}！您已成功连接到聊天服务器。`,
    });

    console.log(`✅ 用户已认证并加入: ${user.username} (${user.id})`);
  }

  // 处理消息发送
  private async handleMessage(socket: Socket, data: any): Promise<void> {
    const { userId, username } = socket.data;

    if (!userId || !username) {
      throw new Error('用户未认证');
    }

    try {
      console.log('\n=== 消息处理调试 ===');
      console.log('📨 接收到的数据:', JSON.stringify(data, null, 2));

      // 验证消息内容
      if (!data.content || !data.content.trim()) {
        socket.emit('message', {
          type: 'error',
          message: '消息内容不能为空',
        });
        return;
      }

      // 检查是否为AI聊天请求
      const inputContent = data.content.trim();
      if (inputContent.startsWith('/ai ')) {
        console.log('🤖 检测到AI聊天请求:', inputContent);

        // 检查是否包含图片数据
        let imageData: any = null;
        if (data.imageData) {
          imageData = {
            mimeType: data.imageData.mimeType,
            base64Data: data.imageData.base64Data,
            fileName: data.imageData.fileName,
            fileSize: data.imageData.fileSize
          };

          console.log('🖼️ AI请求包含图片数据:', {
            mimeType: imageData.mimeType,
            fileName: imageData.fileName,
            hasBase64: !!imageData.base64Data
          });
        }

        await this.handleAiMessage(socket, inputContent, userId, username, imageData);
        return;
      }

      // 检查是否为JSON格式的AI图片消息
      try {
        const parsedData = JSON.parse(inputContent);
        if (parsedData.content && parsedData.imageData) {
          console.log('🤖 检测到JSON格式的AI图片请求:', parsedData.content);

          const aiMessage = `/ai ${parsedData.content}`;
          const imageData = {
            mimeType: parsedData.imageData.mimeType,
            base64Data: parsedData.imageData.base64Data,
            fileName: parsedData.imageData.fileName,
            fileSize: parsedData.imageData.fileSize
          };

          console.log('🖼️ JSON AI请求包含图片数据:', {
            mimeType: imageData.mimeType,
            fileName: imageData.fileName,
            hasBase64: !!imageData.base64Data
          });

          await this.handleAiMessage(socket, aiMessage, userId, username, imageData);
          return;
        }
      } catch {
        // 不是JSON格式，继续正常处理
      }

      // 确定接收者
      const receiverId = data.receiverId || 'broadcast';
      const isGroupChat = data.isGroupChat || receiverId === 'broadcast';

      // 智能分析消息类型和内容
      let messageType: string = 'text';
      let messageContent = inputContent;
      let fileMetadata: any = null;

      // 尝试解析JSON文件数据
      let parsedFileData: any = null;
      try {
        parsedFileData = JSON.parse(data.content);
        console.log('📋 解析到文件数据:', parsedFileData);
      } catch {
        // 如果不是JSON，就是普通文本消息
        console.log('📝 普通文本消息');
      }

      // 如果解析成功且包含文件信息，则为文件消息
      if (parsedFileData && parsedFileData.fileUrl && parsedFileData.fileName) {
        console.log('📁 检测到文件消息');

        // 根据MIME类型或文件扩展名确定消息类型
        messageType = this.determineMessageType(parsedFileData.mimeType, parsedFileData.fileName);
        messageContent = parsedFileData.fileName; // 使用文件名作为显示内容

        // 保存文件元数据供后续使用
        fileMetadata = {
          fileUrl: parsedFileData.fileUrl,
          fileName: parsedFileData.fileName,
          fileSize: parsedFileData.fileSize,
          mimeType: parsedFileData.mimeType,
          thumbnailUrl: parsedFileData.thumbnailUrl
        };

        console.log(`🏷️ 消息类型设定为: ${messageType}`);
        console.log(`📝 消息内容设定为: ${messageContent}`);
      } else if (data.type) {
        // 如果显式指定了类型，使用指定的类型
        messageType = data.type;
        console.log(`🏷️ 使用指定的消息类型: ${messageType}`);
      }

      // 在执行数据库操作前，确保 MongoDB 就绪
      try {
        await waitForMongoReady(15000);
      } catch (e: any) {
        socket.emit('message', {
          type: 'error',
          message: '数据库未就绪，请稍后重试',
        });
        return;
      }

      // 创建新消息并保存到数据库
      const messageDoc: any = {
        sender: userId,
        receiver: receiverId,
        content: fileMetadata ? JSON.stringify(fileMetadata) : messageContent, // 文件消息保存元数据，文本消息保存内容
        type: messageType as any, // 类型断言：字符串值与MessageType枚举值匹配
        isGroupChat,
        status: MessageStatus.DELIVERED,
      };

      // 如果是文件消息，添加文件相关字段
      if (fileMetadata) {
        messageDoc.fileUrl = fileMetadata.fileUrl;
        messageDoc.fileName = fileMetadata.fileName;
        messageDoc.fileSize = fileMetadata.fileSize;
        messageDoc.mimeType = fileMetadata.mimeType;
        messageDoc.thumbnailUrl = fileMetadata.thumbnailUrl;

        console.log('💾 文件消息元数据已添加到数据库文档');
      }

      const newMessage = new Message(messageDoc);
      const savedMessage = await newMessage.save();

      console.log('💾 消息已保存到数据库:', {
        id: savedMessage._id.toString(),
        type: savedMessage.type,
        content: savedMessage.content.substring(0, 50) + '...',
        hasFileData: !!fileMetadata
      });

      // 构造要广播的消息对象
      const messageData: any = {
        id: savedMessage._id.toString(),
        content: savedMessage.content,
        senderId: savedMessage.sender,
        senderUsername: username,
        // 兼容前端：提供 userId/username 字段
        userId: savedMessage.sender,
        username: username,
        timestamp: savedMessage.timestamp.toISOString(),
        type: savedMessage.type,
        isGroupChat: savedMessage.isGroupChat,
        status: savedMessage.status,
      };

      // 如果是文件消息，添加文件相关字段到广播数据
      if (fileMetadata) {
        messageData.fileUrl = savedMessage.fileUrl;
        messageData.fileName = savedMessage.fileName;
        messageData.fileSize = savedMessage.fileSize;
        messageData.mimeType = savedMessage.mimeType;
        messageData.thumbnailUrl = savedMessage.thumbnailUrl;

        console.log('📡 文件消息广播数据已准备');
      }

      // 广播消息
      if (isGroupChat || receiverId === 'broadcast') {
        // 群聊或广播消息：发送给所有连接的用户
        this.io.emit('message', {
          type: 'chat',
          data: messageData,
        });
      } else {
        // 私聊消息：发送给特定用户和发送者
        this.io.to(`user:${receiverId}`).emit('message', {
          type: 'chat',
          data: messageData,
        });

        // 也发送给发送者（确认消息已发送）
        socket.emit('message', {
          type: 'chat',
          data: messageData,
        });
      }

      console.log(`📨 消息已保存并发送: ${username} -> ${data.content?.substring(0, 50)}...`);

    } catch (error) {
      console.error('保存消息失败:', error);
      socket.emit('message', {
        type: 'error',
        message: '消息发送失败，请重试',
      });
    }
  }

  // 处理用户断开连接
  private async handleUserDisconnect(socket: Socket): Promise<void> {
    const { userId, username } = socket.data;

    if (userId && username) {
      // 从 Redis 中移除在线状态
      await this.setUserOffline(userId);

      // 通知其他用户有用户下线
      socket.broadcast.emit('userOffline', {
        userId,
        username,
      });

      console.log(`❌ 用户已断开连接: ${username} (${userId})`);
    }

    console.log(`🔌 Socket 连接已断开: ${socket.id}`);
  }

  // 处理AI聊天消息（支持多模态）
  private async handleAiMessage(socket: Socket, messageContent: string, userId: string, username: string, imageData?: any): Promise<void> {
    try {
      // 提取AI请求内容（移除'/ai '前缀）
      const aiQuery = messageContent.substring(4).trim();

      if (!aiQuery) {
        socket.emit('message', {
          type: 'error',
          message: 'AI请求内容不能为空，请使用格式：/ai 你的问题',
        });
        return;
      }

      console.log(`🤖 处理AI请求: "${aiQuery}" 来自用户 ${username}`, imageData ? '🖼️ 包含图片' : '');

      // 在执行数据库操作前，确保 MongoDB 就绪
      try {
        await waitForMongoReady(15000);
      } catch (e: any) {
        socket.emit('message', {
          type: 'error',
          message: '数据库未就绪，无法发送AI请求，请稍后重试',
        });
        return;
      }

      // 先保存用户的AI请求消息
      const userMessage = new Message({
        sender: userId,
        receiver: 'ai',
        content: messageContent, // 保存完整的命令
        type: imageData ? MessageType.IMAGE : MessageType.TEXT, // 如果有图片则标记为图片消息
        isGroupChat: false,
        status: MessageStatus.DELIVERED,
      });

      // 如果有图片数据，保存相关信息
      if (imageData) {
        userMessage.fileUrl = imageData.fileUrl;
        userMessage.fileName = imageData.fileName;
        userMessage.mimeType = imageData.mimeType;
        userMessage.fileSize = imageData.fileSize;
      }

      await userMessage.save();

      // 广播用户的AI请求消息
      const userMessageData: any = {
        id: userMessage._id.toString(),
        content: messageContent,
        senderId: userId,
        senderUsername: username,
        // 兼容前端：提供 userId/username 字段
        userId: userId,
        username: username,
        timestamp: userMessage.timestamp.toISOString(),
        type: imageData ? MessageType.IMAGE : MessageType.TEXT,
        isGroupChat: false,
        status: MessageStatus.DELIVERED,
      };

      // 如果有图片，添加图片相关字段
      if (imageData) {
        userMessageData.fileUrl = imageData.fileUrl;
        userMessageData.fileName = imageData.fileName;
        userMessageData.mimeType = imageData.mimeType;
        userMessageData.fileSize = imageData.fileSize;
      }

      // 广播用户消息
      this.io.emit('message', {
        type: 'chat',
        data: userMessageData,
      });

      // 调用简化的AI函数
      console.log('🔗 向Gemini AI发送请求...');
      const aiReply = await callGeminiAI(aiQuery, imageData ? {
        mimeType: imageData.mimeType,
        base64Data: imageData.base64Data
      } : undefined);

      console.log('✅ 收到AI回复:', aiReply.substring(0, 100) + '...');

      // 发送AI回复
      await this.sendAiResponse({ data: { message: aiReply } }, userId, username);

    } catch (error: any) {
      console.error('❌ AI消息处理失败:', error);
      socket.emit('message', {
        type: 'error',
        message: 'AI服务暂时不可用，请稍后再试',
      });
    }
  }

  // 发送AI成功响应
  private async sendAiResponse(aiResponse: any, userId: string, username: string): Promise<void> {
    try {
      const aiMessage = aiResponse.data?.message || '抱歉，我现在无法理解你的问题。';

      // 查找AI机器人用户
      const aiBot = await User.findOne({ where: { username: 'Gemini AI' } });
      const aiBotId = aiBot?.id || 'ai'; // 如果找不到就使用默认值

      // 在执行数据库操作前，确保 MongoDB 就绪
      await waitForMongoReady(15000);

      // 保存AI回复消息
      const aiMessageDoc = new Message({
        sender: aiBotId, // 使用实际的AI机器人用户ID
        receiver: userId,
        content: aiMessage,
        type: MessageType.TEXT,
        isGroupChat: false,
        status: MessageStatus.DELIVERED,
      });
      await aiMessageDoc.save();

      // 构建广播消息数据
      const messageData = {
        id: aiMessageDoc._id.toString(),
        content: aiMessage,
        senderId: aiBotId,
        senderUsername: 'Gemini AI',
        // 兼容前端：提供 userId/username 字段
        userId: aiBotId,
        username: 'Gemini AI',
        timestamp: aiMessageDoc.timestamp.toISOString(),
        type: MessageType.TEXT,
        isGroupChat: false,
        status: MessageStatus.DELIVERED,
      };

      // 广播AI回复
      this.io.emit('message', {
        type: 'chat',
        data: messageData,
      });

      console.log(`🤖 AI回复已发送: "${aiMessage.substring(0, 100)}..."`);;

    } catch (error) {
      console.error('❌ 发送AI响应失败:', error);
    }
  }

  // 发送AI错误响应
  private async sendAiError(errorResponse: any, socket: Socket): Promise<void> {
    const errorMessage = errorResponse.error || 'AI服务出现错误';
    socket.emit('message', {
      type: 'error',
      message: errorMessage,
    });
  }

  // 设置用户在线状态
  private async setUserOnline(userId: string, username: string, socketId: string): Promise<void> {
    try {
      const onlineUser: OnlineUser = {
        userId,
        username,
        socketId,
        connectedAt: new Date().toISOString(),
      };

      // 存储到 Redis
      await redis.hset('online_users', userId, JSON.stringify(onlineUser));
      await redis.expire('online_users', 86400); // 24小时过期

      // 同时设置用户最后活跃时间
      await redis.set(`user:${userId}:last_seen`, new Date().toISOString(), 'EX', 86400);
    } catch (error) {
      console.error('设置用户在线状态失败:', error);
    }
  }

  // 设置用户离线状态
  private async setUserOffline(userId: string): Promise<void> {
    try {
      // 从在线用户中移除
      await redis.hdel('online_users', userId);

      // 更新最后见过时间
      await redis.set(`user:${userId}:last_seen`, new Date().toISOString(), 'EX', 86400 * 7); // 7天
    } catch (error) {
      console.error('设置用户离线状态失败:', error);
    }
  }

  // 获取在线用户列表
  private async getOnlineUsers(): Promise<OnlineUser[]> {
    try {
      const onlineUsersData = await redis.hgetall('online_users');
      const onlineUsers: OnlineUser[] = [];

      for (const [userId, userData] of Object.entries(onlineUsersData)) {
        try {
          const user = JSON.parse(userData) as OnlineUser;
          onlineUsers.push(user);
        } catch (error) {
          console.error('解析在线用户数据失败:', error);
          // 移除损坏的数据
          await redis.hdel('online_users', userId);
        }
      }

      return onlineUsers;
    } catch (error) {
      console.error('获取在线用户列表失败:', error);
      return [];
    }
  }

  // 获取用户最后见过时间
  public async getUserLastSeen(userId: string): Promise<string | null> {
    try {
      return await redis.get(`user:${userId}:last_seen`);
    } catch (error) {
      console.error('获取用户最后见过时间失败:', error);
      return null;
    }
  }

  // 检查用户是否在线
  public async isUserOnline(userId: string): Promise<boolean> {
    try {
      const userData = await redis.hget('online_users', userId);
      return userData !== null;
    } catch (error) {
      console.error('检查用户在线状态失败:', error);
      return false;
    }
  }

  // 获取 Socket.IO 实例
  public getIO(): SocketIOServer {
    return this.io;
  }

  // 发送消息给指定用户
  public async sendMessageToUser(userId: string, message: any): Promise<void> {
    this.io.to(`user:${userId}`).emit('message', message);
  }

  // 根据MIME类型和文件名确定消息类型
  private determineMessageType(mimeType: string, fileName: string): string {
    console.log(`🔍 分析文件类型: mimeType="${mimeType}", fileName="${fileName}"`);

    if (!mimeType && !fileName) {
      return 'text';
    }

    // 先按MIME类型判断
    if (mimeType) {
      if (mimeType.startsWith('image/')) {
        console.log('🇮 识别为图片类型');
        return 'image';
      }

      if (mimeType.startsWith('audio/')) {
        console.log('🔉 识别为音频类型');
        return 'audio';
      }

      if (mimeType.startsWith('video/')) {
        console.log('🎥 识别为视频类型');
        return 'video';
      }

      // 其他类型的文件
      if (mimeType.includes('pdf')) {
        console.log('📄 识别为PDF文档');
        return 'document';
      }

      if (mimeType.includes('word') || mimeType.includes('officedocument')) {
        console.log('📝 识别为Office文档');
        return 'document';
      }

      if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) {
        console.log('📊 识别为Excel表格');
        return 'document';
      }

      if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) {
        console.log('📽 识别为PowerPoint演示');
        return 'document';
      }

      if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('compressed')) {
        console.log('🗜 识别为压缩文件');
        return 'document';
      }

      if (mimeType.includes('text/')) {
        console.log('📝 识别为文本文件');
        return 'document';
      }
    }

    // 如果MIME类型无法判断，按文件扩展名判断
    if (fileName) {
      const ext = fileName.toLowerCase();

      if (ext.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/)) {
        console.log('🇮 按扩展名识别为图片');
        return 'image';
      }

      if (ext.match(/\.(mp3|wav|flac|aac|ogg|m4a)$/)) {
        console.log('🔉 按扩展名识别为音频');
        return 'audio';
      }

      if (ext.match(/\.(mp4|avi|mov|mkv|wmv|flv|webm)$/)) {
        console.log('🎥 按扩展名识别为视频');
        return 'video';
      }

      if (ext.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|zip|rar|7z)$/)) {
        console.log('📄 按扩展名识别为文档');
        return 'document';
      }
    }

    // 默认为文档类型
    console.log('📄 默认识别为文档类型');
    return 'document';
  }
}

export default SocketService;
