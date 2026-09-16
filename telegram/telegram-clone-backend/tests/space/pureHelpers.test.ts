import { describe, expect, it } from 'vitest';

import {
    buildExactTextSearchQuery,
    buildNewsSummary,
    buildTextSearchQuery,
    buildTopicTextSearchQueries,
    dedupePostsById,
    escapeRegexLiteral,
    extractKeywords,
    extractNewsKeywords,
    isValidTrendToken,
    mergeFeedTrendKeywords,
    normalizeSearchLimit,
    normalizeTopicTag,
} from '../../src/services/space/internal/pureHelpers';

describe('space pureHelpers', () => {
    it('mergeFeedTrendKeywords normalizes and caps tokens', () => {
        const merged = mergeFeedTrendKeywords(['#Hello-World'], ['foo_bar', null, '']);
        expect(merged).toContain('hello world');
        expect(merged).toContain('hello');
        expect(merged).toContain('foo bar');
        expect(merged.length).toBeLessThanOrEqual(32);
    });

    it('normalizeSearchLimit bounds to 1..50', () => {
        expect(normalizeSearchLimit(Number.NaN)).toBe(20);
        expect(normalizeSearchLimit(0)).toBe(1);
        expect(normalizeSearchLimit(999)).toBe(50);
        expect(normalizeSearchLimit(20.9)).toBe(20);
    });

    it('buildTextSearchQuery applies cursor strictly less-than', () => {
        const cursor = new Date('2026-01-01T00:00:00.000Z');
        const q = buildTextSearchQuery('hello', cursor) as Record<string, any>;
        expect(q.deletedAt).toBeNull();
        expect(q.$text).toEqual({ $search: 'hello' });
        expect(q.createdAt).toEqual({ $lt: cursor });
    });

    it('buildExactTextSearchQuery escapes regex metacharacters', () => {
        const q = buildExactTextSearchQuery('a+b') as Record<string, any>;
        expect(escapeRegexLiteral('a+b')).toBe('a\\+b');
        expect(JSON.stringify(q.$or)).toContain('a\\\\+b');
    });

    it('normalizeTopicTag strips hash and lowercases', () => {
        expect(normalizeTopicTag('#AI_News')).toBe('ai_news');
    });

    it('buildTopicTextSearchQueries emits hash/plain/spaced forms', () => {
        expect(buildTopicTextSearchQueries('ai-news')).toEqual([
            '#ai-news',
            'ai-news',
            'ai news',
        ]);
    });

    it('extractKeywords keeps hashtag bodies', () => {
        expect(extractKeywords('讨论 #Telegram 和 #Space')).toEqual(['Telegram', 'Space']);
    });

    it('buildNewsSummary truncates at 160 with ellipsis', () => {
        const long = 'x'.repeat(200);
        expect(buildNewsSummary(long)).toHaveLength(163);
        expect(buildNewsSummary(long.endsWith('...') ? long : long)).toMatch(/...$/);
        expect(buildNewsSummary('short')).toBe('short');
    });

    it('extractNewsKeywords lowercases and dedupes', () => {
        const kws = extractNewsKeywords('BBC News BBC news 2026 https://example.com 中文测试');
        expect(kws).toContain('bbc');
        expect(kws).toContain('news');
        expect(kws).toContain('2026');
        expect(kws).toContain('中文测试');
        expect(kws).not.toContain('https');
    });

    it('isValidTrendToken rejects stopwords and short tokens', () => {
        expect(isValidTrendToken('the')).toBe(false);
        expect(isValidTrendToken('a')).toBe(false);
        expect(isValidTrendToken('123')).toBe(false);
        expect(isValidTrendToken('telegram')).toBe(true);
    });

    it('dedupePostsById keeps first occurrence by id', () => {
        const posts = [
            { _id: '1', authorId: 'a', content: 'x', createdAt: 't' },
            { _id: '1', authorId: 'a', content: 'x2', createdAt: 't' },
            { _id: '2', authorId: 'a', content: 'y', createdAt: 't' },
        ] as any;
        const out = dedupePostsById(posts);
        expect(out).toHaveLength(2);
        expect(String((out[0] as any)._id)).toBe('1');
    });
});
