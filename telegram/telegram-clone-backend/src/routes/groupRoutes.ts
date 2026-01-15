import express from 'express';
import {
  createGroup,
  getUserGroups,
  getGroupDetails,
  addGroupMember,
  removeGroupMember,
  leaveGroup,
  updateGroup,
  deleteGroup,
  transferOwnership,
  searchGroups
} from '../controllers/groupController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

// 所有群组路由都需要认证
router.use(authenticateToken);

/**
 * @route POST /api/groups
 * @desc 创建新群组
 * @access Private
 */
router.post('/', createGroup);

/**
 * @route GET /api/groups/my
 * @desc 获取当前用户加入的所有群组列表
 * @access Private
 */
router.get('/my', getUserGroups);

/**
 * @route GET /api/groups/search
 * @desc 搜索公开群组
 * @access Private
 * @query query - 搜索关键词
 * @query limit - 结果数量限制 (默认 20, 最大 50)
 */
router.get('/search', searchGroups);

/**
 * @route GET /api/groups/:groupId
 * @desc 获取群组详情
 * @access Private
 */
router.get('/:groupId', getGroupDetails);

/**
 * @route PUT /api/groups/:groupId
 * @desc 更新群组信息（仅限群主/管理员）
 * @access Private
 */
router.put('/:groupId', updateGroup);

/**
 * @route DELETE /api/groups/:groupId
 * @desc 解散群组（仅限群主）
 * @access Private
 */
router.delete('/:groupId', deleteGroup);

/**
 * @route POST /api/groups/:groupId/members
 * @desc 添加成员到群组
 * @access Private
 */
router.post('/:groupId/members', addGroupMember);

/**
 * @route DELETE /api/groups/:groupId/members/:memberId
 * @desc 从群组移除成员
 * @access Private
 */
router.delete('/:groupId/members/:memberId', removeGroupMember);

/**
 * @route POST /api/groups/:groupId/leave
 * @desc 退出群组
 * @access Private
 */
router.post('/:groupId/leave', leaveGroup);

/**
 * @route PUT /api/groups/:groupId/transfer-ownership
 * @desc 转让群主身份
 * @access Private
 */
router.put('/:groupId/transfer-ownership', transferOwnership);

export default router;
