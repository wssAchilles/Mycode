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

        // 仅对确实缺少媒体类型、NSFW 标记或视频时长的候选查库，纯图文候选直接短路跳过 MongoDB
        const lookupIdSet = new Set<string>();
        for (const candidate of candidates) {
            const needsLookup =
                candidate.hasVideo === undefined ||
                typeof candidate.isNsfw !== 'boolean' ||
                (candidate.hasVideo === true && candidate.videoDurationSec === undefined);
            if (!needsLookup) continue;

            const postId = candidate.postId?.toString?.() ?? String(candidate.postId || '');
            if (mongoose.Types.ObjectId.isValid(postId)) {
                lookupIdSet.add(postId);
            }
        }

        if (lookupIdSet.size === 0) {
            return candidates;
        }

        const ids = Array.from(lookupIdSet).map((id) => new mongoose.Types.ObjectId(id));
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
                videoDurationSec: durationSec ?? c.videoDurationSec,
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
