export type ChatWasmSeqPlan = {
  merged: Uint32Array;
  added: Uint32Array;
};

export type ChatWasmApi = {
  merge_sorted_unique_u32: (existing: Uint32Array, incoming: Uint32Array) => Uint32Array;
  diff_sorted_unique_u32: (existing: Uint32Array, incoming: Uint32Array) => Uint32Array;
  merge_and_diff_sorted_unique_u32: (existing: Uint32Array, incoming: Uint32Array) => ChatWasmSeqPlan;
  search_contains_indices: (messages: string[], query: string, limit: number) => Uint32Array;
  chat_wasm_version: () => string;
};

let cached: Promise<ChatWasmApi | null> | null = null;

export function getChatWasmApi(): Promise<ChatWasmApi | null> {
  if (cached) return cached;

  cached = import('./pkg/chat_wasm.js')
    .then(async (mod: any) => {
      // wasm-pack `--target web` exports a default init() that loads the `.wasm`.
      if (typeof mod.default === 'function') {
        await mod.default();
      }

      const api: ChatWasmApi = {
        merge_sorted_unique_u32: mod.merge_sorted_unique_u32 as ChatWasmApi['merge_sorted_unique_u32'],
        diff_sorted_unique_u32: mod.diff_sorted_unique_u32 as ChatWasmApi['diff_sorted_unique_u32'],
        merge_and_diff_sorted_unique_u32: (existing, incoming) => {
          const pair = mod.merge_and_diff_sorted_unique_u32(existing, incoming) as any;
          const mergedRaw = pair?.[0];
          const addedRaw = pair?.[1];
          const merged = mergedRaw instanceof Uint32Array ? mergedRaw : Uint32Array.from(mergedRaw || []);
          const added = addedRaw instanceof Uint32Array ? addedRaw : Uint32Array.from(addedRaw || []);
          return { merged, added };
        },
        search_contains_indices: mod.search_contains_indices as ChatWasmApi['search_contains_indices'],
        chat_wasm_version: mod.chat_wasm_version as ChatWasmApi['chat_wasm_version'],
      };

      if (
        typeof api.merge_sorted_unique_u32 !== 'function' ||
        typeof api.diff_sorted_unique_u32 !== 'function' ||
        typeof api.merge_and_diff_sorted_unique_u32 !== 'function' ||
        typeof api.search_contains_indices !== 'function' ||
        typeof api.chat_wasm_version !== 'function'
      ) {
        throw new Error('WASM_API_MISSING_EXPORTS');
      }

      return api;
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[chat-wasm] disabled:', err);
      return null;
    });

  return cached;
}
