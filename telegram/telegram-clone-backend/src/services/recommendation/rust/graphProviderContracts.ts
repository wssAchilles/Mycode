import { z } from 'zod';

export interface GraphAuthorMaterializationRequest {
  authorIds: string[];
  limitPerAuthor?: number;
  lookbackDays?: number;
}

export const graphAuthorMaterializationRequestSchema = z.object({
  authorIds: z.array(z.string().min(1)).min(1).max(256),
  limitPerAuthor: z.number().int().min(1).max(8).optional(),
  lookbackDays: z.number().int().min(1).max(180).optional(),
});
