import * as Comlink from 'comlink';
import type {
  ChatCoreApi,
  ChatCoreInit,
  ChatPatch,
  ChatPrefetchTarget,
  ChatViewSnapshot,
  LoadSeq,
} from '../chat/types';
import type { Message } from '../../types/chat';
import type { SocketRealtimeEvent } from '../chat/realtime';
import { getChatCoreApi, getChatCoreWorkerGeneration, pingChatCoreWorker, terminateChatCoreWorker } from './workerBridge';
import { markWorkerRecoverEnd, markWorkerRecoverStart } from '../../perf/marks';

type SubscribeFn = (patches: ChatPatch[]) => void;

class ChatCoreClient {
  private api: Comlink.Remote<ChatCoreApi> | null = null;
  private initedUserId: string | null = null;
  private subscribed = false;
  private initParams: ChatCoreInit | null = null;
  private subscribeFn: SubscribeFn | null = null;
  private socketConnectedHint = true;
  private activeChatHint: { chatId: string; isGroup: boolean; loadSeq: LoadSeq } | null = null;
  private recoveryPromise: Promise<void> | null = null;

  private async getApi(): Promise<Comlink.Remote<ChatCoreApi>> {
    if (this.api) return this.api;
    this.api = getChatCoreApi();
    return this.api;
  }

  private resetLocalStateForRestart() {
    this.api = null;
    this.subscribed = false;
    this.initedUserId = null;
  }

  private isRecoverableError(err: unknown): boolean {
    const message = String((err as any)?.message || err || '');
    if (!message) return true;

    // Auth / server-side domain errors should be handled by callers.
    if (message === 'AUTH_ERROR') return false;
    if (message === 'NOT_AUTHENTICATED') return false;
    if (message === 'NOT_INITED') return false;
    if (message === 'CHAT_CURSOR_API_NOT_AVAILABLE') return false;
    if (message.startsWith('HTTP_')) return false;
    return true;
  }

  private async recoverWorker(reason: string): Promise<void> {
    if (this.recoveryPromise) return this.recoveryPromise;

    this.recoveryPromise = (async () => {
      const startGen = getChatCoreWorkerGeneration();
      markWorkerRecoverStart(startGen);

      try {
        terminateChatCoreWorker();
        this.resetLocalStateForRestart();

        // Without init context we cannot rehydrate; the next `init` call will do it.
        if (!this.initParams) {
          return;
        }

        const api = await this.getApi();
        await api.init(this.initParams);
        this.initedUserId = this.initParams.userId;

        if (this.subscribeFn) {
          await api.subscribe(Comlink.proxy(this.subscribeFn));
          this.subscribed = true;
        }

        await api.setConnectivity(this.socketConnectedHint);

        // Replay active-chat context so UI can recover by receiving a fresh reset patch.
        if (this.activeChatHint) {
          const ctx = this.activeChatHint;
          await api.setActiveChat(ctx.chatId, ctx.isGroup, ctx.loadSeq);
        } else {
          await api.clearActiveChat();
        }

        // eslint-disable-next-line no-console
        console.warn('[chat-core] worker recovered:', reason);
      } finally {
        markWorkerRecoverEnd(startGen);
      }
    })().finally(() => {
      this.recoveryPromise = null;
    });

    return this.recoveryPromise;
  }

  private async executeWithRecovery<T>(reason: string, op: (api: Comlink.Remote<ChatCoreApi>) => Promise<T>): Promise<T> {
    const api = await this.getApi();
    try {
      return await op(api);
    } catch (err) {
      if (!this.isRecoverableError(err)) {
        throw err;
      }
      await this.recoverWorker(reason);
      const retryApi = await this.getApi();
      return op(retryApi);
    }
  }

  async ensureHealthy(): Promise<void> {
    const ok = await pingChatCoreWorker();
    if (ok) return;
    await this.recoverWorker('healthcheck');
  }

  async init(params: ChatCoreInit): Promise<void> {
    this.initParams = params;
    await this.ensureHealthy();
    const api = await this.getApi();
    // Only re-init when the user changes.
    if (this.initedUserId !== params.userId) {
      await api.init(params);
      this.initedUserId = params.userId;
      this.subscribed = false;
    }
  }

  async updateTokens(accessToken: string, refreshToken?: string | null): Promise<void> {
    if (this.initParams) {
      this.initParams = {
        ...this.initParams,
        accessToken,
        refreshToken: refreshToken ?? this.initParams.refreshToken,
      };
    }
    await this.executeWithRecovery('updateTokens', (api) => api.updateTokens(accessToken, refreshToken));
  }

