import express from 'express';
import {
  createGroup,
  getUserGroups,
  getGroupDetails,
  addGroupMember,
  removeGroupMember,
  muteGroupMember,
  unmuteGroupMember,
  promoteGroupMember,
  demoteGroupMember,
  leaveGroup,
  updateGroup,
  deleteGroup,
  transferOwnership,
  searchGroups
} from '../controllers/groupController';
import { authenticateToken } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { createGroupSchema, addGroupMemberSchema, updateGroupSchema } from '../schemas/groupSchemas';
import { errors } from '../utils/apiResponse';

const router = express.Router();

const UUID_PARAM_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 所有群组路由都需要认证
router.use(authenticateToken);

// 统一剥离可选 g: 前缀并严格校验 PostgreSQL UUID 参数，杜绝非法 ID 直穿数据库抛 500
router.param('groupId', (req, res, next, rawGroupId) => {
  const normalized = String(rawGroupId || '')
    .trim()
    .replace(/^(?:room:|g:)/i, '');
  if (!UUID_PARAM_RE.test(normalized)) {
    return errors.badRequest(res, '无效的群组 ID 格式');
  }
  req.params.groupId = normalized;
  next();
});

router.param('memberId', (req, res, next, rawMemberId) => {
  const normalized = String(rawMemberId || '').trim();
  if (!UUID_PARAM_RE.test(normalized)) {
    return errors.badRequest(res, '无效的成员 ID 格式');
  }
  req.params.memberId = normalized;
  next();
});

/**
 * @route POST /api/groups
 * @desc 创建新群组
 * @access Private
 */
router.post('/', validate(createGroupSchema), createGroup);

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
router.put('/:groupId', validate(updateGroupSchema), updateGroup);

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
router.post('/:groupId/members', validate(addGroupMemberSchema), addGroupMember);

/**
 * @route DELETE /api/groups/:groupId/members/:memberId
 * @desc 从群组移除成员
 * @access Private
 */
router.delete('/:groupId/members/:memberId', removeGroupMember);

/**
 * @route POST /api/groups/:groupId/members/:memberId/mute
 * @desc 禁言群成员
 * @access Private
 */
router.post('/:groupId/members/:memberId/mute', muteGroupMember);

/**
 * @route POST /api/groups/:groupId/members/:memberId/unmute
 * @desc 解除禁言
 * @access Private
 */
router.post('/:groupId/members/:memberId/unmute', unmuteGroupMember);

/**
 * @route POST /api/groups/:groupId/members/:memberId/promote
 * @desc 提升成员为管理员
 * @access Private
 */
router.post('/:groupId/members/:memberId/promote', promoteGroupMember);

/**
 * @route POST /api/groups/:groupId/members/:memberId/demote
 * @desc 降级管理员为普通成员
 * @access Private
 */
router.post('/:groupId/members/:memberId/demote', demoteGroupMember);

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
