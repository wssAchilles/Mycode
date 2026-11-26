/**
 * 评论排序与作者筛选纯函数（详情页与抽屉共用）
 */
import type { CommentData } from '../../../services/spaceApi';

export type CommentSortMode = 'latest' | 'hot';

export function filterAndSortComments(
    comments: CommentData[],
    options: {
        sortBy: CommentSortMode;
        onlyAuthor: boolean;
        postAuthorId?: string;
    },
): CommentData[] {
    const filtered = options.onlyAuthor && options.postAuthorId
        ? comments.filter((comment) => comment.author.id === options.postAuthorId)
        : [...comments];

    if (options.sortBy === 'hot') {
        filtered.sort((a, b) => {
            const likeDiff = (b.likeCount || 0) - (a.likeCount || 0);
            if (likeDiff !== 0) return likeDiff;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
    } else {
        filtered.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
    }

    return filtered;
}
