import { z } from 'zod';

export const trendSourceTypeSchema = z.enum(['news_article', 'space_post']);
export const newsTrendModeSchema = z.enum(['news_topics', 'space_trends']);
export const newsTrendKindSchema = z.enum(['news_event', 'keyword', 'social_topic']);

export const trendMetricsPayloadSchema = z.object({
  impressions: z.number().optional(),
  clicks: z.number().optional(),
  shares: z.number().optional(),
  dwellCount: z.number().optional(),
  likes: z.number().optional(),
  comments: z.number().optional(),
  reposts: z.number().optional(),
});

export const trendDocumentPayloadSchema = z.object({
  id: z.string(),
  sourceType: trendSourceTypeSchema,
  title: z.string().optional(),
  summary: z.string().optional(),
  body: z.string().optional(),
  source: z.string().optional(),
  sourceUrl: z.string().optional(),
  canonicalUrl: z.string().optional(),
  coverImageUrl: z.string().optional(),
  publishedAt: z.string().optional(),
  fetchedAt: z.string().optional(),
  createdAt: z.string().optional(),
  clusterId: z.number().int().nullable().optional(),
  keywords: z.array(z.string()).default([]),
  metrics: trendMetricsPayloadSchema.default({}),
  embedding: z.array(z.number()).nullable().optional(),
});

export const newsTrendRequestPayloadSchema = z.object({
  requestId: z.string(),
  mode: newsTrendModeSchema,
  limit: z.number().int().positive(),
  windowHours: z.number().int().positive(),
  nowMs: z.number().int().positive(),
  documents: z.array(trendDocumentPayloadSchema),
});

export const newsTrendItemPayloadSchema = z.object({
  trendId: z.string(),
  numericClusterId: z.number().int(),
  tag: z.string(),
  displayName: z.string(),
  kind: newsTrendKindSchema,
  count: z.number().int().nonnegative(),
  heat: z.number().int().min(0).max(100),
  score: z.number(),
  latestAt: z.string().optional(),
  summary: z.string().optional(),
  coverImageUrl: z.string().nullable().optional(),
  representativeDocumentId: z.string().optional(),
  documentIds: z.array(z.string()),
  canonicalKeywords: z.array(z.string()),
  scoreBreakdown: z.record(z.string(), z.number()),
});

export const newsTrendResponsePayloadSchema = z.object({
  requestId: z.string(),
  mode: newsTrendModeSchema,
  generatedAt: z.string(),
  cacheHit: z.boolean(),
  cacheKey: z.string().optional(),
  traceVersion: z.string().optional(),
  inputDocumentCount: z.number().int().nonnegative().optional(),
  selectedTrendCount: z.number().int().nonnegative().optional(),
  trends: z.array(newsTrendItemPayloadSchema),
});

export type TrendSourceType = z.infer<typeof trendSourceTypeSchema>;
export type NewsTrendMode = z.infer<typeof newsTrendModeSchema>;
export type NewsTrendKind = z.infer<typeof newsTrendKindSchema>;
export type TrendDocumentPayload = z.infer<typeof trendDocumentPayloadSchema>;
export type NewsTrendRequestPayload = z.infer<typeof newsTrendRequestPayloadSchema>;
export type NewsTrendItemPayload = z.infer<typeof newsTrendItemPayloadSchema>;
export type NewsTrendResponsePayload = z.infer<typeof newsTrendResponsePayloadSchema>;

export interface NewsTrendTopicResult {
  clusterId: number;
  count: number;
  title: string;
  summary: string;
  coverImageUrl?: string | null;
  latestAt?: string;
  tag?: string;
  displayName?: string;
  kind?: NewsTrendKind;
  heat?: number;
  score?: number;
  canonicalKeywords?: string[];
}

export interface SpaceTrendResult {
  tag: string;
  count: number;
  heat: number;
  displayName?: string;
  kind?: NewsTrendKind;
  score?: number;
  canonicalKeywords?: string[];
}
