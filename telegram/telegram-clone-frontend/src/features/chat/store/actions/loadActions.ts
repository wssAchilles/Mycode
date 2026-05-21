import chatCoreClient from '../../../../core/bridge/chatCoreClient';
import { authAPI } from '../../../../services/apiClient';
import type { MessageState } from '../messageTypes';
import type { SetState, GetState, MessageStoreDeps } from './types';

export function createLoadActions(
  set: SetState,
  get: GetState,
  deps: MessageStoreDeps,
): Pick<MessageState, 'loadMoreMessages' | 'searchActiveChat' | 'loadMessageContext'> {
  return {
    searchActiveChat: async (query: string, limit = 50) => {
      const { activeChatId, activeContactId, isGroupChat } = get();
      if (!activeChatId || !activeContactId) return [];

      const keyword = query.trim();
      if (!keyword) return [];

      try {
        await deps.ensureCoreReady();
        return await chatCoreClient.searchMessages(activeChatId, isGroupChat, keyword, limit);
      } catch {
        return [];
      }
    },

    loadMessageContext: async (seq: number, limit = 30) => {
      const { activeChatId, activeContactId } = get();
      if (!activeChatId || !activeContactId) return [];
      if (!Number.isFinite(seq) || seq <= 0) return [];

      const normalizedLimit = Math.max(1, Math.min(100, Math.floor(limit)));

      try {
        await deps.ensureCoreReady();
        const context = await chatCoreClient.getMessageContext(
          activeChatId,
          Math.floor(seq),
          normalizedLimit,
        );
        return Array.isArray(context?.messages) ? context.messages : [];
      } catch {
        return [];
      }
    },

    loadMoreMessages: async () => {
      const { activeChatId, activeContactId, hasMore, isLoading, loadSeq } = get();
      if (!activeChatId || !activeContactId) return;
      if (isLoading || !hasMore) return;

      set({ isLoading: true, error: null });
      try {
        await deps.ensureCoreReady();
        await chatCoreClient.loadMoreBefore(activeChatId, loadSeq);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg === 'AUTH_ERROR') {
          try {
            const tokens = await authAPI.refreshToken();
            await chatCoreClient.updateTokens(tokens.accessToken, tokens.refreshToken);
            await chatCoreClient.loadMoreBefore(activeChatId, loadSeq);
            return;
          } catch (refreshErr: unknown) {
            const refreshMsg = refreshErr instanceof Error ? refreshErr.message : '认证失败，请重新登录';
            set({ error: refreshMsg, isLoading: false });
            return;
          }
        }
        set({ error: errMsg || '加载更多消息失败', isLoading: false });
      } finally {
        // If worker patches come back later, they'll set isLoading=false again; that's fine.
        if (get().activeChatId === activeChatId && get().loadSeq === loadSeq) {
          // Keep loading state if we are still waiting for patches.
          if (!get().isLoading) {
            set({ isLoading: false });
          }
        }
      }

      // Unified cursor paging is fully managed inside ChatCoreWorker.
    },
  };
}
