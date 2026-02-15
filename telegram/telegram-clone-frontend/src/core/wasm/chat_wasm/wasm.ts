export type ChatWasmApi = {
  merge_sorted_unique_u32: (existing: Uint32Array, incoming: Uint32Array) => Uint32Array;
  diff_sorted_unique_u32: (existing: Uint32Array, incoming: Uint32Array) => Uint32Array;
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
      };

      if (typeof api.merge_sorted_unique_u32 !== 'function' || typeof api.diff_sorted_unique_u32 !== 'function') {
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
