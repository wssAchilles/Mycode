import { create } from 'zustand';
import type { ChatSummary } from '../types';
import { contactAPI, groupAPI } from '../../../services/apiClient';
import type { Message } from '../../../types/chat';

const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || 'https://telegram-clone-backend-88ez.onrender.com';

const withApiBase = (url?: string | null) => {
    if (!url) return url || undefined;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
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
    groupDetailsSeq: number;
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

    // Industrial: apply bursty meta updates with a single state update (call-site batches on tick-end).
    applyChatMetaBatch: (batch: {
        lastMessages?: Array<{ chatId: string; message: Message }>;
        unreadDeltas?: Array<{ chatId: string; delta: number }>;
        onlineUpdates?: Array<{ userId: string; isOnline: boolean; lastSeen?: string }>;
        // Chat list structure updates (e.g. group joined/left/renamed) emitted by ChatCoreWorker.
        chatUpserts?: Array<{ chatId: string; isGroup: boolean; title?: string; avatarUrl?: string; memberCount?: number }>;
        chatRemovals?: Array<{ chatId: string }>;
    }) => void;
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
    groupDetailsSeq: 0,
    error: null,

    setChats: (chats) => set({ chats }),

    selectChat: (chatId) => set({ selectedChatId: chatId }),

    selectContact: (contact) => {
        // Cancel any in-flight group details request to avoid stale UI overwrites.
        const nextGroupDetailsSeq = get().groupDetailsSeq + 1;

        // 选择联系人时，清除群组选中
        set({
            selectedContact: contact,
            selectedGroup: null,
            selectedChatId: contact?.userId,
            isGroupChatMode: false,
            isLoadingGroupDetails: false,
            groupDetailsSeq: nextGroupDetailsSeq,
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
            const contactChats: ChatSummary[] = contactsRes.contacts.map((c: any) => {
                const ts = c.lastMessage?.timestamp ? Date.parse(c.lastMessage.timestamp) : 0;
                const lastMessageTimestamp = Number.isFinite(ts) ? ts : 0;
                return {
                    id: c.contactId || c.userId, // Ensure we get the correct User ID
                    title: c.alias || c.contact?.username || c.username || '未知用户',
                    avatarUrl: withApiBase(c.contact?.avatarUrl || c.avatarUrl),
                    lastMessage: c.lastMessage?.content || '', // Empty string for no message, handled in UI
                    time: c.lastMessage
                        ? new Date(c.lastMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : '',
                    lastMessageTimestamp,
                    unreadCount: c.unreadCount || 0,
                    online: c.isOnline || false,
                    isGroup: false,
                };
            });

            // 2. 映射群组
            const groupChats: ChatSummary[] = (groupsRes.groups || []).map((g: any) => {
                const ts = g.lastMessage?.timestamp ? Date.parse(g.lastMessage.timestamp) : 0;
                const lastMessageTimestamp = Number.isFinite(ts) ? ts : 0;
                return {
                    id: g.id,
                    title: g.name,
                    avatarUrl: withApiBase(g.avatarUrl), // 支持群头像
                    lastMessage: g.lastMessage?.content,
                    time: g.lastMessage
                        ? new Date(g.lastMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : '',
                    lastMessageTimestamp,
                    unreadCount: g.unreadCount || 0,
                    isGroup: true,
                    online: false, // 群组不显示在线状态
                    memberCount: g.memberCount || g.members?.length || 0,
                };
            });

            // 3. 合并并排序 (按最后消息时间倒序)
            const allChats = [...contactChats, ...groupChats].sort((a, b) => {
                return (b.lastMessageTimestamp ?? 0) - (a.lastMessageTimestamp ?? 0);
            });

            set({ chats: allChats, isLoading: false });
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
        const requestSeq = get().groupDetailsSeq + 1;

        // Immediately switch UI into group-chat mode (shell state) so fast switching won't
        // show previous chat header/details while the request is in flight.
        const summary = get().chats.find((c) => c.id === groupId && c.isGroup);
        const shellGroup: Group = {
            id: groupId,
            name: summary?.title || '群聊',
            description: undefined,
            ownerId: '',
            type: 'private',
            avatarUrl: summary?.avatarUrl,
            memberCount: summary?.memberCount || 0,
            maxMembers: 0,
            members: [],
            createdAt: new Date().toISOString(),
            isActive: true,
        };

        set({
            isLoadingGroupDetails: true,
            error: null,
            groupDetailsSeq: requestSeq,
            selectedGroup: shellGroup,
            selectedContact: null,
            selectedChatId: groupId,
            isGroupChatMode: true,
        });
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

            if (get().groupDetailsSeq !== requestSeq) return;

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
            if (get().groupDetailsSeq !== requestSeq) return;
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
        set((state) => {
            const contacts = state.contacts.slice();
            const contactIdx = contacts.findIndex((c) => c.userId === userId);
            if (contactIdx >= 0) {
                contacts[contactIdx] = { ...contacts[contactIdx], isOnline, lastSeen };
            }

            const chats = state.chats.slice();
            const chatIdx = chats.findIndex((c) => c.id === userId && !c.isGroup);
            if (chatIdx >= 0) {
                chats[chatIdx] = { ...chats[chatIdx], online: isOnline };
            }

            return { contacts, chats };
        });
    },

    // 更新联系人/群组最后一条消息
    updateContactLastMessage: (chatId, message) => {
        const parsedTs = Date.parse(message.timestamp);
        const lastMessageTimestamp = Number.isFinite(parsedTs) ? parsedTs : Date.now();

        let time = '';
        try {
            time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
            // ignore
        }

        set((state) => {
            const contacts = state.contacts.map((contact) =>
                contact.userId === chatId
                    ? { ...contact, lastMessage: message }
                    : contact
            );

            const idx = state.chats.findIndex((chat) => chat.id === chatId);
            if (idx < 0) {
                return { contacts };
            }

            // Industrial-style: move updated chat to top without sorting the whole list.
            const updated = {
                ...state.chats[idx],
                lastMessage: message.content,
                time,
                lastMessageTimestamp,
            };

            const chats = state.chats.slice();
            chats.splice(idx, 1);
            chats.unshift(updated);

            return { contacts, chats };
        });
    },

    incrementUnread: (chatId) => {
        set((state) => {
            if (state.selectedChatId === chatId) return state;

            const chats = state.chats.slice();
            const chatIdx = chats.findIndex((c) => c.id === chatId);
            if (chatIdx >= 0) {
                const chat = chats[chatIdx];
                chats[chatIdx] = { ...chat, unreadCount: (chat.unreadCount || 0) + 1 };
            }

            const contacts = state.contacts.slice();
            const contactIdx = contacts.findIndex((c) => c.userId === chatId);
            if (contactIdx >= 0) {
                const contact = contacts[contactIdx];
                contacts[contactIdx] = { ...contact, unreadCount: (contact.unreadCount || 0) + 1 };
            }

            return { chats, contacts };
        });
    },

    resetUnread: (chatId) => {
        set((state) => {
            const chats = state.chats.slice();
            const chatIdx = chats.findIndex((c) => c.id === chatId);
            if (chatIdx >= 0) {
                chats[chatIdx] = { ...chats[chatIdx], unreadCount: 0 };
            }

            const contacts = state.contacts.slice();
            const contactIdx = contacts.findIndex((c) => c.userId === chatId);
            if (contactIdx >= 0) {
                contacts[contactIdx] = { ...contacts[contactIdx], unreadCount: 0 };
            }

            return { chats, contacts };
        });
    },

    applyChatMetaBatch: (batch) => {
        if (!batch) return;

        set((state) => {
            const hasLast = Array.isArray(batch.lastMessages) && batch.lastMessages.length > 0;
            const hasUnread = Array.isArray(batch.unreadDeltas) && batch.unreadDeltas.length > 0;
            const hasOnline = Array.isArray(batch.onlineUpdates) && batch.onlineUpdates.length > 0;
            const hasUpserts = Array.isArray(batch.chatUpserts) && batch.chatUpserts.length > 0;
            const hasRemovals = Array.isArray(batch.chatRemovals) && batch.chatRemovals.length > 0;
            if (!hasLast && !hasUnread && !hasOnline && !hasUpserts && !hasRemovals) return state;

            // Create mutable copies and index maps (O(n) once per tick).
            const contacts = state.contacts.slice();
            let chats = state.chats.slice();

            let selectedContact = state.selectedContact;
            let selectedGroup = state.selectedGroup;
            let selectedChatId = state.selectedChatId;
            let isGroupChatMode = state.isGroupChatMode;
            let isLoadingGroupDetails = state.isLoadingGroupDetails;
            let groupDetailsSeq = state.groupDetailsSeq;

            // 0) Structural chat list changes (group upsert/removal).
            if (hasRemovals) {
                const removalIds = new Set<string>();
                for (const r of batch.chatRemovals!) {
                    const chatId = r?.chatId;
                    if (!chatId) continue;
                    removalIds.add(chatId);
                }

                if (removalIds.size) {
                    // Remove group chats in-place.
                    let w = 0;
                    for (let r = 0; r < chats.length; r += 1) {
                        const c = chats[r];
                        if (c?.isGroup && removalIds.has(c.id)) continue;
                        chats[w] = c;
                        w += 1;
                    }
                    chats.length = w;

                    // If the removed chat is currently selected, clear selection and cancel any in-flight details.
                    const activeGroupId = selectedGroup?.id;
                    const activeChatId = isGroupChatMode ? selectedChatId : undefined;
                    const shouldClear =
                        (activeGroupId && removalIds.has(activeGroupId)) ||
                        (activeChatId && removalIds.has(activeChatId));

                    if (shouldClear) {
                        selectedContact = null;
                        selectedGroup = null;
                        selectedChatId = undefined;
                        isGroupChatMode = false;
                        isLoadingGroupDetails = false;
                        groupDetailsSeq = groupDetailsSeq + 1;
                    }
                }
            }

            if (hasUpserts) {
                const chatIdxById = new Map<string, number>();
                for (let i = 0; i < chats.length; i += 1) {
                    chatIdxById.set(chats[i].id, i);
                }

                const newChats: ChatSummary[] = [];

                for (const u of batch.chatUpserts!) {
                    const chatId = u?.chatId;
                    if (!chatId) continue;

                    const idx = chatIdxById.get(chatId);
                    const nextAvatarUrl = withApiBase(u.avatarUrl);
                    const nextMemberCount = typeof u.memberCount === 'number' ? u.memberCount : undefined;

                    if (idx === undefined) {
                        // Insert a minimal shell chat so it appears without a full reload.
                        const title = (typeof u.title === 'string' && u.title) ? u.title : u.isGroup ? '群聊' : '聊天';
                        newChats.push({
                            id: chatId,
                            title,
                            avatarUrl: nextAvatarUrl,
                            lastMessage: '',
                            time: '',
                            lastMessageTimestamp: 0,
                            unreadCount: 0,
                            isGroup: !!u.isGroup,
                            online: !u.isGroup ? false : undefined,
                            memberCount: nextMemberCount,
                        });

                        // Keep selectedGroup shell up-to-date even if the chat did not exist in the list yet.
                        if (selectedGroup && selectedGroup.id === chatId && u.isGroup) {
                            selectedGroup = {
                                ...selectedGroup,
                                name: typeof u.title === 'string' ? u.title : selectedGroup.name,
                                avatarUrl: nextAvatarUrl ?? selectedGroup.avatarUrl,
                                memberCount: nextMemberCount ?? selectedGroup.memberCount,
                            };
                        }
                        continue;
                    }

                    const prev = chats[idx];
                    chats[idx] = {
                        ...prev,
                        isGroup: !!u.isGroup,
                        title: typeof u.title === 'string' ? u.title : prev.title,
                        avatarUrl: nextAvatarUrl ?? prev.avatarUrl,
                        memberCount: nextMemberCount ?? prev.memberCount,
                    };

                    // Keep selectedGroup shell up-to-date without a refetch.
                    if (selectedGroup && selectedGroup.id === chatId && u.isGroup) {
                        selectedGroup = {
                            ...selectedGroup,
                            name: typeof u.title === 'string' ? u.title : selectedGroup.name,
                            avatarUrl: nextAvatarUrl ?? selectedGroup.avatarUrl,
                            memberCount: nextMemberCount ?? selectedGroup.memberCount,
                        };
                    }
                }

                if (newChats.length) {
                    // New chats should be visible immediately; place them on top.
                    chats = newChats.concat(chats);
                }
            }

            const contactIdxByUserId = new Map<string, number>();
            for (let i = 0; i < contacts.length; i += 1) {
                contactIdxByUserId.set(contacts[i].userId, i);
            }
            const chatIdxById = new Map<string, number>();
            for (let i = 0; i < chats.length; i += 1) {
                chatIdxById.set(chats[i].id, i);
            }

            // 1) Online status (private chats + contacts).
            if (hasOnline) {
                for (const u of batch.onlineUpdates!) {
                    const userId = u?.userId;
                    if (!userId) continue;

                    const cIdx = contactIdxByUserId.get(userId);
                    if (cIdx !== undefined) {
                        contacts[cIdx] = { ...contacts[cIdx], isOnline: u.isOnline, lastSeen: u.lastSeen };
                    }

                    const chIdx = chatIdxById.get(userId);
                    if (chIdx !== undefined && !chats[chIdx].isGroup) {
                        chats[chIdx] = { ...chats[chIdx], online: u.isOnline };
                    }
                }
            }

            // 2) Unread deltas.
            if (hasUnread) {
                for (const d of batch.unreadDeltas!) {
                    const chatId = d?.chatId;
                    const delta = typeof d?.delta === 'number' ? d.delta : 0;
                    if (!chatId || !delta) continue;

                    const chIdx = chatIdxById.get(chatId);
                    if (chIdx !== undefined) {
                        const chat = chats[chIdx];
                        chats[chIdx] = { ...chat, unreadCount: (chat.unreadCount || 0) + delta };
                    }

                    const cIdx = contactIdxByUserId.get(chatId);
                    if (cIdx !== undefined) {
                        const contact = contacts[cIdx];
                        contacts[cIdx] = { ...contact, unreadCount: (contact.unreadCount || 0) + delta };
                    }
                }
            }

            // 3) Last message updates + reorder chats (move updated chats to top, preserving rest order).
            if (hasLast) {
                const updatedById = new Map<string, typeof chats[number]>();

                for (const item of batch.lastMessages!) {
                    const chatId = item?.chatId;
                    const message = item?.message;
                    if (!chatId || !message) continue;

                    const parsedTs = Date.parse(message.timestamp);
                    const lastMessageTimestamp = Number.isFinite(parsedTs) ? parsedTs : Date.now();

                    let time = '';
                    try {
                        time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    } catch {
                        // ignore
                    }

                    const cIdx = contactIdxByUserId.get(chatId);
                    if (cIdx !== undefined) {
                        contacts[cIdx] = { ...contacts[cIdx], lastMessage: message };
                    }

                    const chIdx = chatIdxById.get(chatId);
                    if (chIdx === undefined) continue;
                    const prev = chats[chIdx];
                    const updated = {
                        ...prev,
                        lastMessage: message.content,
                        time,
                        lastMessageTimestamp,
                    };
                    chats[chIdx] = updated;
                    updatedById.set(chatId, updated);
                }

                if (updatedById.size) {
                    const updatedList = Array.from(updatedById.values()).sort(
                        (a, b) => (b.lastMessageTimestamp ?? 0) - (a.lastMessageTimestamp ?? 0),
                    );
                    const rest = chats.filter((c) => !updatedById.has(c.id));
                    chats = updatedList.concat(rest);
                }
            }

            const partial: Partial<ChatState> = { contacts, chats };
            if (selectedContact !== state.selectedContact) partial.selectedContact = selectedContact;
            if (selectedGroup !== state.selectedGroup) partial.selectedGroup = selectedGroup;
            if (selectedChatId !== state.selectedChatId) partial.selectedChatId = selectedChatId;
            if (isGroupChatMode !== state.isGroupChatMode) partial.isGroupChatMode = isGroupChatMode;
            if (isLoadingGroupDetails !== state.isLoadingGroupDetails) partial.isLoadingGroupDetails = isLoadingGroupDetails;
            if (groupDetailsSeq !== state.groupDetailsSeq) partial.groupDetailsSeq = groupDetailsSeq;
            return partial as any;
        });
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
