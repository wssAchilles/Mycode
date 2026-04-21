import type { IMessage } from '../../models/Message';
import type { RealtimeDeliveryTarget } from './eventBusContracts';

export const ROOM_MESSAGE_SCHEMA_VERSION = 'room_message.v1' as const;

export interface RoomMessageDisplayEnvelope {
  schemaVersion: typeof ROOM_MESSAGE_SCHEMA_VERSION;
  chatId: string;
  messageId: string;
  seq: number;
  senderId: string;
  senderUsername: string;
  chatType: 'private' | 'group';
  createdAt: string;
  clientTempId?: string;
  displayEnvelope: {
    text: string;
    replyToMessageId?: string;
    mediaMetaLite?: {
      type: string;
      hasAttachments: boolean;
      attachmentCount: number;
      fileName?: string;
      fileSize?: number;
      mimeType?: string;
      thumbnailUrl?: string;
    };
    serviceFlags?: {
      isGroupChat: boolean;
      status?: string;
    };
    editVersion?: number;
    receiverId?: string;
    groupId?: string;
    type?: string;
    status?: string;
    attachments?: unknown[];
    fileUrl?: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    thumbnailUrl?: string;
  };
}

export function isRoomMessageDisplayEnvelope(
  value: unknown,
): value is RoomMessageDisplayEnvelope {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { schemaVersion?: unknown }).schemaVersion === ROOM_MESSAGE_SCHEMA_VERSION
  );
}

export function buildRoomMessageDisplayEnvelope(params: {
  message: IMessage;
  senderUsername: string;
  clientTempId?: string;
}): RoomMessageDisplayEnvelope {
  const { message, senderUsername, clientTempId } = params;
  const createdAt = message.timestamp instanceof Date
    ? message.timestamp.toISOString()
    : new Date(message.timestamp || Date.now()).toISOString();

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const attachmentCount = attachments.length;
  const type = String(message.type || 'text');

  return {
    schemaVersion: ROOM_MESSAGE_SCHEMA_VERSION,
    chatId: String(message.chatId || ''),
    messageId: message._id.toString(),
    seq: Number(message.seq || 0),
    senderId: String(message.sender || ''),
    senderUsername: senderUsername || '未知用户',
    chatType: message.chatType === 'group' ? 'group' : 'private',
    createdAt,
    clientTempId: clientTempId || undefined,
    displayEnvelope: {
      text: String(message.content || ''),
      replyToMessageId: message.replyTo ? String(message.replyTo) : undefined,
      mediaMetaLite: {
        type,
        hasAttachments: attachmentCount > 0,
        attachmentCount,
        fileName: message.fileName || attachments[0]?.fileName,
        fileSize: message.fileSize ?? attachments[0]?.fileSize,
        mimeType: message.mimeType || attachments[0]?.mimeType,
        thumbnailUrl: message.thumbnailUrl || attachments[0]?.thumbnailUrl,
      },
      serviceFlags: {
        isGroupChat: !!message.isGroupChat,
        status: message.status,
      },
      editVersion: message.editedAt ? 2 : 1,
      receiverId: message.chatType === 'private' ? String(message.receiver || '') : undefined,
      groupId: message.groupId ? String(message.groupId) : undefined,
      type,
      status: message.status,
      attachments,
      fileUrl: message.fileUrl || attachments[0]?.fileUrl,
      fileName: message.fileName || attachments[0]?.fileName,
      fileSize: message.fileSize ?? attachments[0]?.fileSize,
      mimeType: message.mimeType || attachments[0]?.mimeType,
      thumbnailUrl: message.thumbnailUrl || attachments[0]?.thumbnailUrl,
    },
  };
}

export function translateDisplayEnvelopeToCompatMessage(payload: unknown): unknown {
  if (!isRoomMessageDisplayEnvelope(payload)) {
    return payload;
  }

  return {
    id: payload.messageId,
    chatId: payload.chatId,
    chatType: payload.chatType,
    groupId: payload.displayEnvelope.groupId,
    seq: payload.seq,
    content: payload.displayEnvelope.text,
    senderId: payload.senderId,
    senderUsername: payload.senderUsername,
    userId: payload.senderId,
    username: payload.senderUsername,
    receiverId: payload.displayEnvelope.receiverId,
    timestamp: payload.createdAt,
    type: payload.displayEnvelope.type || 'text',
    isGroupChat: payload.displayEnvelope.serviceFlags?.isGroupChat ?? payload.chatType === 'group',
    status: payload.displayEnvelope.status || payload.displayEnvelope.serviceFlags?.status || 'delivered',
    attachments: payload.displayEnvelope.attachments,
    fileUrl: payload.displayEnvelope.fileUrl,
    fileName: payload.displayEnvelope.fileName,
    fileSize: payload.displayEnvelope.fileSize,
    mimeType: payload.displayEnvelope.mimeType,
    thumbnailUrl: payload.displayEnvelope.thumbnailUrl,
    clientTempId: payload.clientTempId,
  };
}

type DisplayDispatcher = (target: RealtimeDeliveryTarget, payload: RoomMessageDisplayEnvelope) => void;

let displayDispatcher: DisplayDispatcher | null = null;

export function registerRoomMessageDisplayDispatcher(dispatcher: DisplayDispatcher): void {
  displayDispatcher = dispatcher;
}

export function publishRoomMessageDisplay(
  targets: RealtimeDeliveryTarget[],
  payload: RoomMessageDisplayEnvelope,
): void {
  if (!displayDispatcher) {
    return;
  }

  for (const target of targets) {
    if (!target?.kind) continue;
    displayDispatcher(target, payload);
  }
}
