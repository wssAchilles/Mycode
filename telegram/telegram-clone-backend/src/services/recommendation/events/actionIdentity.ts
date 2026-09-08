import { z } from 'zod';

export const candidateNamespaceSchema = z.enum(['serving_post_id', 'model_post_id']);

export const recommendationActionIdentitySchema = z.object({
    decisionId: z.string().uuid(),
    candidateNamespace: candidateNamespaceSchema,
    candidateId: z.string().trim().min(1),
}).strict();

export type CandidateNamespace = z.infer<typeof candidateNamespaceSchema>;
export type RecommendationActionIdentity = z.infer<typeof recommendationActionIdentitySchema>;

export function normalizeRecommendationActionIdentity(
    value: unknown,
): RecommendationActionIdentity | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const source = value as Record<string, unknown>;
    const parsed = recommendationActionIdentitySchema.safeParse({
        decisionId: source.decisionId,
        candidateNamespace: source.candidateNamespace,
        candidateId: source.candidateId,
    });
    return parsed.success ? parsed.data : undefined;
}
