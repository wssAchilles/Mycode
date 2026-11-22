import { z } from 'zod';

const GROUP_PUBLIC_AVATAR_PREFIX = '/api/public/space/uploads/';

/**
 * 校验群组头像 URL 安全性：仅允许受控公网上传相对路径或 http/https 链接
 */
export function isSafeGroupAvatarUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500) {
    return false;
  }
  if (/[\u0000-\u001f\u007f\\]/.test(trimmed)) {
    return false;
  }
  if (trimmed.startsWith('//') || trimmed.includes('..')) {
    return false;
  }
  if (trimmed.startsWith(GROUP_PUBLIC_AVATAR_PREFIX)) {
    return trimmed.length > GROUP_PUBLIC_AVATAR_PREFIX.length;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export const groupAvatarUrlSchema = z
  .string()
  .trim()
  .max(500, '群组头像链接长度不能超过 500 字符')
  .refine((val) => val === '' || isSafeGroupAvatarUrl(val), '群组头像链接格式无效');

export const createGroupSchema = z.object({
  name: z.string().trim().min(1, '群组名称不能为空').max(100, '群组名称不能超过 100 字符'),
  description: z.string().trim().max(500, '群组简介不能超过 500 字符').optional(),
  type: z.enum(['public', 'private']).optional(),
  maxMembers: z.coerce
    .number()
    .int('人数上限必须为整数')
    .min(2, '人数上限不能少于 2 人')
    .max(1000, '人数上限不能超过 1000 人')
    .optional(),
  avatarUrl: groupAvatarUrlSchema.nullable().optional(),
  avatar: groupAvatarUrlSchema.nullable().optional(),
});

export const addGroupMemberSchema = z.object({
  userIds: z.array(z.string()).min(1, '至少需要一个用户').max(100, '一次最多添加 100 个用户'),
});

export const updateGroupSchema = z.object({
  name: z.string().trim().min(1, '群组名称不能为空').max(100, '群组名称不能超过 100 字符').optional(),
  description: z.string().trim().max(500, '群组简介不能超过 500 字符').nullable().optional(),
  type: z.enum(['public', 'private']).optional(),
  maxMembers: z.coerce
    .number()
    .int('人数上限必须为整数')
    .min(2, '人数上限不能少于 2 人')
    .max(1000, '人数上限不能超过 1000 人')
    .optional(),
  avatarUrl: groupAvatarUrlSchema.nullable().optional(),
  avatar: groupAvatarUrlSchema.nullable().optional(),
});
