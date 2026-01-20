import { Router } from 'express';
import {
  getConversation,
  getGroupMessages,
  sendMessage,
  markMessagesAsRead,
  deleteMessage,
  editMessage,
  getUnreadCount,
  searchMessages
} from '../controllers/messageController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// 应用认证中间件到所有路由
router.use(authenticateToken);

/**
 * 获取与特定用户的聊天记录
 * GET /api/messages/conversation/:receiverId
 * 查询参数: page, limit
 */
router.get('/conversation/:receiverId', getConversation);

/**
 * 获取群聊消息
 * GET /api/messages/group/:groupId
 * 查询参数: page, limit
 */
router.get('/group/:groupId', getGroupMessages);

/**
 * 发送消息 (HTTP API)
 * POST /api/messages/send
 * Body: { receiverId, content, type?, isGroupChat? }
 */
router.post('/send', sendMessage);

/**
 * 标记消息为已读
 * PUT /api/messages/read
 * Body: { messageIds: string[] }
 */
router.put('/read', markMessagesAsRead);

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

export default router;
