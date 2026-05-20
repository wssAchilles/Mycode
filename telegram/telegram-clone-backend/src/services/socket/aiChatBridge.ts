import User from '../../models/User';
import { MessageType } from '../../models/Message';
import { waitForMongoReady } from '../../config/db';
import { generateUserAgentReply } from '../agentPlane/orchestrator/agentResponseService';
import { createAndFanoutMessage } from '../messageWriteService';
import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import { createChildLogger } from '../../utils/logger';
import type { TypedSocket, RealtimeBatchEvent } from './types';

const log = createChildLogger('services:socket:aiBridge');

export interface AiChatBridgeDeps {
  emitRealtimeToUser: (userId: string, event: RealtimeBatchEvent) => void;
  emitLegacyRealtimeEvents: boolean;
  io: any; // SocketIOServer instance for legacy emits
}

export class AiChatBridge {
  constructor(private deps: AiChatBridgeDeps) {}

  async handleAiMessage(
    socket: TypedSocket,
    messageContent: string,
    userId: string,
    username: string,
    imageData?: any,
  ): Promise<void> {
    try {
      const aiQuery = messageContent.substring(4).trim();

      if (!aiQuery) {
        socket.emit('message', {
          type: 'error',
          message: 'AI请求内容不能为空，请使用格式：/ai 你的问题',
        });
        return;
      }

      log.info({ aiQuery, username, hasImage: !!imageData }, '处理AI请求');

      await this.ensureMongoReady(socket);

      const aiBotId = await this.resolveAiBotId();

      // Persist the user's message to the AI bot
      const { message: userMessage } = await createAndFanoutMessage({
        senderId: userId,
        receiverId: aiBotId,
        chatType: 'private',
        content: messageContent,
        type: imageData ? MessageType.IMAGE : MessageType.TEXT,
        fileUrl: imageData?.fileUrl,
        fileName: imageData?.fileName,
        mimeType: imageData?.mimeType,
        fileSize: imageData?.fileSize,
      });

      this.emitUserMessageToSocket(userId, userMessage, username);

      // Call AI agent plane
      log.info('向 AI agent plane 发送请求...');
      const agentReply = await generateUserAgentReply({
        userId,
        message: aiQuery,
        imageData: imageData
          ? { mimeType: imageData.mimeType, base64Data: imageData.base64Data }
          : undefined,
      });

      log.info({ preview: agentReply.message.substring(0, 100) + '...' }, '收到AI回复');

      await this.sendAiResponse(agentReply.message, userId, aiBotId);

    } catch (error: any) {
      log.error({ err: error }, 'AI消息处理失败');
      socket.emit('message', {
        type: 'error',
        message: 'AI服务暂时不可用，请稍后再试',
      });
    }
  }

  private async sendAiResponse(
    aiMessage: string,
    userId: string,
    aiBotId: string,
  ): Promise<void> {
    try {
      const resolvedAiBotId = aiBotId || (await this.resolveAiBotId());

      await waitForMongoReady(15000);

      const { message: aiMessageDoc } = await createAndFanoutMessage({
        senderId: resolvedAiBotId,
        receiverId: userId,
        chatType: 'private',
        content: aiMessage,
        type: MessageType.TEXT,
      });

      const messageData = {
        id: aiMessageDoc._id.toString(),
        chatId: aiMessageDoc.chatId,
        chatType: aiMessageDoc.chatType,
        seq: aiMessageDoc.seq,
        content: aiMessageDoc.content,
        senderId: resolvedAiBotId,
        senderUsername: 'Gemini AI',
        userId: resolvedAiBotId,
        username: 'Gemini AI',
        receiverId: aiMessageDoc.receiver,
        timestamp: aiMessageDoc.timestamp.toISOString(),
        type: aiMessageDoc.type,
        isGroupChat: false,
        status: aiMessageDoc.status,
        attachments: aiMessageDoc.attachments || null,
      };

      if (this.deps.emitLegacyRealtimeEvents) {
        (this.deps.io as any).to(`user:${userId}`).emit('message', {
          type: 'chat',
          data: messageData,
        });
      }
      this.deps.emitRealtimeToUser(userId, {
        type: 'message',
        payload: messageData,
      });

      log.info(`AI回复已发送: "${aiMessage.substring(0, 100)}..."`);

    } catch (error) {
      log.error({ err: error }, '发送AI响应失败');
    }
  }

  private emitUserMessageToSocket(
    userId: string,
    userMessage: any,
    username: string,
  ): void {
    const userMessageData = {
      id: userMessage._id.toString(),
      chatId: userMessage.chatId,
      chatType: userMessage.chatType,
      seq: userMessage.seq,
      content: userMessage.content,
      senderId: userId,
      senderUsername: username,
      userId,
      username,
      receiverId: userMessage.receiver,
      timestamp: userMessage.timestamp.toISOString(),
      type: userMessage.type,
      isGroupChat: false,
      status: userMessage.status,
      attachments: userMessage.attachments || null,
      fileUrl: userMessage.fileUrl || undefined,
      fileName: userMessage.fileName || undefined,
      mimeType: userMessage.mimeType || undefined,
      fileSize: userMessage.fileSize || undefined,
    };

    if (this.deps.emitLegacyRealtimeEvents) {
      (this.deps.io as any).to(`user:${userId}`).emit('message', {
        type: 'chat',
        data: userMessageData,
      });
    }
    this.deps.emitRealtimeToUser(userId, {
      type: 'message',
      payload: userMessageData,
    });
  }

  private async resolveAiBotId(): Promise<string> {
    const aiBot = await User.findOne({ where: { username: 'Gemini AI' } });
    return aiBot?.id || 'ai';
  }

  private async ensureMongoReady(socket: TypedSocket): Promise<void> {
    try {
      await waitForMongoReady(15000);
    } catch {
      socket.emit('message', {
        type: 'error',
        message: '数据库未就绪，无法发送AI请求，请稍后重试',
      });
      throw new Error('MongoDB not ready');
    }
  }
}