  async setConnectivity(socketConnected: boolean): Promise<void> {
    this.socketConnectedHint = socketConnected;
    await this.executeWithRecovery('setConnectivity', (api) => api.setConnectivity(socketConnected));
  }

  async subscribe(cb: SubscribeFn): Promise<void> {
    this.subscribeFn = cb;
    const api = await this.getApi();
    if (this.subscribed) return;
    await api.subscribe(Comlink.proxy(cb));
    this.subscribed = true;
  }

  async setActiveChat(chatId: string, isGroup: boolean, loadSeq: LoadSeq): Promise<void> {
    this.activeChatHint = { chatId, isGroup, loadSeq };
    await this.executeWithRecovery('setActiveChat', (api) => api.setActiveChat(chatId, isGroup, loadSeq));
  }

  async clearActiveChat(): Promise<void> {
    this.activeChatHint = null;
    await this.executeWithRecovery('clearActiveChat', (api) => api.clearActiveChat());
  }

  async prefetchChat(chatId: string, isGroup: boolean): Promise<void> {
    await this.executeWithRecovery('prefetchChat', (api) => api.prefetchChat(chatId, isGroup));
  }

  async prefetchChats(targets: ChatPrefetchTarget[]): Promise<void> {
    if (!Array.isArray(targets) || targets.length === 0) return;
    await this.executeWithRecovery('prefetchChats', (api) => api.prefetchChats(targets));
  }

  async getSnapshot(chatId: string, isGroup: boolean): Promise<ChatViewSnapshot> {
    return this.executeWithRecovery('getSnapshot', (api) => api.getSnapshot(chatId, isGroup));
  }

  async resolveMessages(chatId: string, isGroup: boolean, ids: string[]): Promise<Message[]> {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    return this.executeWithRecovery('resolveMessages', (api) => api.resolveMessages(chatId, isGroup, ids));
  }

  async searchMessages(chatId: string, isGroup: boolean, query: string, limit: number): Promise<Message[]> {
    return this.executeWithRecovery('searchMessages', (api) => api.searchMessages(chatId, isGroup, query, limit));
  }

  async loadMoreBefore(chatId: string, loadSeq: LoadSeq): Promise<void> {
    await this.executeWithRecovery('loadMoreBefore', (api) => api.loadMoreBefore(chatId, loadSeq));
  }

  async ingestMessages(messages: Message[]): Promise<void> {
    await this.executeWithRecovery('ingestMessages', (api) => api.ingestMessages(messages));
  }

  async ingestSocketMessages(rawMessages: any[]): Promise<void> {
    await this.executeWithRecovery('ingestSocketMessages', (api) => api.ingestSocketMessages(rawMessages));
  }

  async ingestRealtimeEvents(events: SocketRealtimeEvent[]): Promise<void> {
    await this.executeWithRecovery('ingestRealtimeEvents', (api) => api.ingestRealtimeEvents(events));
  }

  async ingestPresenceEvents(events: Array<{ userId: string; isOnline: boolean; lastSeen?: string }>): Promise<void> {
    await this.executeWithRecovery('ingestPresenceEvents', (api) => api.ingestPresenceEvents(events));
  }

  async ingestGroupUpdates(events: any[]): Promise<void> {
    await this.executeWithRecovery('ingestGroupUpdates', (api) => api.ingestGroupUpdates(events));
  }

  async applyReadReceipt(chatId: string, seq: number, readCount: number, currentUserId: string): Promise<void> {
    await this.executeWithRecovery('applyReadReceipt', (api) =>
      api.applyReadReceipt(chatId, seq, readCount, currentUserId),
    );
  }

  async applyReadReceiptsBatch(
    receipts: Array<{ chatId: string; seq: number; readCount: number }>,
    currentUserId: string,
  ): Promise<void> {
    await this.executeWithRecovery('applyReadReceiptsBatch', (api) =>
      api.applyReadReceiptsBatch(receipts, currentUserId),
    );
  }

  async shutdown(): Promise<void> {
    try {
      if (this.api) {
        await this.api.shutdown();
      }
    } finally {
      terminateChatCoreWorker();
      this.resetLocalStateForRestart();
      this.initParams = null;
      this.subscribeFn = null;
      this.activeChatHint = null;
      this.socketConnectedHint = true;
    }
  }
}

export const chatCoreClient = new ChatCoreClient();
export default chatCoreClient;
