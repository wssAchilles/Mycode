import * as Comlink from 'comlink';
import type { ChatCoreApi, ChatCoreInit, ChatPatch, LoadSeq } from '../chat/types';
import type { Message } from '../../types/chat';
import { getChatCoreApi, pingChatCoreWorker, terminateChatCoreWorker } from './workerBridge';

type SubscribeFn = (patches: ChatPatch[]) => void;

class ChatCoreClient {
  private api: Comlink.Remote<ChatCoreApi> | null = null;
  private initedUserId: string | null = null;
  private subscribed = false;

  private async getApi(): Promise<Comlink.Remote<ChatCoreApi>> {
    if (this.api) return this.api;
    this.api = getChatCoreApi();
    return this.api;
  }

  async ensureHealthy(): Promise<void> {
    const ok = await pingChatCoreWorker();
    if (ok) return;
    terminateChatCoreWorker();
    this.api = null;
    this.subscribed = false;
    this.initedUserId = null;
  }

  async init(params: ChatCoreInit): Promise<void> {
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
    const api = await this.getApi();
    await api.updateTokens(accessToken, refreshToken);
  }

  async setConnectivity(socketConnected: boolean): Promise<void> {
    const api = await this.getApi();
    await api.setConnectivity(socketConnected);
  }

  async subscribe(cb: SubscribeFn): Promise<void> {
    const api = await this.getApi();
    if (this.subscribed) return;
    await api.subscribe(Comlink.proxy(cb));
    this.subscribed = true;
  }

  async setActiveChat(chatId: string, isGroup: boolean, loadSeq: LoadSeq): Promise<void> {
    const api = await this.getApi();
    await api.setActiveChat(chatId, isGroup, loadSeq);
  }

  async clearActiveChat(): Promise<void> {
    const api = await this.getApi();
    await api.clearActiveChat();
  }

  async prefetchChat(chatId: string, isGroup: boolean): Promise<void> {
    const api = await this.getApi();
    await api.prefetchChat(chatId, isGroup);
  }

  async loadMoreBefore(chatId: string, loadSeq: LoadSeq): Promise<void> {
    const api = await this.getApi();
    await api.loadMoreBefore(chatId, loadSeq);
  }

  async ingestMessages(messages: Message[]): Promise<void> {
    const api = await this.getApi();
    await api.ingestMessages(messages);
  }

  async ingestSocketMessages(rawMessages: any[]): Promise<void> {
    const api = await this.getApi();
    await api.ingestSocketMessages(rawMessages);
  }

  async ingestPresenceEvents(events: Array<{ userId: string; isOnline: boolean; lastSeen?: string }>): Promise<void> {
    const api = await this.getApi();
    await api.ingestPresenceEvents(events);
  }

  async ingestGroupUpdates(events: any[]): Promise<void> {
    const api = await this.getApi();
    await api.ingestGroupUpdates(events);
  }

  async applyReadReceipt(chatId: string, seq: number, readCount: number, currentUserId: string): Promise<void> {
    const api = await this.getApi();
    await api.applyReadReceipt(chatId, seq, readCount, currentUserId);
  }

  async applyReadReceiptsBatch(
    receipts: Array<{ chatId: string; seq: number; readCount: number }>,
    currentUserId: string,
  ): Promise<void> {
    const api = await this.getApi();
    await api.applyReadReceiptsBatch(receipts, currentUserId);
  }

  async shutdown(): Promise<void> {
    if (!this.api) return;
    try {
      await this.api.shutdown();
    } finally {
      terminateChatCoreWorker();
      this.api = null;
      this.initedUserId = null;
      this.subscribed = false;
    }
  }
}

export const chatCoreClient = new ChatCoreClient();
export default chatCoreClient;
