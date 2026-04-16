import { z } from 'zod';

export const agentContextScopeSchema = z.enum(['feed', 'notifications', 'news']);
export type AgentContextScope = z.infer<typeof agentContextScopeSchema>;

export const agentFeedItemSchema = z.object({
  postId: z.string(),
  title: z.string().nullable().optional(),
  snippet: z.string(),
  authorUsername: z.string().nullable().optional(),
  isNews: z.boolean().optional(),
  recallSource: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type AgentFeedItem = z.infer<typeof agentFeedItemSchema>;

export const agentNotificationItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  actorUsername: z.string().nullable().optional(),
  postSnippet: z.string().nullable().optional(),
  actionText: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type AgentNotificationItem = z.infer<typeof agentNotificationItemSchema>;

export const agentNewsItemSchema = z.object({
  postId: z.string().nullable().optional(),
  title: z.string(),
  summary: z.string(),
  source: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});
export type AgentNewsItem = z.infer<typeof agentNewsItemSchema>;

export const agentContextSnapshotSchema = z.object({
  user: z.object({
    id: z.string(),
    username: z.string(),
  }),
  requestedScopes: z.array(agentContextScopeSchema),
  feed: z
    .object({
      items: z.array(agentFeedItemSchema),
      summary: z.string(),
    })
    .nullable()
    .optional(),
  notifications: z
    .object({
      items: z.array(agentNotificationItemSchema),
      summary: z.string(),
    })
    .nullable()
    .optional(),
  news: z
    .object({
      items: z.array(agentNewsItemSchema),
      summary: z.string(),
    })
    .nullable()
    .optional(),
  generatedAt: z.string(),
});
export type AgentContextSnapshot = z.infer<typeof agentContextSnapshotSchema>;

export interface AgentConversationHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentImagePayload {
  mimeType: string;
  base64Data: string;
}

export interface AgentRespondRequestPayload {
  userId: string;
  message: string;
  conversationId?: string;
  conversationHistory?: AgentConversationHistoryItem[];
  imageData?: AgentImagePayload;
  contextSnapshot: AgentContextSnapshot;
}

export const agentRespondResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    message: z.string(),
    suggestions: z.array(z.string()).default([]),
    usedScopes: z.array(agentContextScopeSchema).default([]),
    model: z.string().default('unknown'),
    mode: z.string().default('agent_primary'),
    fallback: z.boolean().default(false),
  }),
});
export type AgentRespondResponsePayload = z.infer<typeof agentRespondResponseSchema>;
