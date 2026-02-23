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
import { getLegacyEndpointUsageSnapshot, recordLegacyEndpointCall } from '../services/legacyEndpointMetrics';
import { evaluateLegacyRouteGovernanceFromEnv } from '../services/legacyRouteGovernance';
import { buildGroupChatId, buildPrivateChatId } from '../utils/chat';

const router = Router();

type LegacyRouteMode = 'gone' | 'off' | 'auto';
function resolveLegacyRouteMode(): LegacyRouteMode {
  const raw = String(process.env.LEGACY_MESSAGE_ROUTE_MODE || '').trim().toLowerCase();
  if (raw === 'off') return 'off';
  if (raw === 'auto') return 'auto';
  if (raw === 'gone') return 'gone';
  // Industrial default: legacy routes are removed unless explicitly re-enabled for migration windows.
  return 'off';
}
const legacyRouteMode = resolveLegacyRouteMode();

function readBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = String(raw).trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return fallback;
}

const legacyAutoStickyOffEnabled = readBoolEnv('LEGACY_AUTO_STICKY_OFF', true);
let legacyAutoStickyOffLatched = false;

const setLegacyOffHeaders = (res: Response, successorPath: string) => {
  res.set('X-Legacy-Route-Mode', 'off');
  res.set('X-Legacy-Route-Effective-Mode', 'off');
  res.set('X-Legacy-Off-Ready', 'true');
  res.set('X-Legacy-Off-Candidate-Mode', 'off');
  res.set('Link', `<${successorPath}>; rel="successor-version"`);
};

const sendLegacyRouteOff = (
  res: Response,
  endpoint: '/api/messages/conversation/:receiverId' | '/api/messages/group/:groupId',
  successorPath: string,
) => {
  setLegacyOffHeaders(res, successorPath);
  return res.status(404).json({
    error: 'Not Found',
    code: 'LEGACY_ROUTE_OFF',
    endpoint,
    successor: successorPath,
  });
};

const legacyAutoCutoverGate = (_req: Request, res: Response, next: NextFunction) => {
  if (legacyRouteMode !== 'auto') return next();

  const usage = getLegacyEndpointUsageSnapshot();
  const governance = evaluateLegacyRouteGovernanceFromEnv(usage, 'auto');
  const stickyWasLatched = legacyAutoStickyOffEnabled && legacyAutoStickyOffLatched;
  if (legacyAutoStickyOffEnabled && governance.candidateRouteMode === 'off') {
    legacyAutoStickyOffLatched = true;
  }
  const stickyNowLatched = legacyAutoStickyOffEnabled && legacyAutoStickyOffLatched;
  const effectiveMode = stickyNowLatched ? 'off' : governance.candidateRouteMode;

  res.set('X-Legacy-Route-Mode', 'auto');
  res.set('X-Legacy-Route-Effective-Mode', effectiveMode);
  res.set('X-Legacy-Off-Ready', governance.readyToDisableLegacyRoutes ? 'true' : 'false');
  res.set('X-Legacy-Off-Forced', governance.forcedOffByDeadline ? 'true' : 'false');
  res.set('X-Legacy-Off-Window-Open', governance.switchWindow.open ? 'true' : 'false');
  res.set('X-Legacy-Off-Candidate-Mode', governance.candidateRouteMode);
  res.set('X-Legacy-Off-Suggested-At', new Date(governance.suggestedDisableAt).toISOString());
  if (governance.blockers.length) {
    res.set('X-Legacy-Off-Blockers', governance.blockers.join(','));
  } else {
    res.removeHeader('X-Legacy-Off-Blockers');
  }
  if (governance.forceOffAfterUtc) {
    res.set('X-Legacy-Off-Force-At', governance.forceOffAfterUtc);
  }
  res.set('X-Legacy-Off-Sticky-Enabled', legacyAutoStickyOffEnabled ? 'true' : 'false');
  res.set('X-Legacy-Off-Sticky-Latched', stickyNowLatched ? 'true' : 'false');
  if (stickyWasLatched && governance.candidateRouteMode !== 'off') {
    res.set('X-Legacy-Off-Sticky-Override', 'true');
  } else {
    res.removeHeader('X-Legacy-Off-Sticky-Override');
  }

  if (effectiveMode === 'off') {
    return res.status(404).json({
      error: 'Not Found',
      code: governance.forcedOffByDeadline ? 'LEGACY_ROUTE_FORCED_OFF' : 'LEGACY_ROUTE_AUTO_OFF',
      recommendedAction: governance.recommendedAction,
      blockers: governance.blockers,
      suggestedDisableAt: governance.suggestedDisableAt,
      switchWindow: governance.switchWindow,
      stickyOff: {
        enabled: legacyAutoStickyOffEnabled,
        latched: stickyNowLatched,
        override: stickyWasLatched && governance.candidateRouteMode !== 'off',
      },
    });
  }

  return next();
};

// 应用认证中间件到所有路由
router.use(authenticateToken);

/**
 * 已废弃：旧私聊分页接口
 * - LEGACY_MESSAGE_ROUTE_MODE=off(default): 不挂载（404）
 * - LEGACY_MESSAGE_ROUTE_MODE=gone: 挂载并返回 410 + successor headers
 * - LEGACY_MESSAGE_ROUTE_MODE=auto: 基于治理窗口自动在 410/404 之间切换
 * GET /api/messages/conversation/:receiverId
 */
if (legacyRouteMode !== 'off') {
  router.get('/conversation/:receiverId', legacyAutoCutoverGate, getConversation);
} else {
  router.get('/conversation/:receiverId', (req: Request, res: Response) => {
    const receiverId = String(req.params?.receiverId || '').trim();
    const userId = String((req as any)?.user?.id || '').trim();
    const successorPath =
      userId && receiverId
        ? `/api/messages/chat/${encodeURIComponent(buildPrivateChatId(userId, receiverId))}`
        : '/api/messages/chat/:chatId';
    recordLegacyEndpointCall('conversation', { userId: userId || null });
    return sendLegacyRouteOff(res, '/api/messages/conversation/:receiverId', successorPath);
  });
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
 * - LEGACY_MESSAGE_ROUTE_MODE=off(default): 不挂载（404）
 * - LEGACY_MESSAGE_ROUTE_MODE=gone: 挂载并返回 410 + successor headers
 * - LEGACY_MESSAGE_ROUTE_MODE=auto: 基于治理窗口自动在 410/404 之间切换
 * GET /api/messages/group/:groupId
 */
if (legacyRouteMode !== 'off') {
  router.get('/group/:groupId', legacyAutoCutoverGate, getGroupMessages);
} else {
  router.get('/group/:groupId', (req: Request, res: Response) => {
    const groupId = String(req.params?.groupId || '').trim();
    const userId = String((req as any)?.user?.id || '').trim();
    const successorPath = groupId
      ? `/api/messages/chat/${encodeURIComponent(buildGroupChatId(groupId))}`
      : '/api/messages/chat/:chatId';
    recordLegacyEndpointCall('group', { userId: userId || null });
    return sendLegacyRouteOff(res, '/api/messages/group/:groupId', successorPath);
  });
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
