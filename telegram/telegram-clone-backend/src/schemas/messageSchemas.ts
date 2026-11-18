import { z } from 'zod';
import { MessageType } from '../models/Message';

const messageTypeSchema = z.enum([
  MessageType.TEXT,
  MessageType.IMAGE,
  MessageType.FILE,
  MessageType.VIDEO,
  MessageType.AUDIO,
  MessageType.DOCUMENT,
  MessageType.SYSTEM,
]);

// 校验合法 http(s) URL 或安全的 /api/uploads/ 相对路径（拦截路径穿越与非法分隔符）
function isValidMediaUrlOrUploadPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  if (/[\r\n\0\\]/.test(trimmed)) return false;

  if (trimmed.startsWith('/api/uploads/')) {
    const subPath = trimmed.slice('/api/uploads/'.length);
    if (!subPath || subPath.startsWith('/') || subPath.includes('//')) {
      return false;
    }
    const decodedSegments = subPath.split('/').map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return '..';
      }
    });
    return decodedSegments.every(
      (seg) => seg.length > 0 && seg !== '.' && seg !== '..' && !seg.includes('/') && !seg.includes('\\'),
    );
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const mediaUrlSchema = z
  .string()
  .trim()
  .refine(isValidMediaUrlOrUploadPath, {
    message: '文件地址必须为合法的 http(s) URL 或 /api/uploads/ 相对路径',
  });

const messageAttachmentSchema = z.object({
  fileUrl: mediaUrlSchema,
  fileName: z.string().max(255).optional(),
  fileSize: z.number().nonnegative().max(100 * 1024 * 1024).optional(),
  mimeType: z.string().max(100).optional(),
  thumbnailUrl: mediaUrlSchema.optional(),
});

export const sendMessageSchema = z.object({
  content: z.string().max(10000, '消息内容不能超过 10000 字符').optional(),
  receiverId: z.string().optional(),
  groupId: z.string().optional(),
  chatType: z.enum(['private', 'group']),
  type: messageTypeSchema.optional(),
  fileUrl: mediaUrlSchema.optional(),
  fileName: z.string().max(255).optional(),
  fileSize: z.number().nonnegative().max(100 * 1024 * 1024).optional(), // 100MB 上限
  mimeType: z.string().max(100).optional(),
  thumbnailUrl: mediaUrlSchema.optional(),
  attachments: z.array(messageAttachmentSchema).max(10).optional(),
  replyTo: z.string().max(64).optional(),
  clientTempId: z.string().uuid().optional(),
}).refine(
  (data) =>
    Boolean(
      (typeof data.content === 'string' && data.content.length > 0)
      || data.fileUrl
      || (Array.isArray(data.attachments) && data.attachments.length > 0),
    ),
  { message: '消息内容、文件 URL 或附件列表至少需要一个' }
);

export const editMessageSchema = z.object({
  content: z.string().min(1, '消息内容不能为空').max(10000, '消息内容不能超过 10000 字符'),
});

export const searchMessagesSchema = z.object({
  // FE worker sends `q`; controller reads `req.query.q`
  q: z.string().min(1).max(200),
  targetId: z.string().optional(),
  chatType: z.enum(['private', 'group']).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});
