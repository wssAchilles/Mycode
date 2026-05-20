import { z } from 'zod';

export const createGroupSchema = z.object({
  name: z.string().min(1, '群组名称不能为空').max(100, '群组名称不能超过 100 字符'),
  description: z.string().max(500).optional(),
  avatar: z.string().url().optional(),
});

export const addGroupMemberSchema = z.object({
  userIds: z.array(z.string()).min(1, '至少需要一个用户').max(100, '一次最多添加 100 个用户'),
});

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  avatar: z.string().url().optional(),
});
