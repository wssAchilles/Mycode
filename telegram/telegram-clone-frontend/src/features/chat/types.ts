export interface ChatSummary {
    id: string;
    title: string;
    avatarUrl?: string;
    lastMessage?: string;
    time: string;
    unreadCount: number;
    isGroup?: boolean;
    online?: boolean;
    memberCount?: number;
}
