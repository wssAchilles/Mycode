export const COMMENT_MAX_LENGTH = 500;

/**
 * 将评论时间戳格式化为直观的中文相对时间或月日时间
 */
export function formatCommentTime(input: string | Date): string {
    const date = input instanceof Date ? input : new Date(input);
    const timestamp = date.getTime();
    if (Number.isNaN(timestamp)) {
        return '';
    }

    const now = new Date();
    const diffMs = now.getTime() - timestamp;

    if (diffMs >= 0) {
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) {
            return '刚刚';
        }
        if (diffMins < 60) {
            return `${diffMins}分钟前`;
        }
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) {
            return `${diffHours}小时前`;
        }
    }

    const sameYear = date.getFullYear() === now.getFullYear();
    if (sameYear) {
        return date.toLocaleString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
    });
}

/**
 * 生成完整本地时间文本，用于悬停提示
 */
export function formatFullCommentTime(input: string | Date): string {
    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}
