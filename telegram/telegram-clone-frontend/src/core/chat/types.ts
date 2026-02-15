import type { Message } from '../../types/chat';

export type ChatId = string;
export type LoadSeq = number;

export type ChatPatch =
  | {
      kind: 'reset';
      chatId: ChatId;
      loadSeq: LoadSeq;
      messages: Message[];
      hasMore: boolean;
      nextBeforeSeq: number | null;
    }
  | {
      kind: 'append';
      chatId: ChatId;
      loadSeq: LoadSeq;
      messages: Message[];
    }
  | {
      kind: 'prepend';
      chatId: ChatId;
      loadSeq: LoadSeq;
      messages: Message[];
      hasMore: boolean;
      nextBeforeSeq: number | null;
    }
  | {
      kind: 'delete';
      chatId: ChatId;
      loadSeq: LoadSeq;
      ids: string[];
    }
  | {
      kind: 'update';
      chatId: ChatId;
      loadSeq: LoadSeq;
      updates: Array<{
        id: string;
        status?: Message['status'];
        readCount?: number;
      }>;
    }
  | {
      // Chat list meta updates (last message preview, unread, presence).
      // Note: `chatId` here refers to the sidebar "list id":
      // - private: other user's id
      // - group: group id (without the `g:` prefix)
      kind: 'meta';
      lastMessages?: Array<{ chatId: string; message: Message }>;
      unreadDeltas?: Array<{ chatId: string; delta: number }>;
      onlineUpdates?: Array<{ userId: string; isOnline: boolean; lastSeen?: string }>;
      chatUpserts?: Array<{
        chatId: string;
        isGroup: boolean;
        title?: string;
        avatarUrl?: string;
        memberCount?: number;
      }>;
      chatRemovals?: Array<{ chatId: string }>;
    };

export interface ChatCoreInit {
  userId: string;
  accessToken: string;
  refreshToken?: string | null;
  apiBaseUrl: string;
}

export interface ChatCoreApi {
  init(params: ChatCoreInit): Promise<void>;
  updateTokens(accessToken: string, refreshToken?: string | null): Promise<void>;
  setConnectivity(socketConnected: boolean): Promise<void>;

  prefetchChat(chatId: ChatId, isGroup: boolean): Promise<void>;
  setActiveChat(chatId: ChatId, isGroup: boolean, loadSeq: LoadSeq): Promise<void>;
  clearActiveChat(): Promise<void>;
  loadMoreBefore(chatId: ChatId, loadSeq: LoadSeq): Promise<void>;

  ingestMessages(messages: Message[]): Promise<void>;
  // Prefer this for socket-driven ingestion so the main thread doesn't need to normalize payloads.
  ingestSocketMessages(rawMessages: any[]): Promise<void>;
  ingestPresenceEvents(events: Array<{ userId: string; isOnline: boolean; lastSeen?: string }>): Promise<void>;
  ingestGroupUpdates(events: any[]): Promise<void>;
  applyReadReceipt(chatId: ChatId, seq: number, readCount: number, currentUserId: string): Promise<void>;
  applyReadReceiptsBatch(
    receipts: Array<{ chatId: ChatId; seq: number; readCount: number }>,
    currentUserId: string,
  ): Promise<void>;

  subscribe(cb: (patches: ChatPatch[]) => void): Promise<void>;
  ping(): Promise<'pong'>;
  shutdown(): Promise<void>;
}
