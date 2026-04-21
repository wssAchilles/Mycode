import { z } from 'zod';

export interface GraphAuthorMaterializationRequest {
  authorIds: string[];
  limitPerAuthor?: number;
  lookbackDays?: number;
}

export interface GraphAuthorMaterializationDiagnostics {
  requestedAuthorCount: number;
  uniqueAuthorCount: number;
  returnedPostCount: number;
  queryDurationMs: number;
  cacheHit: boolean;
  cacheKeyMode?: string;
  cacheTtlMs?: number;
  cacheEntryCount?: number;
  cacheEvictionCount?: number;
}

export const graphAuthorMaterializationRequestSchema = z.object({
  authorIds: z.array(z.string().min(1)).min(1).max(256),
  limitPerAuthor: z.number().int().min(1).max(8).optional(),
  lookbackDays: z.number().int().min(1).max(180).optional(),
});
