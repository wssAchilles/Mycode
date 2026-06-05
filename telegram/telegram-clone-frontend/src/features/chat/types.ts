export interface ChatSummary {
    id: string;
    title: string;
    avatarUrl?: string;
    lastMessage?: string;
    time: string;
    // Used for efficient ordering without sorting on every incoming message.
    lastMessageTimestamp?: number;
    // Latest server sequence from the chat list. Used to persist read state
    // even before the message projection has fully loaded.
    lastMessageSeq?: number;
    unreadCount: number;
    // Incremented only for live unread deltas. Initial load / refresh should not animate.
    unreadPulseSeq?: number;
    isGroup?: boolean;
    online?: boolean;
    memberCount?: number;
}
