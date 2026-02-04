/**
 * Telegram-like color generation for avatars.
 * Uses a predefined set of gradients and selects one based on the user ID/peer ID.
 */

// Basic telegram peer colors (top, bottom)
const AVATAR_COLORS: [string, string][] = [
    ['#FF516A', '#FF885E'], // Red
    ['#FF8E3C', '#FFBF2F'], // Orange
    ['#C649F0', '#9D4BF6'], // Purple
    ['#665FFF', '#82B1FF'], // Blue
    ['#54CB68', '#A0DE7E'], // Green
    ['#28C9B7', '#53EDD6'], // Cyan
    ['#2A9EF1', '#72D5FD'], // Light Blue
];

/**
 * Gets the gradient colors for a given peer ID.
 * @param peerId - The unique identifier for the user or chat (string or number).
 * @returns An array [colorTop, colorBottom].
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
 * Returns a CSS linear-gradient string for the given peer ID.
 */
export function getAvatarGradient(peerId: string | number): string {
    const [c1, c2] = getAvatarColors(peerId);
    return `linear-gradient(135deg, ${c1}, ${c2})`;
}

/**
 * Helper to extract initials from a name.
 * e.g., "John Doe" -> "JD", "Telegram" -> "T"
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

/**
 * Simple hash function for strings
 */
function stringToHash(str: string): number {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
}
