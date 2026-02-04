export const buildPrivateChatId = (userId1: string, userId2: string): string => {
  const [a, b] = [userId1, userId2].sort();
  return `p:${a}:${b}`;
};

export const buildGroupChatId = (groupId: string): string => `g:${groupId}`;
