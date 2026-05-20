import { z } from 'zod';

export const addContactSchema = z.object({
  contactId: z.string().min(1, '联系人 ID 不能为空'),
});

export const handleContactRequestSchema = z.object({
  requestId: z.string().min(1, '请求 ID 不能为空'),
  action: z.enum(['accept', 'reject']),
});

export const searchUsersSchema = z.object({
  query: z.string().min(1).max(100).transform((val) => val.replace(/[%_]/g, '\\$&')),
  limit: z.number().min(1).max(50).optional(),
});
