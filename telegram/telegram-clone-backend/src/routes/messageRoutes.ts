import { Router, type NextFunction, type Request, type Response } from 'express';
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
import { getLegacyEndpointUsageSnapshot } from '../services/legacyEndpointMetrics';
import { evaluateLegacyRouteGovernanceFromEnv } from '../services/legacyRouteGovernance';

const router = Router();

type LegacyRouteMode = 'gone' | 'off' | 'auto';
function resolveLegacyRouteMode(): LegacyRouteMode {
  const raw = String(process.env.LEGACY_MESSAGE_ROUTE_MODE || '').trim().toLowerCase();
  if (raw === 'off') return 'off';
  if (raw === 'auto') return 'auto';
  if (raw === 'gone') return 'gone';
  // Default to `gone` so legacy callers get explicit 410 + successor hints.
  return 'gone';
}
const legacyRouteMode = resolveLegacyRouteMode();

const legacyAutoCutoverGate = (_req: Request, res: Response, next: NextFunction) => {
  if (legacyRouteMode !== 'auto') return next();

  const usage = getLegacyEndpointUsageSnapshot();
  const governance = evaluateLegacyRouteGovernanceFromEnv(usage, 'auto');
  const effectiveMode = governance.candidateRouteMode;

  res.set('X-Legacy-Route-Mode', 'auto');
  res.set('X-Legacy-Route-Effective-Mode', effectiveMode);
  res.set('X-Legacy-Off-Ready', governance.readyToDisableLegacyRoutes ? 'true' : 'false');
  res.set('X-Legacy-Off-Forced', governance.forcedOffByDeadline ? 'true' : 'false');
  if (governance.forceOffAfterUtc) {
    res.set('X-Legacy-Off-Force-At', governance.forceOffAfterUtc);
  }

  if (effectiveMode === 'off') {
    return res.status(404).json({
      error: 'Not Found',
      code: governance.forcedOffByDeadline ? 'LEGACY_ROUTE_FORCED_OFF' : 'LEGACY_ROUTE_AUTO_OFF',
      recommendedAction: governance.recommendedAction,
      blockers: governance.blockers,
    });
  }

  return next();
};

// 应用认证中间件到所有路由
router.use(authenticateToken);

/**
 * 已废弃：旧私聊分页接口
 * - LEGACY_MESSAGE_ROUTE_MODE=gone(default): 挂载并返回 410 + successor headers
 * - LEGACY_MESSAGE_ROUTE_MODE=auto: 基于治理窗口自动在 410/404 之间切换
 * - LEGACY_MESSAGE_ROUTE_MODE=off: 不挂载（404）
 * GET /api/messages/conversation/:receiverId
 */
if (legacyRouteMode !== 'off') {
  router.get('/conversation/:receiverId', legacyAutoCutoverGate, getConversation);
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
 * - LEGACY_MESSAGE_ROUTE_MODE=auto: 基于治理窗口自动在 410/404 之间切换
 * - LEGACY_MESSAGE_ROUTE_MODE=off: 不挂载（404）
 * GET /api/messages/group/:groupId
 */
if (legacyRouteMode !== 'off') {
  router.get('/group/:groupId', legacyAutoCutoverGate, getGroupMessages);
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
