import { FeedQuery } from '../types/FeedQuery';

export function extractExperimentKeys(query: Pick<FeedQuery, 'experimentContext'>): string[] {
    const assignments = query.experimentContext?.assignments || [];
    return assignments
        .filter((a) => a.inExperiment && a.experimentId && a.bucket)
        .map((a) => `${a.experimentId}:${a.bucket}`);
}

