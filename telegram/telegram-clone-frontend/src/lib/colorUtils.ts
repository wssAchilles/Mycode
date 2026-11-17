/**
 * 头像颜色与首字母工具：采用高雅沉稳的中低饱和度色板（适配纯白淡色画布与白字对比）
 */

const AVATAR_COLORS: [string, string][] = [
    ['#E11D48', '#F43F5E'], // 玫瑰红
    ['#D97706', '#F59E0B'], // 琥珀金
    ['#7C3AED', '#8B5CF6'], // 紫罗兰
    ['#2563EB', '#3B82F6'], // 学院蓝
    ['#059669', '#10B981'], // 翡翠绿
    ['#0891B2', '#06B6D4'], // 湖青色
    ['#1D9BF0', '#38BDF8'], // 天空蓝
];

/**
 * 获取给定用户或群组 ID 的头像渐变色对。
 */
export function getAvatarColors(peerId: string | number): [string, string] {
    if (!peerId) return AVATAR_COLORS[0];

    const idNum = typeof peerId === 'number'
        ? peerId
        : Math.abs(stringToHash(peerId));

    const colorIndex = idNum % AVATAR_COLORS.length;
    return AVATAR_COLORS[colorIndex];
}

/**
 * 返回给定 ID 的 CSS 线性渐变背景。
 */
export function getAvatarGradient(peerId: string | number): string {
    const [c1, c2] = getAvatarColors(peerId);
    return `linear-gradient(135deg, ${c1}, ${c2})`;
}

/**
 * 提取名称首字母。
 */
export function getInitials(name: string): string {
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return '';

    if (parts.length === 1) {
        return parts[0].substring(0, 2).toUpperCase();
    }

    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function stringToHash(str: string): number {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
    }
    return hash;
}
