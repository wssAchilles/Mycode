/**
 * Message assembler — converts raw sync/socket payloads into canonical Message types.
 *
 * Single responsibility: field mapping, default values, validation.
 * No side effects, no persistence, no socket/sync state.
 */

import type { Message } from '../../../types/chat';

// ---------------------------------------------------------------------------
// Raw payload types
// ---------------------------------------------------------------------------

export interface RawSyncMessage {
  _id?: string;
  id?: string;
  chatId?: string;
  sender?: string;
  senderId?: string;
  senderUsername?: string;
  username?: string;
  receiverId?: string;
  receiver?: string;
  userId?: string;
  content?: string;
  timestamp?: string;
  seq?: number;
  type?: number | string;
  chatType?: string;
  isGroupChat?: boolean;
  clientTempId?: string;
  groupId?: string;
  status?: string;
  readCount?: number;
  attachments?: unknown[];
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  [key: string]: unknown;
}

export interface RawGroupEvent {
  action?: string;
  groupId?: string;
  userId?: string;
  targetId?: string;
  name?: string;
  groupName?: string;
  avatarUrl?: string;
  memberIds?: string[];
  members?: Array<{ user?: { id?: string; userId?: string }; userId?: string }>;
  [key: string]: unknown;
}

export interface RawSyncUpdate {
  updateId?: number;
  type?: string;
  chatId?: string;
  seq?: number;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateMessage(message: Message): ValidationResult {
  if (!message.id) return { valid: false, reason: 'missing id' };
  if (!message.chatId) return { valid: false, reason: 'missing chatId' };
  if (!message.senderId) return { valid: false, reason: 'missing senderId' };
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Normalization: RawSyncMessage → Message
// ---------------------------------------------------------------------------

export function normalizeSyncMessage(raw: RawSyncMessage): Message | null {
  if (!raw) return null;

  const id = String(raw.id || raw._id || '');
  const chatId = raw.chatId ? String(raw.chatId) : '';
  if (!id || !chatId) return null;

  const chatType: Message['chatType'] =
    raw.chatType === 'group' || raw.isGroupChat || chatId.startsWith('g:') ? 'group' : 'private';

  const senderId = String(raw.senderId || raw.sender || raw.userId || 'unknown');
  const senderUsername = String(raw.senderUsername || raw.username || '未知用户');
  const receiverId = raw.receiverId || raw.receiver;

  const seq =
    typeof raw.seq === 'number'
      ? raw.seq
      : Number.isFinite(Number(raw.seq))
        ? Number(raw.seq)
        : undefined;

  const timestamp =
    typeof raw.timestamp === 'string'
      ? raw.timestamp
      : raw.timestamp?.toString?.() || new Date().toISOString();

  return {
    id,
    clientTempId:
      typeof raw.clientTempId === 'string' && raw.clientTempId.trim()
        ? raw.clientTempId.trim()
        : undefined,
    chatId,
    chatType,
    seq,
    content: String(raw.content ?? ''),
    senderId,
    senderUsername,
    userId: senderId,
    username: senderUsername,
    receiverId: receiverId ? String(receiverId) : undefined,
    groupId: raw.groupId ? String(raw.groupId) : undefined,
    timestamp,
    type: (raw.type || 'text') as Message['type'],
    isGroupChat: chatType === 'group',
    status: (raw.status || 'delivered') as Message['status'],
    readCount: typeof raw.readCount === 'number' ? raw.readCount : undefined,
    attachments: Array.isArray(raw.attachments) ? raw.attachments : undefined,
    fileUrl: raw.fileUrl || undefined,
    fileName: raw.fileName || undefined,
    fileSize: typeof raw.fileSize === 'number' ? raw.fileSize : undefined,
    mimeType: raw.mimeType || undefined,
    thumbnailUrl: raw.thumbnailUrl || undefined,
  };
}

export function normalizeSyncMessages(raw: RawSyncMessage[]): Message[] {
  if (!Array.isArray(raw) || !raw.length) return [];
  const out: Message[] = [];
  for (const r of raw) {
    const m = normalizeSyncMessage(r);
    if (m) out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Normalization: RawSyncUpdate → deduplicated, sorted updates
// ---------------------------------------------------------------------------

export interface SyncUpdateNormalizationResult {
  updates: RawSyncUpdate[];
  maxUpdateId: number;
  stats: {
    droppedInvalid: number;
    droppedStale: number;
    droppedDuplicate: number;
    gapEvents: number;
    gapMax: number;
  };
}

export function normalizeSyncUpdates(
  raw: RawSyncUpdate[],
  minUpdateIdExclusive: number,
): SyncUpdateNormalizationResult {
  const stats = {
    droppedInvalid: 0,
    droppedStale: 0,
    droppedDuplicate: 0,
    gapEvents: 0,
    gapMax: 0,
  };

  if (!Array.isArray(raw) || raw.length === 0) {
    return { updates: [], maxUpdateId: minUpdateIdExclusive, stats };
  }

  const byUpdateId = new Map<number, RawSyncUpdate>();
  let maxUpdateId = minUpdateIdExclusive;

  for (const item of raw) {
    const updateId = Number(item?.updateId);
    if (!Number.isFinite(updateId)) {
      stats.droppedInvalid += 1;
      continue;
    }
    if (updateId <= minUpdateIdExclusive) {
      stats.droppedStale += 1;
      continue;
    }
    if (byUpdateId.has(updateId)) {
      stats.droppedDuplicate += 1;
    }
    byUpdateId.set(updateId, item);
    if (updateId > maxUpdateId) maxUpdateId = updateId;
  }

  if (!byUpdateId.size) {
    return { updates: [], maxUpdateId, stats };
  }

  const sortedEntries = Array.from(byUpdateId.entries()).sort((a, b) => a[0] - b[0]);
  let prevUpdateId = minUpdateIdExclusive;
  for (const [updateId] of sortedEntries) {
    const gap = updateId - prevUpdateId - 1;
    if (gap > 0) {
      stats.gapEvents += 1;
      if (gap > stats.gapMax) stats.gapMax = gap;
    }
    prevUpdateId = updateId;
  }

  const updates = sortedEntries.map((entry) => entry[1]);
  return { updates, maxUpdateId, stats };
}
