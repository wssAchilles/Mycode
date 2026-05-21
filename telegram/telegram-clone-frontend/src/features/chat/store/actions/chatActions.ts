import chatCoreClient from '../../../../core/bridge/chatCoreClient';
import { authAPI } from '../../../../services/apiClient';
import { markChatSwitchStart } from '../../../../perf/marks';
import { resolveChatId } from '../messageUtils';
import type { MessageState } from '../messageTypes';
import type { SetState, GetState, MessageStoreDeps } from './types';

export function createChatActions(
  set: SetState,
  get: GetState,
  deps: MessageStoreDeps,
): Pick<MessageState, 'setActiveContact' | 'setVisibleRange' | 'clearMessages' | 'addMessage'> {
  return {
    setActiveContact: (contactId, isGroup = false) => {
      const { activeContactId, isGroupChat } = get();
      if (activeContactId === contactId && isGroupChat === isGroup) return;

      const nextLoadSeq = get().loadSeq + 1;
      const activeChatId = contactId ? resolveChatId(contactId, isGroup) : null;

      // Switching away from regular chat: show AI buffer (if any).
      if (!contactId) {
        deps.pendingPatches.length = 0;
        // Ensure worker doesn't treat the last opened chat as "active" (unread counts, etc).
        void (async () => {
          try {
            await deps.ensureCoreReady();
            await chatCoreClient.clearActiveChat();
          } catch {
            // ignore
          }
        })();

        deps.resetProjectionCaches();
        get().messageIds.length = 0;
        get().entities.clear();
        set({
          activeContactId: null,
          activeChatId: null,
          isGroupChat: false,
          hasMore: false,
          nextBeforeSeq: null,
          visibleStart: -1,
          visibleEnd: -1,
          isLoading: false,
          error: null,
          loadSeq: nextLoadSeq,
          messageIdsVersion: get().messageIdsVersion + 1,
        });
        return;
      }

      if (!activeChatId) {
        deps.pendingPatches.length = 0;
        deps.resetProjectionCaches();
        get().messageIds.length = 0;
        get().entities.clear();
        set({
          activeContactId: contactId,
          activeChatId: null,
          isGroupChat: isGroup,
          hasMore: true,
          nextBeforeSeq: null,
          visibleStart: -1,
          visibleEnd: -1,
          isLoading: false,
          error: '无法解析 chatId（请重新登录）',
          loadSeq: nextLoadSeq,
          messageIdsVersion: get().messageIdsVersion + 1,
        });
        return;
      }

      // Reset UI state immediately (instant shell).
      deps.pendingPatches.length = 0;
      deps.resetProjectionCaches();
      get().messageIds.length = 0;
      get().entities.clear();
      set({
        activeContactId: contactId,
        activeChatId,
        isGroupChat: isGroup,
        hasMore: true,
        nextBeforeSeq: null,
        visibleStart: -1,
        visibleEnd: -1,
        isLoading: true,
        error: null,
        loadSeq: nextLoadSeq,
        messageIdsVersion: get().messageIdsVersion + 1,
      });

      markChatSwitchStart(activeChatId, nextLoadSeq);

      // Fire-and-forget worker work; patches will stream back in batches.
      void (async () => {
        try {
          await deps.ensureCoreReady();

          await chatCoreClient.setActiveChat(activeChatId, isGroup, nextLoadSeq);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          // Handle auth expiry by refreshing token in main thread, then update worker tokens and retry once.
          if (errMsg === 'AUTH_ERROR') {
            try {
              const tokens = await authAPI.refreshToken();
              await chatCoreClient.updateTokens(tokens.accessToken, tokens.refreshToken);
              await chatCoreClient.setActiveChat(activeChatId, isGroup, nextLoadSeq);
              return;
            } catch (refreshErr: unknown) {
              const refreshMsg = refreshErr instanceof Error ? refreshErr.message : '认证失败，请重新登录';
              set({ error: refreshMsg, isLoading: false });
              return;
            }
          }

          set({ error: errMsg || '加载消息失败', isLoading: false });
        }
      })();
    },

    setVisibleRange: (start: number, end: number) => {
      const normalizedStart = Number.isFinite(start) ? Math.max(0, Math.floor(start)) : -1;
      const normalizedEnd =
        Number.isFinite(end) && normalizedStart >= 0 ? Math.max(normalizedStart, Math.floor(end)) : -1;

      const s = get();
      if (s.visibleStart === normalizedStart && s.visibleEnd === normalizedEnd) return;

      set({
        visibleStart: normalizedStart,
        visibleEnd: normalizedEnd,
      });
      deps.rebuildVisibleEntities();
    },

    addMessage: (message) => {
      const { activeContactId } = get();

      // AI mode: store locally (no worker).
      if (!activeContactId) {
        const isAiMessage = message.receiverId === 'ai' || message.senderId === 'ai';
        if (!isAiMessage) return;
        set((state) => {
          if (state.aiMessages.find((m) => m.id === message.id)) return state;
          const nextAi = [...state.aiMessages, message];
          return { aiMessages: nextAi };
        });
        return;
      }

      // Regular chats: forward to worker (batched patches will update UI).
      deps.ingestQueue.push(message);
      deps.trimIngestQueue();
      deps.flushIngestQueue();
    },

    clearMessages: () => {
      const nextLoadSeq = get().loadSeq + 1;
      const isInAiMode = !get().activeContactId;

      if (isInAiMode) {
        deps.resetProjectionCaches();
        set({
          aiMessages: [],
          visibleStart: -1,
          visibleEnd: -1,
          error: null,
          isLoading: false,
          loadSeq: nextLoadSeq,
        });
        return;
      }

      deps.resetProjectionCaches();
      get().messageIds.length = 0;
      get().entities.clear();
      set({
        activeContactId: null,
        activeChatId: null,
        isGroupChat: false,
        hasMore: true,
        nextBeforeSeq: null,
        visibleStart: -1,
        visibleEnd: -1,
        isLoading: false,
        error: null,
        loadSeq: nextLoadSeq,
        messageIdsVersion: get().messageIdsVersion + 1,
      });
    },
  };
}
