import { z } from 'zod';

export const selfPostRescueRequestSchema = z.object({
  userId: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
  lookbackDays: z.number().int().min(1).max(180).optional(),
});

export type SelfPostRescueRequest = z.infer<typeof selfPostRescueRequestSchema>;
