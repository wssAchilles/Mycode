import type { Message } from '../../../types/chat';
import type { ChatSyncPhase, SocketMessageSendPayload } from '../../../core/chat/types';
import type { SocketRealtimeEvent } from '../../../core/chat/realtime';

export interface MessageState {
  // Regular chat projection (active chat only).
  // Keep these as mutable structures; use version counters to trigger minimal rerenders.
  messageIds: string[];
  messageIdsVersion: number;
  visibleStart: number;
  visibleEnd: number;
  entities: Map<string, Message>;

  // Local-only AI chat buffer (regular chat is driven by worker patches).
  aiMessages: Message[];

  // Active chat selection
  activeContactId: string | null;
  activeChatId: string | null;
  isGroupChat: boolean;

  // Paging state (unified cursor for groups/new endpoint; legacy private paging is handled in worker)
  hasMore: boolean;
  nextBeforeSeq: number | null;

  // Loading / errors
  isLoading: boolean;
  error: string | null;

  // Socket connectivity hint (for worker sync fallback)
  socketConnected: boolean;
  syncPhase: ChatSyncPhase;
  syncPts: number;
  syncUpdatedAt: number;

  // Monotonic seq to ignore stale async work during fast chat switches.
  loadSeq: number;

  // Actions
  setActiveContact: (contactId: string | null, isGroup?: boolean) => void;
  setVisibleRange: (start: number, end: number) => void;
  connectRealtime: () => void;
  disconnectRealtime: () => void;
  setSocketConnected: (connected: boolean) => void;
  sendRealtimeMessage: (payload: SocketMessageSendPayload) => Promise<{ success: boolean; messageId?: string; seq?: number; error?: string }>;
  joinRealtimeRoom: (roomId: string) => void;
  leaveRealtimeRoom: (roomId: string) => void;
  markChatRead: (chatId: string, seq: number) => void;
  prefetchChat: (targetId: string, isGroup?: boolean) => void;
  prefetchChats: (targets: Array<{ targetId: string; isGroup?: boolean }>) => void;
  searchActiveChat: (query: string, limit?: number) => Promise<Message[]>;
  loadMessageContext: (seq: number, limit?: number) => Promise<Message[]>;
  loadMoreMessages: () => Promise<void>;
  addMessage: (message: Message) => void;
  ingestSocketMessage: (raw: unknown) => void;
  ingestSocketMessages: (rawMessages: unknown[]) => void;
  ingestRealtimeEvents: (events: SocketRealtimeEvent[]) => void;
  ingestPresenceEvent: (event: { userId: string; isOnline: boolean; lastSeen?: string }) => void;
  ingestPresenceEvents: (events: Array<{ userId: string; isOnline: boolean; lastSeen?: string }>) => void;
  ingestReadReceiptEvent: (event: { chatId: string; seq: number; readCount: number }) => void;
  ingestReadReceiptEvents: (events: Array<{ chatId: string; seq: number; readCount: number }>) => void;
  ingestGroupUpdateEvent: (event: unknown) => void;
  ingestGroupUpdateEvents: (events: unknown[]) => void;
  applyReadReceipt: (chatId: string, seq: number, readCount: number, currentUserId: string) => void;
  clearMessages: () => void;
}
