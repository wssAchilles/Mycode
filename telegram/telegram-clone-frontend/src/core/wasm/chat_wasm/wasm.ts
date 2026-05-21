export type ChatWasmSeqPlan = {
  merged: Uint32Array;
  added: Uint32Array;
};

export type ChatWasmApi = {
  merge_sorted_unique_u32: (existing: Uint32Array, incoming: Uint32Array) => Uint32Array;
  diff_sorted_unique_u32: (existing: Uint32Array, incoming: Uint32Array) => Uint32Array;
  merge_and_diff_sorted_unique_u32: (existing: Uint32Array, incoming: Uint32Array) => ChatWasmSeqPlan;
  search_contains_indices: (messages: string[], query: string, limit: number) => Uint32Array;
  compact_message_patches: (patches: unknown[]) => unknown[];
  chat_wasm_version: () => string;
};

let cached: Promise<ChatWasmApi | null> | null = null;

/**
 * Check if SharedArrayBuffer is available (required for WASM threads)
 */
function hasSharedArrayBuffer(): boolean {
  try {
    return typeof SharedArrayBuffer !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Initialize thread pool if supported
 */
async function initThreadPool(mod: Record<string, unknown>, threadCount: number): Promise<void> {
  if (typeof mod.initThreadPool === 'function' && hasSharedArrayBuffer()) {
    try {
      await mod.initThreadPool(threadCount);
      console.info(`[chat-wasm] Thread pool initialized with ${threadCount} threads`);
    } catch (err) {
      console.warn('[chat-wasm] Thread pool init failed, using single thread:', err);
    }
  }
}

export function getChatWasmApi(): Promise<ChatWasmApi | null> {
  if (cached) return cached;

  cached = import('./pkg/chat_wasm.js')
    .then(async (mod: Record<string, unknown>) => {
      // wasm-pack `--target web` exports a default init() that loads the `.wasm`.
      if (typeof mod.default === 'function') {
        await mod.default();
      }

      // Try to initialize thread pool for parallel search
      const threadCount = Math.min(navigator.hardwareConcurrency || 4, 8);
      await initThreadPool(mod, threadCount);

      const api: ChatWasmApi = {
        merge_sorted_unique_u32: mod.merge_sorted_unique_u32 as ChatWasmApi['merge_sorted_unique_u32'],
        diff_sorted_unique_u32: mod.diff_sorted_unique_u32 as ChatWasmApi['diff_sorted_unique_u32'],
        merge_and_diff_sorted_unique_u32: (existing, incoming) => {
          const pair = mod.merge_and_diff_sorted_unique_u32(existing, incoming) as [Uint32Array | number[], Uint32Array | number[]];
          const mergedRaw = pair?.[0];
          const addedRaw = pair?.[1];
          const merged = mergedRaw instanceof Uint32Array ? mergedRaw : Uint32Array.from(mergedRaw || []);
          const added = addedRaw instanceof Uint32Array ? addedRaw : Uint32Array.from(addedRaw || []);
          return { merged, added };
        },
        search_contains_indices: mod.search_contains_indices as ChatWasmApi['search_contains_indices'],
        compact_message_patches: mod.compact_message_patches as ChatWasmApi['compact_message_patches'],
        chat_wasm_version: mod.chat_wasm_version as ChatWasmApi['chat_wasm_version'],
      };

      if (
        typeof api.merge_sorted_unique_u32 !== 'function' ||
        typeof api.diff_sorted_unique_u32 !== 'function' ||
        typeof api.merge_and_diff_sorted_unique_u32 !== 'function' ||
        typeof api.search_contains_indices !== 'function' ||
        typeof api.compact_message_patches !== 'function' ||
        typeof api.chat_wasm_version !== 'function'
      ) {
        throw new Error('WASM_API_MISSING_EXPORTS');
      }

      return api;
    })
    .catch((err) => {
      console.warn('[chat-wasm] disabled:', err);
      return null;
    });

  return cached;
}
