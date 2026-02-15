import * as Comlink from 'comlink';
import type { ChatCoreApi } from '../chat/types';

let worker: Worker | null = null;
let api: Comlink.Remote<ChatCoreApi> | null = null;

export function getChatCoreApi(): Comlink.Remote<ChatCoreApi> {
  if (api) return api;

  worker = new Worker(new URL('../workers/chatCore.worker.ts', import.meta.url), {
    type: 'module',
    name: 'chat-core',
  });

  api = Comlink.wrap<ChatCoreApi>(worker);
  return api;
}

export function terminateChatCoreWorker(): void {
  if (worker) {
    worker.terminate();
  }
  worker = null;
  api = null;
}

export async function pingChatCoreWorker(timeoutMs = 400): Promise<boolean> {
  try {
    const remote = getChatCoreApi();
    const timeout = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const result = await Promise.race([remote.ping(), timeout]);
    return result === 'pong';
  } catch {
    return false;
  }
}

