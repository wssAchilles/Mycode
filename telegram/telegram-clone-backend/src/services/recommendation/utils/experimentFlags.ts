import { FeedQuery } from '../types/FeedQuery';

// Centralized experiment id for Space feed recsys toggles.
// You can override this in environments if you want to run multiple iterations in parallel.
export const SPACE_FEED_EXPERIMENT_ID =
    process.env.SPACE_FEED_EXPERIMENT_ID || 'space_feed_recsys';

export function getSpaceFeedExperimentConfig<T>(
    query: FeedQuery,
    key: string,
    defaultValue: T
): T {
    try {
        const ctx: any = (query as any)?.experimentContext;
        if (!ctx || typeof ctx.getConfig !== 'function') return defaultValue;
        return ctx.getConfig(SPACE_FEED_EXPERIMENT_ID, key, defaultValue) as T;
    } catch {
        return defaultValue;
    }
}

export function getSpaceFeedExperimentFlag(
    query: FeedQuery,
    key: string,
    defaultValue: boolean = false
): boolean {
    const v = getSpaceFeedExperimentConfig<any>(query, key, defaultValue);
    return typeof v === 'boolean' ? v : defaultValue;
}
