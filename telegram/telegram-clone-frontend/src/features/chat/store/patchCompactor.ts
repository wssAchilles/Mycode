import type { ChatPatch } from '../../../core/chat/types';
import type { Message } from '../../../types/chat';

export type MessagePatch = Exclude<ChatPatch, { kind: 'meta' } | { kind: 'sync' }>;
export interface MessagePatchCompactionRuntimeResult {
  patches: MessagePatch[];
  usedWasm: boolean;
  shadowCompared: boolean;
  shadowMismatch: boolean;
  shadowFallback: boolean;
}

export function compactMessagePatches(patches: MessagePatch[]): MessagePatch[] {
  if (!patches.length) return [];

  // If a reset exists, older patches for the same projection are obsolete.
  let startAt = 0;
  for (let i = patches.length - 1; i >= 0; i -= 1) {
    if (patches[i].kind === 'reset') {
      startAt = i;
      break;
    }
  }

  const input = startAt > 0 ? patches.slice(startAt) : patches;
  const out: MessagePatch[] = [];

  for (const next of input) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(next);
      continue;
    }

    const merged = mergeAdjacentPatches(prev, next);
    if (merged) {
      out[out.length - 1] = merged;
    } else {
      out.push(next);
    }
  }

  return out;
}

function patchSignature(patches: MessagePatch[]): string {
  return JSON.stringify(
    patches.map((patch) => {
      if (patch.kind === 'append' || patch.kind === 'prepend' || patch.kind === 'reset') {
        return {
          kind: patch.kind,
          chatId: patch.chatId,
          loadSeq: patch.loadSeq,
          hasMore: patch.kind === 'reset' || patch.kind === 'prepend' ? patch.hasMore : undefined,
          nextBeforeSeq: patch.kind === 'reset' || patch.kind === 'prepend' ? patch.nextBeforeSeq : undefined,
          messageIds: patch.messages.map((message) => message.id),
        };
      }
      if (patch.kind === 'delete') {
        return {
          kind: patch.kind,
          chatId: patch.chatId,
          loadSeq: patch.loadSeq,
          ids: patch.ids,
        };
      }
      return {
        kind: patch.kind,
        chatId: patch.chatId,
        loadSeq: patch.loadSeq,
        updates: patch.updates.map((update) => ({
          id: update.id,
          status: update.status,
          readCount: update.readCount,
        })),
      };
    }),
  );
}

export function compactMessagePatchesWithRuntime(
  patches: MessagePatch[],
  options: {
    wasmPatchCompactor?: (patches: MessagePatch[]) => MessagePatch[];
    shadowCompare?: boolean;
  } = {},
): MessagePatchCompactionRuntimeResult {
  const jsBaseline = compactMessagePatches(patches);
  if (!options.wasmPatchCompactor) {
    return {
      patches: jsBaseline,
      usedWasm: false,
      shadowCompared: false,
      shadowMismatch: false,
      shadowFallback: false,
    };
  }

  try {
    const wasmResult = options.wasmPatchCompactor(patches);
    if (!options.shadowCompare) {
      return {
        patches: wasmResult,
        usedWasm: true,
        shadowCompared: false,
        shadowMismatch: false,
        shadowFallback: false,
      };
    }

    const matches = patchSignature(jsBaseline) === patchSignature(wasmResult);
    if (matches) {
      return {
        patches: wasmResult,
        usedWasm: true,
        shadowCompared: true,
        shadowMismatch: false,
        shadowFallback: false,
      };
    }

    return {
      patches: jsBaseline,
      usedWasm: false,
      shadowCompared: true,
      shadowMismatch: true,
      shadowFallback: true,
    };
  } catch {
    return {
      patches: jsBaseline,
      usedWasm: false,
      shadowCompared: !!options.shadowCompare,
      shadowMismatch: false,
      shadowFallback: true,
    };
  }
}

function mergeAdjacentPatches(prev: MessagePatch, next: MessagePatch): MessagePatch | null {
  if (prev.chatId !== next.chatId || prev.loadSeq !== next.loadSeq) return null;

  if (prev.kind === 'append' && next.kind === 'append') {
    return {
      kind: 'append',
      chatId: prev.chatId,
      loadSeq: prev.loadSeq,
      messages: prev.messages.concat(next.messages),
    };
  }

  if (prev.kind === 'prepend' && next.kind === 'prepend') {
    // Applying two prepends in order [prev, next] is equivalent to a single prepend
    // with `next` messages first.
    return {
      kind: 'prepend',
      chatId: prev.chatId,
      loadSeq: prev.loadSeq,
      messages: next.messages.concat(prev.messages),
      hasMore: next.hasMore,
      nextBeforeSeq: next.nextBeforeSeq,
    };
  }

  if (prev.kind === 'delete' && next.kind === 'delete') {
    const ids = Array.from(new Set([...prev.ids, ...next.ids]));
    return {
      kind: 'delete',
      chatId: prev.chatId,
      loadSeq: prev.loadSeq,
      ids,
    };
  }

  if (prev.kind === 'update' && next.kind === 'update') {
    const byId = new Map<string, { id: string; status?: Message['status']; readCount?: number }>();
    for (const u of prev.updates) byId.set(u.id, u);
    for (const u of next.updates) {
      const cur = byId.get(u.id);
      byId.set(u.id, cur ? { ...cur, ...u } : u);
    }
    return {
      kind: 'update',
      chatId: prev.chatId,
      loadSeq: prev.loadSeq,
      updates: Array.from(byId.values()),
    };
  }

  if (prev.kind === 'reset' && next.kind === 'append') {
    return {
      kind: 'reset',
      chatId: prev.chatId,
      loadSeq: prev.loadSeq,
      messages: prev.messages.concat(next.messages),
      hasMore: prev.hasMore,
      nextBeforeSeq: prev.nextBeforeSeq,
    };
  }

  return null;
}
