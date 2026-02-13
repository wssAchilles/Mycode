import { create } from 'zustand';
import type { ChatSummary } from '../types';
import { contactAPI, groupAPI } from '../../../services/apiClient';
import type { Message } from '../../../types/chat';

const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || 'https://telegram-clone-backend-88ez.onrender.com';

const withApiBase = (url?: string | null) => {
    if (!url) return url || undefined;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

// 完整的 Contact 类型（从 useChat 迁移）
export interface Contact {
    id: string;
    userId: string;
    username: string;
    email?: string;
    avatarUrl?: string;
    alias?: string;
    status: 'accepted' | 'pending' | 'blocked' | 'rejected';
    isOnline: boolean;
    lastSeen?: string;
    lastMessage?: Message;
    unreadCount: number;
}

// 群组成员类型
export interface GroupMember {
    id: string;
    userId: string;
    username: string;
    avatarUrl?: string;
    role: 'owner' | 'admin' | 'member';
    status?: 'active' | 'muted' | 'banned' | 'left';
    mutedUntil?: string | null;
    joinedAt: string;
    isOnline?: boolean;
}

// 群组类型
export interface Group {
    id: string;
    name: string;
    description?: string;
    ownerId: string;
    type: 'public' | 'private';
    avatarUrl?: string;
    memberCount: number;
    maxMembers: number;
    members?: GroupMember[];
    currentUserRole?: 'owner' | 'admin' | 'member';
    currentUserStatus?: 'active' | 'muted' | 'banned' | 'left';
    createdAt: string;
    isActive: boolean;
    unreadCount?: number;
    lastMessage?: Message | null;
}

interface ChatState {
    // 联系人数据
    chats: ChatSummary[];
    contacts: Contact[];
    pendingRequests: Contact[];
    selectedContact: Contact | null;
    selectedGroup: Group | null;  // 新增：选中的群组
    selectedChatId: string | undefined;
    isGroupChatMode: boolean;     // 新增：是否处于群聊模式

    // 加载状态
    isLoading: boolean;
    isLoadingContacts: boolean;
    isLoadingPendingRequests: boolean;
    isLoadingGroupDetails: boolean;  // 新增
    error: string | null;

    // Actions
    setChats: (chats: ChatSummary[]) => void;
    selectChat: (chatId: string) => void;
    selectContact: (contact: Contact | null) => void;
    selectGroup: (group: Group | null) => void;  // 新增

    // 联系人操作
    loadChats: () => Promise<void>;
    loadContacts: () => Promise<void>;
    loadPendingRequests: () => Promise<void>;
    handleContactRequest: (requestId: string, action: 'accept' | 'reject') => Promise<void>;
    createGroup: (name: string, description: string, memberIds: string[]) => Promise<void>;

    // 群组操作
    loadGroupDetails: (groupId: string) => Promise<void>;  // 新增
    leaveGroup: (groupId: string) => Promise<void>;        // 新增

    // 实时更新
    updateContactOnlineStatus: (userId: string, isOnline: boolean, lastSeen?: string) => void;
    updateContactLastMessage: (userId: string, message: Message) => void;
    incrementUnread: (chatId: string) => void;
    resetUnread: (chatId: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
    chats: [],
    contacts: [],
    pendingRequests: [],
    selectedContact: null,
    selectedGroup: null,          // 新增
    selectedChatId: undefined,
    isGroupChatMode: false,       // 新增
    isLoading: false,
    isLoadingContacts: false,
    isLoadingPendingRequests: false,
    isLoadingGroupDetails: false, // 新增
    error: null,

    setChats: (chats) => set({ chats }),

    selectChat: (chatId) => set({ selectedChatId: chatId }),

    selectContact: (contact) => {
        // 选择联系人时，清除群组选中
        set({
            selectedContact: contact,
            selectedGroup: null,
            selectedChatId: contact?.userId,
            isGroupChatMode: false
        });
        if (contact?.userId) {
            get().resetUnread(contact.userId);
        }
    },

    // 新增：选择群组
    selectGroup: (group) => {
        set({
            selectedGroup: group,
            selectedContact: null,
            selectedChatId: group?.id,
            isGroupChatMode: !!group
        });
        if (group?.id) {
            get().resetUnread(group.id);
        }
    },

    // 加载聊天列表（联系人 + 群组）
    loadChats: async () => {
        set({ isLoading: true });
        try {
            // 并行请求联系人和群组
            const [contactsRes, groupsRes] = await Promise.all([
                contactAPI.getContacts('accepted'),
                groupAPI.getUserGroups()
            ]);

            // 1. 映射联系人 (Ensure we map ALL accepted contacts)
            const contactChats: ChatSummary[] = contactsRes.contacts.map((c: any) => ({
                id: c.contactId || c.userId, // Ensure we get the correct User ID
                title: c.alias || c.contact?.username || c.username || '未知用户',
                avatarUrl: withApiBase(c.contact?.avatarUrl || c.avatarUrl),
                lastMessage: c.lastMessage?.content || '', // Empty string for no message, handled in UI
                time: c.lastMessage
                    ? new Date(c.lastMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '',
                unreadCount: c.unreadCount || 0,
                online: c.isOnline || false,
                isGroup: false,
                lastMessageTimestamp: c.lastMessage?.timestamp || 0
            }));

            // 2. 映射群组
            const groupChats: ChatSummary[] = (groupsRes.groups || []).map((g: any) => ({
                id: g.id,
                title: g.name,
                avatarUrl: withApiBase(g.avatarUrl), // 支持群头像
                lastMessage: g.lastMessage?.content,
                time: g.lastMessage
                    ? new Date(g.lastMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '',
                unreadCount: g.unreadCount || 0,
                isGroup: true,
                online: false, // 群组不显示在线状态
                memberCount: g.memberCount || g.members?.length || 0,
                lastMessageTimestamp: g.lastMessage?.timestamp || 0 // 辅助排序
            }));

            // 3. 合并并排序 (按最后消息时间倒序)
            const allChats = [...contactChats, ...groupChats].sort((a: any, b: any) => {
                return (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0);
            });

            // 移除辅助字段
            const finalChats = allChats.map(({ lastMessageTimestamp, ...chat }: any) => chat);

            set({ chats: finalChats, isLoading: false });
        } catch (error: any) {
            console.error('加载聊天列表失败:', error);
            set({ isLoading: false, error: error.message });
        }
    },

    // 创建群组
    createGroup: async (name: string, description: string, memberIds: string[]) => {
        set({ isLoading: true });
        try {
            // 1. 创建群组
            const response = await groupAPI.createGroup({
                name,
                description,
                type: 'private' // 默认为私有群
            });

            // 2. 添加成员
            if (memberIds && memberIds.length > 0) {
                try {
                    // 使用上一步创建的群组 ID 添加成员
                    const groupId = response.group.id;
                    await groupAPI.addMembers(groupId, memberIds);
                } catch (addMemberError) {
                    console.error('添加群组成员部分失败:', addMemberError);
                    // 不中断流程，群组已创建成功
                }
            }

            // 3. 刷新列表
            await get().loadChats();
        } catch (error: any) {
            console.error('创建群组失败:', error);
            set({ error: error.message, isLoading: false });
        }
    },

    // 加载联系人列表（完整 Contact 对象）
    loadContacts: async () => {
        set({ isLoadingContacts: true, error: null });
        try {
            const response = await contactAPI.getContacts('accepted');
            const contacts: Contact[] = response.contacts.map((contact: any) => ({
                id: contact.id,
                userId: contact.contactId,
                username: contact.contact?.username || '未知用户',
                email: contact.contact?.email,
                avatarUrl: withApiBase(contact.contact?.avatarUrl),
                alias: contact.alias,
                status: contact.status,
                isOnline: false,
                lastSeen: contact.contact?.lastSeen,
                lastMessage: undefined,
                unreadCount: 0,
            }));

            set({ contacts, isLoadingContacts: false });
        } catch (error: any) {
            set({ error: error.message, isLoadingContacts: false });
        }
    },

    // 加载待处理请求
    loadPendingRequests: async () => {
        set({ isLoadingPendingRequests: true, error: null });
        try {
            const response = await contactAPI.getPendingRequests();
            const requestsArray = response?.pendingRequests || response?.requests || [];

            if (!Array.isArray(requestsArray)) {
                console.warn('待处理请求数据不是数组:', requestsArray);
                set({ pendingRequests: [], isLoadingPendingRequests: false });
                return;
            }

            const pendingRequests: Contact[] = requestsArray.map((request: any) => ({
                id: request.id,
                userId: request.userId,
                username: request.user?.username || '未知用户',
                email: request.user?.email,
                avatarUrl: withApiBase(request.user?.avatarUrl),
                alias: request.alias,
                status: request.status,
                isOnline: false,
                lastSeen: request.user?.lastSeen,
                lastMessage: undefined,
                unreadCount: 0,
            }));

            set({ pendingRequests, isLoadingPendingRequests: false });
        } catch (error: any) {
            console.error('加载待处理请求失败:', error);
            set({ error: error.message, pendingRequests: [], isLoadingPendingRequests: false });
        }
    },

    // 处理联系人请求
    handleContactRequest: async (requestId, action) => {
        try {
            await contactAPI.handleRequest(requestId, action);
            // 重新加载数据
            get().loadContacts();
            get().loadPendingRequests();
            get().loadChats();
        } catch (error: any) {
            console.error(`处理联系人请求失败 (${action}):`, error);
            set({ error: error.message });
        }
    },

    // 新增：加载群组详情
    loadGroupDetails: async (groupId: string) => {
        set({ isLoadingGroupDetails: true, error: null });
        try {
            const response = await groupAPI.getGroupDetails(groupId);
            const groupData = response.group;
            const memberList = response.members || groupData.members || [];

            // 构造 Group 对象
            const group: Group = {
                id: groupData.id,
                name: groupData.name,
                description: groupData.description,
                ownerId: groupData.ownerId,
                type: groupData.type,
                avatarUrl: withApiBase(groupData.avatarUrl),
                memberCount: response.memberCount ?? groupData.memberCount,
                maxMembers: groupData.maxMembers,
                currentUserRole: groupData.currentUserRole,
                currentUserStatus: groupData.currentUserStatus,
                createdAt: groupData.createdAt,
                isActive: groupData.isActive,
                members: memberList.map((m: any) => ({
                    id: m.id,
                    userId: m.userId,
                    username: m.user?.username || '未知用户',
                    avatarUrl: withApiBase(m.user?.avatarUrl),
                    role: m.role,
                    status: m.status,
                    mutedUntil: m.mutedUntil || null,
                    joinedAt: m.joinedAt,
                    isOnline: false
                }))
            };

            set({
                selectedGroup: group,
                selectedContact: null,
                selectedChatId: group.id,
                isGroupChatMode: true,
                isLoadingGroupDetails: false
            });
            // 工业级：进入群聊即视为“已查看”，本地未读立即清零
            get().resetUnread(group.id);
        } catch (error: any) {
            console.error('加载群组详情失败:', error);
            set({ error: error.message, isLoadingGroupDetails: false });
        }
    },

    // 新增：退出群组
    leaveGroup: async (groupId: string) => {
        try {
            await groupAPI.leaveGroup(groupId);
            // 清除选中状态并重新加载聊天列表
            set({
                selectedGroup: null,
                selectedChatId: undefined,
                isGroupChatMode: false
            });
            await get().loadChats();
        } catch (error: any) {
            console.error('退出群组失败:', error);
            set({ error: error.message });
            throw error;
        }
    },

    // 更新联系人在线状态
    updateContactOnlineStatus: (userId, isOnline, lastSeen) => {
        set((state) => ({
            contacts: state.contacts.map((contact) =>
                contact.userId === userId
                    ? { ...contact, isOnline, lastSeen }
                    : contact
            ),
            chats: state.chats.map((chat) =>
                chat.id === userId && !chat.isGroup // 仅更新非群组的在线状态
                    ? { ...chat, online: isOnline }
                    : chat
            ),
        }));
    },

    // 更新联系人/群组最后一条消息
    updateContactLastMessage: (chatId, message) => {
        set((state) => ({
            // 如果是个人聊天，更新 contacts
            contacts: state.contacts.map((contact) =>
                contact.userId === chatId
                    ? { ...contact, lastMessage: message }
                    : contact
            ),
            // 更新 chats (无论是个人还是群组)
            chats: state.chats.map((chat) =>
                chat.id === chatId
                    ? {
                        ...chat,
                        lastMessage: message.content,
                        time: new Date(message.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit'
                        }),
                        // 如果我们在 store 里保留 lastMessageTimestamp 字段会更好，但这里我们直接更新 UI 字段
                    }
                    : chat
            ).sort(() => { // 简单的重排序逻辑，实际可能需要更复杂的时间比较
                // 注意：这里没有 timestamp 字段，只能简单处理或者忽略重排序
                // 为了简单起见，暂时不在此处重排序，只更新内容
                return 0;
            }),
        }));
    },

    incrementUnread: (chatId) => {
        set((state) => {
            if (state.selectedChatId === chatId) return state;
            return {
                chats: state.chats.map((chat) =>
                    chat.id === chatId
                        ? { ...chat, unreadCount: (chat.unreadCount || 0) + 1 }
                        : chat
                ),
                contacts: state.contacts.map((contact) =>
                    contact.userId === chatId
                        ? { ...contact, unreadCount: (contact.unreadCount || 0) + 1 }
                        : contact
                ),
            };
        });
    },

    resetUnread: (chatId) => {
        set((state) => ({
            chats: state.chats.map((chat) =>
                chat.id === chatId ? { ...chat, unreadCount: 0 } : chat
            ),
            contacts: state.contacts.map((contact) =>
                contact.userId === chatId ? { ...contact, unreadCount: 0 } : contact
            ),
        }));
    },
}));

// Selectors
export const selectAllChats = (state: ChatState) => state.chats;
export const selectActiveChatId = (state: ChatState) => state.selectedChatId;
export const selectIsLoading = (state: ChatState) => state.isLoading;
export const selectChatById = (id: string) => (state: ChatState) => state.chats.find(c => c.id === id);
export const selectSelectedContact = (state: ChatState) => state.selectedContact;
export const selectContacts = (state: ChatState) => state.contacts;
export const selectPendingRequests = (state: ChatState) => state.pendingRequests;
