import { z } from 'zod';

export const registerSchema = z.object({
  username: z.string()
    .min(3, '用户名长度必须在 3-50 个字符之间')
    .max(50, '用户名长度必须在 3-50 个字符之间')
    .regex(/^[a-zA-Z0-9_]+$/, '用户名只能包含字母、数字和下划线'),
  password: z.string()
    .min(6, '密码长度必须在 6-255 个字符之间')
    .max(255, '密码长度必须在 6-255 个字符之间'),
  email: z.string().email('邮箱格式不正确').optional(),
  birthDate: z.string().optional(),
  region: z.string().optional(),
  language: z.string().optional(),
});

export const loginSchema = z.object({
  usernameOrEmail: z.string().min(1, '用户名/邮箱不能为空'),
  password: z.string().min(1, '密码不能为空'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, '缺少刷新令牌'),
});
