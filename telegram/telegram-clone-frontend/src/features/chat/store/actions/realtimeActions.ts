import chatCoreClient from '../../../../core/bridge/chatCoreClient';
import { enqueueMessage } from '../../../../core/chat/offlineQueue';
import { authUtils, messageAPI } from '../../../../services/apiClient';
import { resolveChatRuntimePolicy } from '../../../../core/chat/rolloutPolicy';
import type { SocketMessageSendPayload } from '../../../../core/chat/types';
import {
  createClientTempId,
  shouldFallbackToHttpSend,
  toHttpSendPayload,
  extractSentMessageRaw,
} from '../messageUtils';
import type { MessageState } from '../messageTypes';
import type { SetState, GetState, MessageStoreDeps } from './types';

export function createRealtimeActions(
  set: SetState,
  get: GetState,
  deps: MessageStoreDeps,
): Pick<
  MessageState,
  | 'connectRealtime'
  | 'disconnectRealtime'
  | 'setSocketConnected'
  | 'sendRealtimeMessage'
  | 'joinRealtimeRoom'
  | 'leaveRealtimeRoom'
  | 'markChatRead'
> {
  return {
    connectRealtime: () => {
      void (async () => {
        try {
          await deps.ensureCoreReady();
          const userId = authUtils.getCurrentUser()?.id || '';
          const runtimePolicy = userId ? resolveChatRuntimePolicy(userId) : null;
          await chatCoreClient.connectRealtime();
          try {
            const runtime = await chatCoreClient.getRuntimeInfo();
            const connected = runtime.connection?.socketConnected;
            const phase = runtime.connection?.phase;
            if (typeof connected === 'boolean') {
              set((state) => ({
                socketConnected: connected,
                syncPhase: phase || state.syncPhase,
                syncUpdatedAt: runtime.connection?.updatedAt || state.syncUpdatedAt,
                error: connected ? null : state.error,
              }));
            }
          } catch {
            // ignore runtime snapshot failures
          }
          deps.setWorkerRealtimeMode(!!runtimePolicy?.enableWorkerSocket);
          if (!deps.shouldBridgeLegacyRealtime()) {
            deps.clearRealtimeQueue();
          }
        } catch (err: unknown) {
          deps.setWorkerRealtimeMode(false);
          const reason = err instanceof Error ? err.message : String(err || 'UNKNOWN');
          set({
            socketConnected: false,
            syncPhase: reason === 'AUTH_ERROR' ? 'auth_error' : 'disconnected',
            error: `实时连接失败: ${reason}`,
          });
          // eslint-disable-next-line no-console
          console.error('[message-store] connectRealtime failed:', reason);
        }
      })();
    },

    disconnectRealtime: () => {
      void (async () => {
        try {
          await deps.ensureCoreReady();
          await chatCoreClient.disconnectRealtime();
        } catch {
          // ignore
        } finally {
          deps.setWorkerRealtimeMode(false);
        }
      })();
    },

    setSocketConnected: (connected: boolean) => {
      if (get().socketConnected === connected) return;
      set({ socketConnected: connected, syncPhase: connected ? 'live' : 'disconnected' });

      // Let the worker decide whether to start long-poll sync fallback.
      void (async () => {
        try {
          await deps.ensureCoreReady();
          await chatCoreClient.setConnectivity(connected);
        } catch {
          // ignore (e.g. not authenticated yet)
        }
      })();
    },

    sendRealtimeMessage: async (payload: SocketMessageSendPayload) => {
      if (!payload?.content) {
        return { success: false, error: 'EMPTY_MESSAGE' };
      }

      const normalizedClientTempId =
        typeof payload.clientTempId === 'string' && payload.clientTempId.trim()
          ? payload.clientTempId.trim()
          : createClientTempId();
      const payloadWithClientTempId = {
        ...payload,
        clientTempId: normalizedClientTempId,
      };
      deps.insertOptimisticPendingMessage(payloadWithClientTempId);

      const sendViaHttpFallback = async () => {
        const response = await messageAPI.sendMessage(toHttpSendPayload(payloadWithClientTempId));
        const sentRaw = extractSentMessageRaw(response);
        if (sentRaw) {
          sentRaw.clientTempId = sentRaw.clientTempId || normalizedClientTempId;
          try {
            await chatCoreClient.ingestSocketMessages([sentRaw]);
          } catch {
            // ignore optimistic-ingest failures; sync loop will reconcile
          }
        }

        return {
          success: true,
          clientTempId: normalizedClientTempId,
          messageId: (typeof sentRaw?.id === 'string' ? sentRaw.id : undefined) || (sentRaw?._id ? String(sentRaw._id) : undefined),
          seq: typeof sentRaw?.seq === 'number' ? sentRaw.seq : undefined,
        };
      };

      try {
        await deps.ensureCoreReady();
        const ack = await chatCoreClient.sendSocketMessage(payloadWithClientTempId);
        if (ack.success) {
          return {
            ...ack,
            clientTempId: ack.clientTempId || normalizedClientTempId,
          };
        }
        if (shouldFallbackToHttpSend(ack.error)) {
          try {
            return await sendViaHttpFallback();
          } catch (fallbackErr: unknown) {
            deps.removeOptimisticPendingMessage(normalizedClientTempId);
            return {
              success: false,
              error: (fallbackErr instanceof Error ? fallbackErr.message : null) || ack.error || 'SEND_FAILED',
            };
          }
        }
        deps.removeOptimisticPendingMessage(normalizedClientTempId);
        return ack;
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err || 'SEND_FAILED');
        if (shouldFallbackToHttpSend(reason)) {
          try {
            return await sendViaHttpFallback();
          } catch (fallbackErr: unknown) {
            deps.removeOptimisticPendingMessage(normalizedClientTempId);
            return {
              success: false,
              error: (fallbackErr instanceof Error ? fallbackErr.message : null) || reason,
            };
          }
        }
        // Enqueue for offline retry
        void enqueueMessage({
          chatId: payloadWithClientTempId.receiverId || payloadWithClientTempId.groupId || '',
          content: payloadWithClientTempId.content || '',
          senderId: '',
          clientTempId: normalizedClientTempId,
          vectorClock: { userId: '', timestamp: Date.now() },
        });
        deps.removeOptimisticPendingMessage(normalizedClientTempId);
        return {
          success: false,
          error: reason,
        };
      }
    },

    joinRealtimeRoom: (roomId: string) => {
      if (!roomId) return;
      void (async () => {
        try {
          await deps.ensureCoreReady();
          await chatCoreClient.joinRoom(roomId);
        } catch {
          // ignore
        }
      })();
    },

    leaveRealtimeRoom: (roomId: string) => {
      if (!roomId) return;
      void (async () => {
        try {
          await deps.ensureCoreReady();
          await chatCoreClient.leaveRoom(roomId);
        } catch {
          // ignore
        }
      })();
    },

    markChatRead: (chatId: string, seq: number) => {
      if (!chatId || typeof seq !== 'number' || seq <= 0) return;
      void messageAPI.markChatRead(chatId, seq).catch(() => undefined);
      void (async () => {
        try {
          await deps.ensureCoreReady();
          await chatCoreClient.markChatRead(chatId, seq);
        } catch {
          // ignore
        }
      })();
    },
  };
}
