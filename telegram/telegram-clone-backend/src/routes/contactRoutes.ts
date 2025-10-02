import express from 'express';
import {
  addContact,
  getContacts,
  getPendingRequests,
  handleContactRequest,
  removeContact,
  blockContact,
  searchUsers,
  updateContactAlias
} from '../controllers/contactController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

// 所有联系人路由都需要认证
router.use(authenticateToken);

/**
 * @route POST /api/contacts/add
 * @desc 添加联系人请求
 * @access Private
 */
router.post('/add', addContact);

/**
 * @route GET /api/contacts
 * @desc 获取联系人列表
 * @access Private
 * @query status - 联系人状态 (accepted, pending, blocked, rejected)
 */
router.get('/', getContacts);

/**
 * @route GET /api/contacts/pending-requests
 * @desc 获取待处理的联系人请求
 * @access Private
 */
router.get('/pending-requests', getPendingRequests);

/**
 * @route PUT /api/contacts/requests/:requestId
 * @desc 处理联系人请求（接受/拒绝）
 * @access Private
 */
router.put('/requests/:requestId', handleContactRequest);

/**
 * @route DELETE /api/contacts/:contactId
 * @desc 删除联系人
 * @access Private
 */
router.delete('/:contactId', removeContact);

/**
 * @route POST /api/contacts/:contactId/block
 * @desc 屏蔽联系人
 * @access Private
 */
router.post('/:contactId/block', blockContact);

/**
 * @route PUT /api/contacts/:contactId/alias
 * @desc 更新联系人备注
 * @access Private
 */
router.put('/:contactId/alias', updateContactAlias);

/**
 * @route GET /api/contacts/search
 * @desc 搜索用户（用于添加联系人）
 * @access Private
 * @query query - 搜索关键词
 * @query limit - 结果数量限制 (默认 20, 最大 50)
 */
router.get('/search', searchUsers);

export default router;
