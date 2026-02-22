import { Router } from 'express';
import {
  getConversation,
  getChatMessages,
  getGroupMessages,
  sendMessage,
  markMessagesAsRead,
  markChatAsRead,
  deleteMessage,
  editMessage,
  getUnreadCount,
  searchMessages,
  getMessageContext,
  getLegacyMessageEndpointUsage,
} from '../controllers/messageController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

type LegacyRouteMode = 'gone' | 'off';
function resolveLegacyRouteMode(): LegacyRouteMode {
  const raw = String(process.env.LEGACY_MESSAGE_ROUTE_MODE || '').trim().toLowerCase();
  if (raw === 'off') return 'off';
  if (raw === 'gone') return 'gone';
  // Default to `gone` so legacy callers get explicit 410 + successor hints.
  return 'gone';
}
const legacyRouteMode = resolveLegacyRouteMode();

// 应用认证中间件到所有路由
router.use(authenticateToken);

/**
 * 已废弃：旧私聊分页接口
 * - LEGACY_MESSAGE_ROUTE_MODE=gone(default): 挂载并返回 410 + successor headers
 * - LEGACY_MESSAGE_ROUTE_MODE=off: 不挂载（404）
 * GET /api/messages/conversation/:receiverId
 */
if (legacyRouteMode !== 'off') {
  router.get('/conversation/:receiverId', getConversation);
}

/**
 * 旧消息接口调用遥测（迁移观察）
 * GET /api/messages/legacy-usage
 */
router.get('/legacy-usage', getLegacyMessageEndpointUsage);

/**
 * 获取聊天消息（统一 cursor API）
 * GET /api/messages/chat/:chatId
 * 查询参数: beforeSeq, afterSeq, limit
 */
router.get('/chat/:chatId', getChatMessages);

/**
 * 已废弃：旧群聊分页接口
 * - LEGACY_MESSAGE_ROUTE_MODE=gone(default): 挂载并返回 410 + successor headers
 * - LEGACY_MESSAGE_ROUTE_MODE=off: 不挂载（404）
 * GET /api/messages/group/:groupId
 */
if (legacyRouteMode !== 'off') {
  router.get('/group/:groupId', getGroupMessages);
}

/**
 * 发送消息 (HTTP API)
 * POST /api/messages/send
 * Body: { chatType, receiverId?, groupId?, content, type? }
 */
router.post('/send', sendMessage);

/**
 * 标记消息为已读
 * PUT /api/messages/read
 * Body: { messageIds: string[] }
 */
router.put('/read', markMessagesAsRead);

/**
 * 标记聊天为已读（按 seq）
 * POST /api/messages/chat/:chatId/read
 * Body: { seq: number }
 */
router.post('/chat/:chatId/read', markChatAsRead);

/**
 * 删除消息（软删除）
 * DELETE /api/messages/:messageId
 */
router.delete('/:messageId', deleteMessage);

/**
 * 编辑消息
 * PUT /api/messages/:messageId
 * Body: { content }
 */
router.put('/:messageId', editMessage);

/**
 * 获取未读消息数量
 * GET /api/messages/unread-count
 */
router.get('/unread-count', getUnreadCount);

/**
 * 搜索消息
 * GET /api/messages/search?q=keyword&targetId=optional
 */
router.get('/search', searchMessages);

/**
 * 获取消息上下文
 * GET /api/messages/context?chatId=...&seq=...&limit=...
 */
router.get('/context', getMessageContext);

export default router;
