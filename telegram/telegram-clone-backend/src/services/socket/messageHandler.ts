import { MessageType } from '../../models/Message';
import { waitForMongoReady } from '../../config/db';
import { createAndFanoutMessage } from '../messageWriteService';
import {
  buildRoomMessageDisplayEnvelope,
  publishRoomMessageDisplay,
} from '../realtimeProtocol/displayPlaneContract';
import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import { createChildLogger } from '../../utils/logger';
import type { TypedSocket } from './types';

const log = createChildLogger('services:socket:message');

export interface MessageHandlerDeps {
  handleAiMessage: (
    socket: TypedSocket,
    messageContent: string,
    userId: string,
    username: string,
    imageData?: any,
  ) => Promise<void>;
}

export class MessageHandler {
  constructor(private deps: MessageHandlerDeps) {}

  private getClientTempId(data: any): string | undefined {
    return typeof data?.clientTempId === 'string' && data.clientTempId.trim()
      ? data.clientTempId.trim()
      : undefined;
  }

  async handleMessage(
    socket: TypedSocket,
    data: any,
  ): Promise<{ message: any; seq: number } | null> {
    const { userId, username } = socket.data;

    if (!userId || !username) {
      throw new Error('用户未认证');
    }

    try {
      const inputContent = typeof data.content === 'string' ? data.content.trim() : '';

      // Check for AI chat request
      const aiResult = await this.tryHandleAiRequest(socket, data, inputContent, userId, username);
      if (aiResult !== undefined) return aiResult;

      // Validate chat type
      const inputChatType = data.chatType;
      if (inputChatType !== 'group' && inputChatType !== 'private') {
        throw new Error('chatType 必须为 private 或 group');
      }

      const receiverId = inputChatType === 'private' ? data.receiverId : undefined;
      const groupId = inputChatType === 'group' ? data.groupId : undefined;

      if (inputChatType === 'private' && !receiverId) {
        throw new Error('receiverId 不能为空');
      }
      if (inputChatType === 'group' && !groupId) {
        throw new Error('groupId 不能为空');
      }

      // Parse message type and attachments
      const { messageType, messageContent, attachments } = this.resolveMessageTypeAndAttachments(data, inputContent);

      if (!messageContent && (!attachments || attachments.length === 0)) {
        throw new Error('消息内容不能为空');
      }

      // Ensure MongoDB is ready
      if (!(await this.ensureMongoReady())) {
        throw new Error('数据库未就绪，请稍后重试');
      }

      // Persist and fanout message
      const writeStartedAt = Date.now();
      const { message: savedMessage, isDuplicate } = await createAndFanoutMessage({
        senderId: userId,
        receiverId,
        groupId: groupId || undefined,
        chatType: inputChatType,
        content: messageContent,
        type: messageType as MessageType,
        attachments,
        fileUrl: attachments?.[0]?.fileUrl || data.fileUrl,
        fileName: attachments?.[0]?.fileName || data.fileName,
        fileSize: attachments?.[0]?.fileSize || data.fileSize,
        mimeType: attachments?.[0]?.mimeType || data.mimeType,
        thumbnailUrl: attachments?.[0]?.thumbnailUrl || data.thumbnailUrl,
        clientTempId: this.getClientTempId(data),
      });

      // Publish room message display
      if (!isDuplicate) {
        this.publishDisplayMessage(savedMessage, username, data, inputChatType, groupId, receiverId, userId);
      }

      chatRuntimeMetrics.observeDuration('socket.sendMessage.writeLatencyMs', Date.now() - writeStartedAt);
      chatRuntimeMetrics.increment(`socket.sendMessage.chatType.${inputChatType}`);
      chatRuntimeMetrics.increment(`socket.sendMessage.messageType.${String(messageType || 'text')}`);

      return { message: savedMessage, seq: savedMessage.seq ?? 0 };

    } catch (error) {
      chatRuntimeMetrics.increment('socket.sendMessage.handleErrors');
      log.error({ err: error }, '保存消息失败');
      const message = error instanceof Error ? error.message : '消息发送失败，请重试';
      throw error instanceof Error ? error : new Error(message);
    }
  }

  determineMessageType(mimeType: string, fileName: string): string {
    log.info(`分析文件类型: mimeType="${mimeType}", fileName="${fileName}"`);

    if (!mimeType && !fileName) return 'text';

    if (mimeType) {
      if (mimeType.startsWith('image/')) return 'image';
      if (mimeType.startsWith('audio/')) return 'audio';
      if (mimeType.startsWith('video/')) return 'video';
      if (mimeType.includes('pdf')) return 'document';
      if (mimeType.includes('word') || mimeType.includes('officedocument')) return 'document';
      if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'document';
      if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return 'document';
      if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('compressed')) return 'document';
      if (mimeType.includes('text/')) return 'document';
    }

