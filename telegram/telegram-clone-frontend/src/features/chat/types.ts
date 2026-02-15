export interface ChatSummary {
    id: string;
    title: string;
    avatarUrl?: string;
    lastMessage?: string;
    time: string;
    // Used for efficient ordering without sorting on every incoming message.
    lastMessageTimestamp?: number;
    unreadCount: number;
    isGroup?: boolean;
    online?: boolean;
    memberCount?: number;
}
