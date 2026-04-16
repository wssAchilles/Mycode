import type { Message } from '../../../../types/chat';
import type { ChatPersistenceShadowTelemetry, HotChatCandidate } from '../contracts';

function hashToBucket(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

export function createShadowTelemetry(sampleRate: number, enabled: boolean): ChatPersistenceShadowTelemetry {
  return {
    enabled,
    sampleRate,
    readsCompared: 0,
    mismatches: 0,
    backfillWrites: 0,
    shadowMessageWrites: 0,
    shadowSyncWrites: 0,
    lastComparedAt: 0,
    lastMismatchAt: 0,
    lastMismatchReason: null,
  };
}

export function shouldRunShadowCompare(scope: string, operation: string, sampleRate: number): boolean {
  if (sampleRate >= 100) return true;
  if (sampleRate <= 0) return false;
  return hashToBucket(`${operation}:${scope}`) < sampleRate;
}

function messageSignature(messages: Message[]): string {
  return [...messages]
    .sort((left, right) => {
      const byChat = left.chatId.localeCompare(right.chatId);
      if (byChat !== 0) return byChat;
      const bySeq = Number(left.seq ?? -1) - Number(right.seq ?? -1);
      if (bySeq !== 0) return bySeq;
      const byTimestamp = (left.timestamp || '').localeCompare(right.timestamp || '');
      if (byTimestamp !== 0) return byTimestamp;
      return left.id.localeCompare(right.id);
    })
    .map((message) => `${message.id}:${message.chatId}:${message.seq ?? -1}:${message.timestamp}:${message.content}`)
    .join('|');
}

export function compareMessages(primary: Message[], fallback: Message[]): string | null {
  if (primary.length !== fallback.length) {
    return `message_count:${primary.length}:${fallback.length}`;
  }
  const left = messageSignature(primary);
  const right = messageSignature(fallback);
  return left === right ? null : 'message_signature_mismatch';
}

function hotChatSignature(candidates: HotChatCandidate[]): string {
  return [...candidates]
    .sort((left, right) => {
      if (right.lastFetched !== left.lastFetched) return right.lastFetched - left.lastFetched;
      if (right.lastSeq !== left.lastSeq) return right.lastSeq - left.lastSeq;
      return left.chatId.localeCompare(right.chatId);
    })
    .map((candidate) => `${candidate.chatId}:${candidate.lastFetched}:${candidate.lastSeq}:${candidate.isGroup ? 1 : 0}`)
    .join('|');
}

export function compareHotChats(primary: HotChatCandidate[], fallback: HotChatCandidate[]): string | null {
  if (primary.length !== fallback.length) {
    return `hot_chat_count:${primary.length}:${fallback.length}`;
  }
  const left = hotChatSignature(primary);
  const right = hotChatSignature(fallback);
  return left === right ? null : 'hot_chat_signature_mismatch';
}

export function compareSyncPts(primary: number, fallback: number): string | null {
  return primary === fallback ? null : `sync_pts:${primary}:${fallback}`;
}