    if (fileName) {
      const ext = fileName.toLowerCase();
      if (ext.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/)) return 'image';
      if (ext.match(/\.(mp3|wav|flac|aac|ogg|m4a)$/)) return 'audio';
      if (ext.match(/\.(mp4|avi|mov|mkv|wmv|flv|webm)$/)) return 'video';
      if (ext.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|zip|rar|7z)$/)) return 'document';
    }

    return 'document';
  }

  private async tryHandleAiRequest(
    socket: TypedSocket,
    data: any,
    inputContent: string,
    userId: string,
    username: string,
  ): Promise<{ message: any; seq: number } | null | undefined> {
    // Check for /ai prefix
    if (inputContent.startsWith('/ai ')) {
      log.info({ data: inputContent }, '检测到AI聊天请求');
      const imageData = this.extractImageData(data);
      await this.deps.handleAiMessage(socket, inputContent, userId, username, imageData);
      return null;
    }

    // Check for JSON AI image message
    try {
      const parsedData = JSON.parse(inputContent);
      if (parsedData.content && parsedData.imageData) {
        log.info({ data: parsedData.content }, '检测到JSON格式的AI图片请求');
        const aiMessage = `/ai ${parsedData.content}`;
        const imageData = {
          mimeType: parsedData.imageData.mimeType,
          base64Data: parsedData.imageData.base64Data,
          fileName: parsedData.imageData.fileName,
          fileSize: parsedData.imageData.fileSize,
        };
        await this.deps.handleAiMessage(socket, aiMessage, userId, username, imageData);
        return null;
      }
    } catch {
      // Not JSON, continue normal processing
    }

    return undefined; // Not an AI request
  }

  private extractImageData(data: any): any {
    if (!data.imageData) return null;
    return {
      mimeType: data.imageData.mimeType,
      base64Data: data.imageData.base64Data,
      fileName: data.imageData.fileName,
      fileSize: data.imageData.fileSize,
    };
  }

  private resolveMessageTypeAndAttachments(
    data: any,
    inputContent: string,
  ): { messageType: string; messageContent: string; attachments: any[] | undefined } {
    let messageType: string = data.type || 'text';
    let messageContent = inputContent;
    let attachments: any[] | undefined = Array.isArray(data.attachments) ? data.attachments : undefined;

    // Fallback: build attachments from flat file fields
    if (!attachments && (data.fileUrl || data.fileName)) {
      attachments = [{
        fileUrl: data.fileUrl,
        fileName: data.fileName,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
        thumbnailUrl: data.thumbnailUrl,
      }];
    }

    // Try to parse JSON file data (legacy clients)
    let parsedFileData: any = null;
    try {
      parsedFileData = JSON.parse(data.content);
    } catch {
      // Not JSON, normal text
    }

    if (parsedFileData && parsedFileData.fileUrl && parsedFileData.fileName) {
      messageType = parsedFileData.type || this.determineMessageType(parsedFileData.mimeType, parsedFileData.fileName);
      messageContent = parsedFileData.content || parsedFileData.fileName || messageContent;
      attachments = [{
        fileUrl: parsedFileData.fileUrl,
        fileName: parsedFileData.fileName,
        fileSize: parsedFileData.fileSize,
        mimeType: parsedFileData.mimeType,
        thumbnailUrl: parsedFileData.thumbnailUrl,
      }];
    } else if (attachments && attachments.length > 0 && messageType === 'text') {
      const first = attachments[0];
      messageType = this.determineMessageType(first.mimeType, first.fileName);
    }

    return { messageType, messageContent, attachments };
  }

  private async ensureMongoReady(): Promise<boolean> {
    try {
      await waitForMongoReady(15000);
      return true;
    } catch {
      return false;
    }
  }

  private publishDisplayMessage(
    savedMessage: any,
    username: string,
    data: any,
    inputChatType: string,
    groupId: string | undefined,
    receiverId: string | undefined,
    userId: string,
  ): void {
    const roomMessagePayload = buildRoomMessageDisplayEnvelope({
      message: savedMessage,
      senderUsername: username,
      clientTempId: this.getClientTempId(data),
    });

    if (inputChatType === 'group' && groupId) {
      publishRoomMessageDisplay([{ kind: 'room', id: groupId }], roomMessagePayload);
    } else if (receiverId) {
      publishRoomMessageDisplay(
        [
          { kind: 'user', id: receiverId },
          { kind: 'user', id: userId },
        ],
        roomMessagePayload,
      );
    }
  }
}
