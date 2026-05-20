import { z } from 'zod';

export const sendMessageSchema = z.object({
  content: z.string().max(10000, '消息内容不能超过 10000 字符').optional(),
  receiverId: z.string().optional(),
  groupId: z.string().optional(),
  chatType: z.enum(['private', 'group']),
  type: z.number().optional(),
  fileUrl: z.string().url().optional(),
  fileName: z.string().max(255).optional(),
  fileSize: z.number().max(100 * 1024 * 1024).optional(), // 100MB max
  mimeType: z.string().max(100).optional(),
  thumbnailUrl: z.string().url().optional(),
  clientTempId: z.string().uuid().optional(),
}).refine(
  (data) => data.content || data.fileUrl,
  { message: '消息内容或文件 URL 至少需要一个' }
);

export const editMessageSchema = z.object({
  content: z.string().min(1, '消息内容不能为空').max(10000, '消息内容不能超过 10000 字符'),
});

export const searchMessagesSchema = z.object({
  query: z.string().min(1).max(200),
  targetId: z.string().optional(),
  chatType: z.enum(['private', 'group']).optional(),
  limit: z.number().min(1).max(100).optional(),
});
