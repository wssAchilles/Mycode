import chatCoreClient from '../../../../core/bridge/chatCoreClient';
import { resolveChatId } from '../messageUtils';
import type { MessageState } from '../messageTypes';
import type { SetState, GetState, MessageStoreDeps } from './types';

export function createPrefetchActions(
  _set: SetState,
  get: GetState,
  deps: MessageStoreDeps,
): Pick<MessageState, 'prefetchChat' | 'prefetchChats'> {
  return {
    prefetchChat: (targetId: string, isGroup = false) => {
      get().prefetchChats([{ targetId, isGroup }]);
    },

    prefetchChats: (targets) => {
      if (!Array.isArray(targets) || targets.length === 0) return;

      const activeChatId = get().activeChatId;
      const now = Date.now();
      const accepted: Array<{ chatId: string; isGroup: boolean }> = [];

      for (const target of targets) {
        const chatId = resolveChatId(target?.targetId || '', !!target?.isGroup);
        if (!chatId) continue;
        if (chatId === activeChatId) continue;
        if (deps.prefetchInFlight.has(chatId)) continue;

        const lastAt = deps.prefetchLastAt.get(chatId) || 0;
        if (now - lastAt < deps.PREFETCH_COOLDOWN_MS) continue;

        deps.prefetchLastAt.set(chatId, now);
        deps.prefetchInFlight.add(chatId);
        accepted.push({ chatId, isGroup: !!target?.isGroup });
      }

      if (!accepted.length) return;

      void (async () => {
        try {
          await deps.ensureCoreReady();
          await chatCoreClient.prefetchChats(accepted);
        } catch {
          // ignore
        } finally {
          for (const target of accepted) {
            deps.prefetchInFlight.delete(target.chatId);
          }
        }
      })();
    },
  };
}
