import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { buildSpaceFeedPageResult } from '../../src/services/recommendation/feed/pageResult';
import type { FeedCandidate } from '../../src/services/recommendation/types/FeedCandidate';

function candidate(overrides: Partial<FeedCandidate> = {}): FeedCandidate {
    return {
        postId: new mongoose.Types.ObjectId(),
        authorId: 'author-a',
        content: 'hello',
        createdAt: new Date('2026-05-04T00:00:00.000Z'),
        isReply: false,
        isRepost: false,
        recallSource: 'GraphSource',
        retrievalLane: 'social_expansion',
        inNetwork: false,
        ...overrides,
    };
}

describe('buildSpaceFeedPageResult', () => {
    it('keeps served id context generation outside the space service orchestration', () => {
        const postId = new mongoose.Types.ObjectId();
        const conversationId = new mongoose.Types.ObjectId();
        const page = buildSpaceFeedPageResult(
            [
                candidate({
                    postId,
                    authorId: 'Author-A',
                    recallSource: 'GraphSource',
                    conversationId,
                }),
            ],
            20,
        );

        expect(page.candidates).toHaveLength(1);
        expect(page.hasMore).toBe(false);
        expect(page.nextCursor).toBe('2026-05-04T00:00:00.000Z');
        expect(page.servedIdsDelta).toEqual([
            postId.toString(),
            conversationId.toString(),
            'author:author-a',
            'source:graphsource',
            `topic:conversation:${conversationId.toString().toLowerCase()}`,
        ]);
    });
});
