export type ChatType = 'private' | 'group';

const PRIVATE_PREFIX = 'p:';
const GROUP_PREFIX = 'g:';

export const buildPrivateChatId = (userId1: string, userId2: string): string => {
  const [a, b] = [userId1, userId2].sort();
  return `${PRIVATE_PREFIX}${a}:${b}`;
};

export const buildGroupChatId = (groupId: string): string => {
  return `${GROUP_PREFIX}${groupId}`;
};

export const parseChatId = (chatId: string): { type: ChatType; userIds?: string[]; groupId?: string } | null => {
  if (!chatId) return null;
  if (chatId.startsWith(PRIVATE_PREFIX)) {
    const ids = chatId.substring(PRIVATE_PREFIX.length).split(':').filter(Boolean);
    return { type: 'private', userIds: ids };
  }
  if (chatId.startsWith(GROUP_PREFIX)) {
    return { type: 'group', groupId: chatId.substring(GROUP_PREFIX.length) };
  }
  return null;
};

export const isGroupChatId = (chatId: string): boolean => chatId.startsWith(GROUP_PREFIX);
export const isPrivateChatId = (chatId: string): boolean => chatId.startsWith(PRIVATE_PREFIX);

export const getPrivateOtherUserId = (chatId: string, userId: string): string | null => {
  const parsed = parseChatId(chatId);
  if (!parsed || parsed.type !== 'private' || !parsed.userIds) return null;
  const other = parsed.userIds.find((id) => id !== userId);
  return other || null;
};

export const normalizeChatId = (chatId: string | null | undefined): string | null => {
  if (!chatId) return null;
  if (chatId.startsWith(PRIVATE_PREFIX) || chatId.startsWith(GROUP_PREFIX)) return chatId;
  return null;
};

export const getChatTypeFromIds = (groupId?: string | null): ChatType => (groupId ? 'group' : 'private');

export const buildChatId = (senderId: string, receiverId?: string | null, groupId?: string | null): string => {
  if (groupId) return buildGroupChatId(groupId);
  if (!receiverId) throw new Error('receiverId is required for private chat');
  return buildPrivateChatId(senderId, receiverId);
};
