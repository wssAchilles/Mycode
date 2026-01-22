/**
 * VideoInfoHydrator - 视频时长/安全信息丰富器
 * 批量拉取帖子媒体信息，填充 videoDurationSec / hasVideo / isNsfw
 */

import mongoose from 'mongoose';
import { Hydrator } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import Post from '../../../models/Post';

export class VideoInfoHydrator implements Hydrator<FeedQuery, FeedCandidate> {
    readonly name = 'VideoInfoHydrator';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async hydrate(
        _query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<FeedCandidate[]> {
        if (candidates.length === 0) return candidates;

        const ids = candidates.map((c) => new mongoose.Types.ObjectId(c.postId));
        const posts = await Post.find({ _id: { $in: ids } })
            .select('media isNsfw')
            .lean();
        const map = new Map<string, any>();
        for (const p of posts) {
            map.set(p._id.toString(), p);
        }

        return candidates.map((c) => {
            const p = map.get(c.postId.toString());
            if (!p) return c;

            const media = (p.media as any[]) || [];
            const video = media.find((m) => m.type === 'video');
            const durationSec =
                video?.duration ||
                (typeof video?.duration === 'number' ? video.duration : undefined);

            return {
                ...c,
                hasVideo: c.hasVideo ?? Boolean(video),
                videoDurationSec: durationSec,
                isNsfw: p.isNsfw ?? c.isNsfw,
            };
        });
    }

    update(candidate: FeedCandidate, hydrated: Partial<FeedCandidate>): FeedCandidate {
        return {
            ...candidate,
            hasVideo: hydrated.hasVideo ?? candidate.hasVideo,
            videoDurationSec: hydrated.videoDurationSec ?? candidate.videoDurationSec,
            isNsfw: hydrated.isNsfw ?? candidate.isNsfw,
        };
    }
}
