/**
 * Post feature snapshot refresh side-effect.
 * Extracted verbatim from spaceService.
 */
import mongoose from 'mongoose';
import { postFeatureSnapshotService } from '../../recommendation/contentFeatures';
import { createChildLogger } from '../../../utils/logger';

const log = createChildLogger('services:spaceService');

export function refreshPostFeatureSnapshots(
    postIds: Array<string | mongoose.Types.ObjectId | undefined | null>,
): void {
    const uniquePostIds = Array.from(
        new Map(
            postIds
                .map((postId) => {
                    const normalized = typeof postId === 'string'
                        ? postId
                        : postId?.toString();
                    if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) {
                        return null;
                    }
                    return [
                        normalized,
                        new mongoose.Types.ObjectId(normalized),
                    ] as const;
                })
                .filter(Boolean) as Array<readonly [string, mongoose.Types.ObjectId]>,
        ).values(),
    );

    if (uniquePostIds.length === 0) {
        return;
    }

    postFeatureSnapshotService
        .refreshSnapshotsByPostIds(uniquePostIds)
        .catch((error) => {
            log.warn({ err: error }, '[SpaceService] post feature snapshot refresh failed');
        });
}
