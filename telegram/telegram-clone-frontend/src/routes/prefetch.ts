let chatRoutePrefetched = false;
let spaceRoutePrefetched = false;

/**
 * 在用户悬停或聚焦导航入口时预加载 ChatPage chunk，消除切页首跳白屏
 */
export function prefetchChatRoute(): void {
  if (chatRoutePrefetched) return;
  chatRoutePrefetched = true;
  void import('../pages/ChatPage').catch(() => {
    chatRoutePrefetched = false;
  });
}

/**
 * 在用户悬停或聚焦返回按钮时预加载 SpacePage chunk
 */
export function prefetchSpaceRoute(): void {
  if (spaceRoutePrefetched) return;
  spaceRoutePrefetched = true;
  void import('../pages/SpacePage').catch(() => {
    spaceRoutePrefetched = false;
  });
}
