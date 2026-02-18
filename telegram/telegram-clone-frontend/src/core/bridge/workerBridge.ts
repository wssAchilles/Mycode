import * as Comlink from 'comlink';
import type { ChatCoreApi } from '../chat/types';

let worker: Worker | null = null;
let api: Comlink.Remote<ChatCoreApi> | null = null;
let generation = 0;

export function getChatCoreApi(): Comlink.Remote<ChatCoreApi> {
  if (api) return api;

  worker = new Worker(new URL('../workers/chatCore.worker.ts', import.meta.url), {
    type: 'module',
    name: 'chat-core',
  });

  const handleWorkerFault = () => {
    // The worker endpoint is no longer reliable. Clear cached handles so the next call recreates it.
    if (worker) {
      try {
        worker.terminate();
      } catch {
        // ignore
      }
    }
    worker = null;
    api = null;
  };

  worker.addEventListener('error', handleWorkerFault);
  worker.addEventListener('messageerror', handleWorkerFault);

  api = Comlink.wrap<ChatCoreApi>(worker);
  generation += 1;
  return api;
}

export function terminateChatCoreWorker(): void {
  if (worker) {
    worker.terminate();
  }
  worker = null;
  api = null;
}

export function getChatCoreWorkerGeneration(): number {
  return generation;
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
