/**
 * GroupDetailPanel - 群组设置与成员管理抽屉
 * 对标 Telegram / Apple HIG Grouped Inset Settings 框架：
 * 1. Vibrancy 粘性顶栏 + Hero 群档案卡片（名称/简介/公开私有切换）
 * 2. 快捷操作条（免打扰开关、邀请成员、复制群标识）
 * 3. 权限与群类型设置分组
 * 4. 成员搜索、角色筛选、Radix DropdownMenu 成员治理菜单
 * 5. 内联危险操作二次确认（退出 / 解散群组）
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import {
    Bell,
    BellOff,
    Check,
    ChevronLeft,
    Copy,
    Crown,
    Globe,
    Lock,
    MoreHorizontal,
    Pencil,
    Search,
    Shield,
    ShieldOff,
    UserMinus,
    UserPlus,
    Volume2,
    VolumeX,
    X,
} from 'lucide-react';
import { useChatStore, type Group, type GroupMember } from '../../features/chat/store/chatStore';
import { useChatUiPrefsStore } from '../../features/chat/state/chatUiPrefsStore';
import { Avatar } from '../../components/common';
import { authUtils, groupAPI } from '../../services/apiClient';
import { showToast } from '../../components/ui/Toast';
import {
    GROUP_MEMBER_LIMIT_PRESETS,
    GroupAvatarPicker,
    resolveGroupAvatarUrlForSubmit,
    type GroupAvatarSelection,
} from '../../features/chat/components/group';
import './GroupDetailPanel.css';

interface GroupDetailPanelProps {
    isOpen: boolean;
    onClose: () => void;
    group: Group | null;
}

type MemberFilter = 'all' | 'staff' | 'online';

const panelVariants = {
    hidden: { x: '100%', opacity: 0 },
    visible: { x: 0, opacity: 1, transition: { type: 'spring' as const, damping: 28, stiffness: 320 } },
    exit: { x: '100%', opacity: 0, transition: { duration: 0.18 } },
};

const LEGACY_MUTE_STORAGE_KEY_PREFIX = 'tg:group-muted:';

const migrateLegacyGroupMuted = (
    groupId: string | undefined,
    mutedChatIds: string[],
    toggleMuteChat: (id: string) => boolean,
): void => {
    if (!groupId || typeof localStorage === 'undefined') return;
    try {
        const legacyKey = `${LEGACY_MUTE_STORAGE_KEY_PREFIX}${groupId}`;
        const legacyVal = localStorage.getItem(legacyKey);
        if (legacyVal === '1') {
            if (!mutedChatIds.includes(groupId)) {
                toggleMuteChat(groupId);
            }
            localStorage.removeItem(legacyKey);
        }
    } catch {
        // 忽略无痕模式存储异常
    }
};

const GroupDetailPanel: React.FC<GroupDetailPanelProps> = ({ isOpen, onClose, group }) => {
    const leaveGroup = useChatStore((s) => s.leaveGroup);
    const loadGroupDetails = useChatStore((s) => s.loadGroupDetails);
    const loadChats = useChatStore((s) => s.loadChats);
    const selectGroup = useChatStore((s) => s.selectGroup);
    const contacts = useChatStore((s) => s.contacts);
    const mutedChatIds = useChatUiPrefsStore((s) => s.mutedChatIds);
    const toggleMuteChat = useChatUiPrefsStore((s) => s.toggleMuteChat);

    const currentUser = authUtils.getCurrentUser();
    const isOwner = Boolean(currentUser?.id && currentUser.id === group?.ownerId);
    const currentRole = group?.currentUserRole || (isOwner ? 'owner' : 'member');
    const canManage = currentRole === 'owner' || currentRole === 'admin';

    const [isEditing, setIsEditing] = useState(false);
    const [avatarSelection, setAvatarSelection] = useState<GroupAvatarSelection>({
        mode: 'existing',
        url: group?.avatarUrl || null,
    });
    const [nameDraft, setNameDraft] = useState(group?.name || '');
    const [descDraft, setDescDraft] = useState(group?.description || '');
    const [typeDraft, setTypeDraft] = useState<'public' | 'private'>(group?.type === 'private' ? 'private' : 'public');
    const [maxMembersDraft, setMaxMembersDraft] = useState<number>(group?.maxMembers || 200);
    const [savingStage, setSavingStage] = useState<'idle' | 'uploading' | 'saving'>('idle');
    const isSaving = savingStage !== 'idle';

    const isMuted = Boolean(group?.id && mutedChatIds.includes(group.id));
    const [inviteOpen, setInviteOpen] = useState(false);
    const [selectedInviteIds, setSelectedInviteIds] = useState<string[]>([]);
    const [inviting, setInviting] = useState(false);

    const [memberSearch, setMemberSearch] = useState('');
    const [memberFilter, setMemberFilter] = useState<MemberFilter>('all');
    const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const [pendingTransferMember, setPendingTransferMember] = useState<GroupMember | null>(null);
    const [busyMemberId, setBusyMemberId] = useState<string | null>(null);

    useEffect(() => {
        setAvatarSelection({ mode: 'existing', url: group?.avatarUrl || null });
        setNameDraft(group?.name || '');
        setDescDraft(group?.description || '');
        setTypeDraft(group?.type === 'private' ? 'private' : 'public');
        setMaxMembersDraft(group?.maxMembers && group.maxMembers >= 2 ? group.maxMembers : 200);
        migrateLegacyGroupMuted(group?.id, mutedChatIds, toggleMuteChat);
        setIsEditing(false);
        setInviteOpen(false);
        setSelectedInviteIds([]);
        setMemberSearch('');
        setMemberFilter('all');
        setConfirmLeaveOpen(false);
        setPendingTransferMember(null);
    }, [group?.id, group?.name, group?.description, group?.type, group?.avatarUrl, group?.maxMembers]);

    const resetDrafts = () => {
        setAvatarSelection({ mode: 'existing', url: group?.avatarUrl || null });
        setNameDraft(group?.name || '');
        setDescDraft(group?.description || '');
        setTypeDraft(group?.type === 'private' ? 'private' : 'public');
        setMaxMembersDraft(group?.maxMembers && group.maxMembers >= 2 ? group.maxMembers : 200);
    };

    const handleToggleMute = () => {
        if (!group) return;
        const nextMuted = toggleMuteChat(group.id);
        showToast(nextMuted ? '已开启群消息免打扰' : '已恢复群消息通知', 'info');
    };

    const handleCopyGroupId = async () => {
        if (!group) return;
        try {
            await navigator.clipboard.writeText(group.id);
            showToast('已复制群组 ID', 'success');
        } catch {
            showToast('复制失败，请手动复制', 'error');
        }
    };

    const handleSaveGroup = async () => {
        if (!group) return;
        const trimmedName = nameDraft.trim();
        if (!trimmedName) {
            showToast('群组名称不能为空', 'error');
            return;
        }
        const minAllowedMembers = Math.max(2, group.memberCount || 2);
        if (maxMembersDraft < minAllowedMembers || maxMembersDraft > 1000) {
            showToast(`成员上限需在 ${minAllowedMembers} 到 1000 之间`, 'error');
            return;
        }

        const needsAvatarUpload = avatarSelection.mode === 'file' || avatarSelection.mode === 'preset';
        setSavingStage(needsAvatarUpload ? 'uploading' : 'saving');
        try {
            const resolvedAvatarUrl = await resolveGroupAvatarUrlForSubmit(
                avatarSelection,
                groupAPI.uploadGroupAvatar,
            );
            setSavingStage('saving');
            await groupAPI.updateGroup(group.id, {
                name: trimmedName,
                description: descDraft.trim(),
                type: typeDraft,
                maxMembers: maxMembersDraft,
                ...(resolvedAvatarUrl !== undefined ? { avatarUrl: resolvedAvatarUrl } : {}),
            });
            await Promise.all([loadGroupDetails(group.id), loadChats()]);
            setIsEditing(false);
            showToast('群组设置已保存', 'success');
        } catch (error) {
            const msg = error instanceof Error ? error.message : '更新群组失败';
            showToast(msg, 'error');
        } finally {
            setSavingStage('idle');
        }
    };

    const handleQuickTypeSwitch = async (nextType: 'public' | 'private') => {
        if (!group || !canManage || group.type === nextType || isSaving) return;
        setSavingStage('saving');
        try {
            await groupAPI.updateGroup(group.id, { type: nextType });
            await Promise.all([loadGroupDetails(group.id), loadChats()]);
            showToast(nextType === 'public' ? '已切换为公开群组' : '已切换为私有群组', 'success');
        } catch (error) {
            const msg = error instanceof Error ? error.message : '切换群类型失败';
            showToast(msg, 'error');
        } finally {
            setSavingStage('idle');
        }
    };

    const invitableContacts = useMemo(() => {
        const memberIdSet = new Set((group?.members || []).map((m) => m.userId));
        return contacts.filter((c) => c.userId && !memberIdSet.has(c.userId));
    }, [contacts, group?.members]);

    const toggleInviteCandidate = (userId: string) => {
        setSelectedInviteIds((prev) =>
            prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
        );
    };

    const handleInviteMembers = async () => {
        if (!group || selectedInviteIds.length === 0) return;
        setInviting(true);
        try {
            await groupAPI.addMembers(group.id, selectedInviteIds);
            await Promise.all([loadGroupDetails(group.id), loadChats()]);
            showToast(`已邀请 ${selectedInviteIds.length} 位联系人加入群组`, 'success');
            setSelectedInviteIds([]);
            setInviteOpen(false);
        } catch (error) {
            const msg = error instanceof Error ? error.message : '邀请成员失败';
            showToast(msg, 'error');
        } finally {
            setInviting(false);
        }
    };

    const handleLeaveOrDeleteGroup = async () => {
        if (!group || leaving) return;
        setLeaving(true);
        try {
            if (isOwner) {
                await groupAPI.deleteGroup(group.id);
                await loadChats();
                selectGroup(null);
                showToast('群组已解散', 'info');
            } else {
                await leaveGroup(group.id);
                showToast('已退出群组', 'info');
            }
            onClose();
        } catch (error) {
            const msg = error instanceof Error ? error.message : '操作失败';
            showToast(msg, 'error');
        } finally {
            setLeaving(false);
        }
    };

    const handleMemberAction = async (
        action: 'mute' | 'unmute' | 'kick' | 'promote' | 'demote' | 'transfer',
        member: GroupMember
    ) => {
        if (!group || busyMemberId) return;
        setBusyMemberId(member.userId);
        try {
            if (action === 'mute') {
                await groupAPI.muteMember(group.id, member.userId, 24);
                showToast(`已禁言 ${member.username}（24 小时）`, 'info');
            } else if (action === 'unmute') {
                await groupAPI.unmuteMember(group.id, member.userId);
                showToast(`已解除 ${member.username} 禁言`, 'success');
            } else if (action === 'kick') {
                await groupAPI.removeMember(group.id, member.userId);
                showToast(`已将 ${member.username} 移出群组`, 'info');
            } else if (action === 'promote') {
                await groupAPI.promoteMember(group.id, member.userId);
                showToast(`已将 ${member.username} 设为管理员`, 'success');
            } else if (action === 'demote') {
                await groupAPI.demoteMember(group.id, member.userId);
                showToast(`已取消 ${member.username} 的管理员身份`, 'info');
            } else if (action === 'transfer') {
                await groupAPI.transferOwnership(group.id, member.userId);
                setPendingTransferMember(null);
                showToast(`已将群主转让给 ${member.username}`, 'success');
            }
            await Promise.all([loadGroupDetails(group.id), loadChats()]);
        } catch (error) {
            const msg = error instanceof Error ? error.message : '成员操作失败';
            showToast(msg, 'error');
        } finally {
            setBusyMemberId(null);
        }
    };

    const getRoleBadge = (role: string) => {
        switch (role) {
            case 'owner':
                return '群主';
            case 'admin':
                return '管理员';
            default:
                return null;
        }
    };

    const onlineCount = useMemo(
        () => (group?.members || []).filter((m) => m.isOnline).length,
        [group?.members]
    );

    const filteredMembers = useMemo(() => {
        const members = group?.members || [];
        const query = memberSearch.trim().toLowerCase();
        const roleRank = (role?: string) => (role === 'owner' ? 0 : role === 'admin' ? 1 : 2);

        return members
            .filter((member) => {
                if (memberFilter === 'staff' && member.role !== 'owner' && member.role !== 'admin') {
                    return false;
                }
                if (memberFilter === 'online' && !member.isOnline) {
                    return false;
                }
                if (query && !member.username.toLowerCase().includes(query)) {
                    return false;
                }
                return true;
            })
            .slice()
            .sort((a, b) => roleRank(a.role) - roleRank(b.role));
    }, [group?.members, memberFilter, memberSearch]);

    if (!group) return null;

    const roleLabel = currentRole === 'owner' ? '群主' : currentRole === 'admin' ? '管理员' : '普通成员';

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.aside
                    className="group-detail-panel"
                    variants={panelVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    aria-label="群组设置"
                >
                    {/* Vibrancy 吸顶顶栏 */}
                    <header className="group-detail-header">
                        <button
                            type="button"
                            className="group-detail-close"
                            onClick={onClose}
                            aria-label="关闭群组设置"
                            title="关闭"
                        >
                            <ChevronLeft size={20} strokeWidth={2.2} />
                        </button>
                        <h2>群组设置</h2>
                        {canManage && !isEditing && (
                            <button
                                type="button"
                                className="group-header-edit-btn"
                                onClick={() => {
                                    resetDrafts();
                                    setIsEditing(true);
                                }}
                                aria-label="编辑群信息"
                            >
                                <Pencil size={14} />
                                <span>编辑</span>
                            </button>
                        )}
                    </header>

                    {/* 滚动主体（Apple Grouped Inset 卡片流） */}
                    <div className="group-detail-scroll">
                        {/* 1. 群组档案卡片 */}
                        <section className="group-inset-card group-detail-info">
                            {!isEditing && (
                                <div className="group-detail-avatar">
                                    <Avatar name={group.name} src={group.avatarUrl} size="lg" />
                                </div>
                            )}

                            {isEditing ? (
                                <div className="group-detail-edit">
                                    <GroupAvatarPicker
                                        inputId="edit-group-avatar-input"
                                        groupName={nameDraft.trim() || group.name}
                                        selection={avatarSelection}
                                        onChange={setAvatarSelection}
                                        disabled={isSaving}
                                    />
                                    <div className="group-edit-field">
                                        <label className="group-edit-label-head" htmlFor="edit-group-name">
                                            <span>群组名称</span>
                                            <span className="group-edit-counter">{nameDraft.length}/100</span>
                                        </label>
                                        <input
                                            id="edit-group-name"
                                            className="group-detail-input"
                                            value={nameDraft}
                                            onChange={(e) => setNameDraft(e.target.value)}
                                            placeholder="输入群组名称"
                                            maxLength={100}
                                            disabled={isSaving}
                                        />
                                    </div>
                                    <div className="group-edit-field">
                                        <label className="group-edit-label-head" htmlFor="edit-group-desc">
                                            <span>群组简介</span>
                                            <span className="group-edit-counter">{descDraft.length}/500</span>
                                        </label>
                                        <textarea
                                            id="edit-group-desc"
                                            className="group-detail-textarea"
                                            value={descDraft}
                                            onChange={(e) => setDescDraft(e.target.value)}
                                            placeholder="向成员介绍本群用途与规则..."
                                            maxLength={500}
                                            disabled={isSaving}
                                        />
                                    </div>
                                    <div className="group-edit-field">
                                        <span className="group-edit-label-head">群组可见性</span>
                                        <div className="group-segmented" role="group" aria-label="群组可见性">
                                            <button
                                                type="button"
                                                className={`group-segmented-btn ${typeDraft === 'public' ? 'is-active' : ''}`}
                                                onClick={() => setTypeDraft('public')}
                                                disabled={isSaving}
                                            >
                                                <Globe size={13} />
                                                <span>公开群组</span>
                                            </button>
                                            <button
                                                type="button"
                                                className={`group-segmented-btn ${typeDraft === 'private' ? 'is-active' : ''}`}
                                                onClick={() => setTypeDraft('private')}
                                                disabled={isSaving}
                                            >
                                                <Lock size={13} />
                                                <span>私有群组</span>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="group-edit-field">
                                        <label className="group-edit-label-head" htmlFor="edit-group-max-members">
                                            <span>成员人数上限</span>
                                            <span className="group-edit-limit-badge">{maxMembersDraft} 人</span>
                                        </label>
                                        <div className="group-edit-limit-presets" role="group" aria-label="人数上限快捷档位">
                                            {GROUP_MEMBER_LIMIT_PRESETS.map((presetLimit) => {
                                                const minAllowed = Math.max(2, group.memberCount || 2);
                                                const isDisabled = isSaving || presetLimit < minAllowed;
                                                return (
                                                    <button
                                                        key={presetLimit}
                                                        type="button"
                                                        className={`group-edit-limit-chip ${maxMembersDraft === presetLimit ? 'is-active' : ''}`}
                                                        disabled={isDisabled}
                                                        onClick={() => setMaxMembersDraft(presetLimit)}
                                                    >
                                                        {presetLimit} 人
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <input
                                            id="edit-group-max-members"
                                            type="range"
                                            min={Math.max(2, group.memberCount || 2)}
                                            max={1000}
                                            step={1}
                                            value={Math.max(maxMembersDraft, Math.max(2, group.memberCount || 2))}
                                            onChange={(e) => setMaxMembersDraft(Number(e.target.value))}
                                            className="group-detail-range"
                                            disabled={isSaving}
                                        />
                                        <div className="group-detail-range-scale" aria-hidden="true">
                                            <span>{Math.max(2, group.memberCount || 2)} 人</span>
                                            <span>1000 人</span>
                                        </div>
                                    </div>
                                    <div className="group-detail-edit-actions">
                                        <button
                                            type="button"
                                            className="group-edit-btn primary"
                                            onClick={handleSaveGroup}
                                            disabled={isSaving || !nameDraft.trim()}
                                        >
                                            {savingStage === 'uploading'
                                                ? '上传头像中...'
                                                : savingStage === 'saving'
                                                  ? '保存中...'
                                                  : '保存更改'}
                                        </button>
                                        <button
                                            type="button"
                                            className="group-edit-btn ghost"
                                            onClick={() => {
                                                setIsEditing(false);
                                                resetDrafts();
                                            }}
                                            disabled={isSaving}
                                        >
                                            取消
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <h3 className="group-detail-name">{group.name}</h3>
                                    {group.description ? (
                                        <p className="group-detail-description">{group.description}</p>
                                    ) : (
                                        <p className="group-detail-description is-empty">暂无群组简介</p>
                                    )}
                                    <div className="group-detail-meta">
                                        <span className="group-detail-pill">
                                            {group.type === 'public' ? <Globe size={12} /> : <Lock size={12} />}
                                            {group.type === 'public' ? '公开群组' : '私有群组'}
                                        </span>
                                        <span className="group-detail-pill">
                                            {group.memberCount} / {group.maxMembers} 成员
                                        </span>
                                        {onlineCount > 0 && (
                                            <span className="group-detail-pill is-online">
                                                <span className="group-pill-dot" />
                                                {onlineCount} 在线
                                            </span>
                                        )}
                                    </div>
                                </>
                            )}
                        </section>

                        {/* 2. 快捷操作条（Telegram 风格宫格操作） */}
                        <section className="group-quick-grid" aria-label="快捷操作">
                            <button
                                type="button"
                                className={`group-quick-tile ${isMuted ? 'is-active' : ''}`}
                                onClick={handleToggleMute}
                            >
                                {isMuted ? <BellOff size={18} /> : <Bell size={18} />}
                                <span>{isMuted ? '已静音' : '消息通知'}</span>
                            </button>
                            {canManage && (
                                <button
                                    type="button"
                                    className={`group-quick-tile ${inviteOpen ? 'is-active' : ''}`}
                                    onClick={() => setInviteOpen((v) => !v)}
                                >
                                    <UserPlus size={18} />
                                    <span>邀请成员</span>
                                </button>
                            )}
                            <button
                                type="button"
                                className="group-quick-tile"
                                onClick={handleCopyGroupId}
                            >
                                <Copy size={18} />
                                <span>复制群 ID</span>
                            </button>
                        </section>

                        {/* 2.5 内联邀请联系人面板 */}
                        {canManage && inviteOpen && (
                            <section className="group-inset-card group-invite-card" aria-label="邀请联系人">
                                <div className="group-card-head">
                                    <h4>邀请联系人入群</h4>
                                    <button
                                        type="button"
                                        className="group-icon-close"
                                        onClick={() => {
                                            setInviteOpen(false);
                                            setSelectedInviteIds([]);
                                        }}
                                        aria-label="收起邀请面板"
                                    >
                                        <X size={15} />
                                    </button>
                                </div>
                                {invitableContacts.length === 0 ? (
                                    <p className="group-invite-empty">所有好友均已在本群中</p>
                                ) : (
                                    <>
                                        <div className="group-invite-list">
                                            {invitableContacts.map((contact) => {
                                                const checked = selectedInviteIds.includes(contact.userId);
                                                return (
                                                    <button
                                                        key={contact.userId}
                                                        type="button"
                                                        className={`group-invite-item ${checked ? 'is-selected' : ''}`}
                                                        onClick={() => toggleInviteCandidate(contact.userId)}
                                                    >
                                                        <Avatar name={contact.username} src={contact.avatarUrl} size="sm" />
                                                        <span className="group-invite-name">{contact.username}</span>
                                                        <span className={`group-invite-check ${checked ? 'is-selected' : ''}`}>
                                                            {checked && <Check size={12} strokeWidth={3} />}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <button
                                            type="button"
                                            className="group-edit-btn primary"
                                            disabled={selectedInviteIds.length === 0 || inviting}
                                            onClick={handleInviteMembers}
                                        >
                                            {inviting
                                                ? '邀请中...'
                                                : `确认邀请 (${selectedInviteIds.length})`}
                                        </button>
                                    </>
                                )}
                            </section>
                        )}

                        {/* 3. 群组权限与设置分组 */}
                        <section className="group-inset-card group-settings-card" aria-label="群组权限与配置">
                            <div className="group-settings-row">
                                <div className="group-settings-label">
                                    <span className="group-settings-title">群组类型</span>
                                    <span className="group-settings-sub">
                                        {group.type === 'public' ? '公开可搜索加入' : '仅通过邀请加入'}
                                    </span>
                                </div>
                                {canManage ? (
                                    <div className="group-segmented is-compact" role="group" aria-label="切换群组类型">
                                        <button
                                            type="button"
                                            className={`group-segmented-btn ${group.type === 'public' ? 'is-active' : ''}`}
                                            disabled={isSaving}
                                            onClick={() => handleQuickTypeSwitch('public')}
                                        >
                                            公开
                                        </button>
                                        <button
                                            type="button"
                                            className={`group-segmented-btn ${group.type === 'private' ? 'is-active' : ''}`}
                                            disabled={isSaving}
                                            onClick={() => handleQuickTypeSwitch('private')}
                                        >
                                            私有
                                        </button>
                                    </div>
                                ) : (
                                    <span className="group-settings-value">
                                        {group.type === 'public' ? '公开群组' : '私有群组'}
                                    </span>
                                )}
                            </div>
                            <div className="group-settings-divider" />
                            <div className="group-settings-row">
                                <div className="group-settings-label">
                                    <span className="group-settings-title">我的身份权限</span>
                                    <span className="group-settings-sub">
                                        {currentRole === 'owner'
                                            ? '全部管理权限 · 可任命管理员、转让或解散'
                                            : currentRole === 'admin'
                                                ? '可编辑群资料、邀请、禁言与移出普通成员'
                                                : '可查看成员、发送消息与开启免打扰'}
                                    </span>
                                </div>
                                <span className={`group-member-role role-${currentRole}`}>{roleLabel}</span>
                            </div>
                        </section>

                        {/* 转让群主二次确认条 */}
                        {pendingTransferMember && (
                            <section className="group-inset-card group-confirm-card" role="alert">
                                <p className="group-confirm-text">
                                    确定将群主身份转让给 <strong>{pendingTransferMember.username}</strong> 吗？转让后您将成为管理员。
                                </p>
                                <div className="group-confirm-actions">
                                    <button
                                        type="button"
                                        className="group-edit-btn danger"
                                        disabled={busyMemberId === pendingTransferMember.userId}
                                        onClick={() => handleMemberAction('transfer', pendingTransferMember)}
                                    >
                                        {busyMemberId === pendingTransferMember.userId ? '转让中...' : '确认转让'}
                                    </button>
                                    <button
                                        type="button"
                                        className="group-edit-btn ghost"
                                        onClick={() => setPendingTransferMember(null)}
                                    >
                                        取消
                                    </button>
                                </div>
                            </section>
                        )}

                        {/* 4. 成员搜索与管理白卡 */}
                        <section className="group-inset-card group-detail-members" aria-label="成员管理">
                            <div className="group-members-header">
                                <h4 className="group-members-title">
                                    成员 ({group.members?.length || 0})
                                </h4>
                                <div className="group-member-filters" role="group" aria-label="成员筛选">
                                    <button
                                        type="button"
                                        className={`group-filter-chip ${memberFilter === 'all' ? 'is-active' : ''}`}
                                        onClick={() => setMemberFilter('all')}
                                    >
                                        全部
                                    </button>
                                    <button
                                        type="button"
                                        className={`group-filter-chip ${memberFilter === 'staff' ? 'is-active' : ''}`}
                                        onClick={() => setMemberFilter('staff')}
                                    >
                                        管理
                                    </button>
                                    <button
                                        type="button"
                                        className={`group-filter-chip ${memberFilter === 'online' ? 'is-active' : ''}`}
                                        onClick={() => setMemberFilter('online')}
                                    >
                                        在线
                                    </button>
                                </div>
                            </div>

                            <div className="group-member-search-wrap">
                                <Search size={14} className="group-member-search-icon" />
                                <input
                                    type="search"
                                    className="group-member-search-input"
                                    value={memberSearch}
                                    onChange={(e) => setMemberSearch(e.target.value)}
                                    placeholder="搜索群成员..."
                                    aria-label="搜索群成员"
                                />
                            </div>

                            <div className="group-members-list">
                                {filteredMembers.length === 0 ? (
                                    <div className="group-members-empty">未找到匹配的成员</div>
                                ) : (
                                    filteredMembers.map((member: GroupMember) => {
                                        const isSelfMember = member.userId === currentUser?.id;
                                        const canModerateTarget =
                                            canManage &&
                                            !isSelfMember &&
                                            (currentRole === 'owner' || member.role === 'member');

                                        return (
                                            <div key={member.id} className="group-member-item">
                                                <Avatar name={member.username} src={member.avatarUrl} size="sm" />
                                                <div className="group-member-info">
                                                    <span className="group-member-name">
                                                        {member.username}
                                                        {isSelfMember && <em className="group-member-self">我</em>}
                                                    </span>
                                                    {getRoleBadge(member.role) && (
                                                        <span className={`group-member-role role-${member.role}`}>
                                                            {getRoleBadge(member.role)}
                                                        </span>
                                                    )}
                                                    {member.status === 'muted' && (
                                                        <span className="group-member-muted">已禁言</span>
                                                    )}
                                                </div>
                                                {member.isOnline && (
                                                    <span className="group-member-online" title="在线" />
                                                )}

                                                {canModerateTarget && (
                                                    <DropdownMenuPrimitive.Root>
                                                        <DropdownMenuPrimitive.Trigger asChild>
                                                            <button
                                                                type="button"
                                                                className="member-more-trigger"
                                                                aria-label={`管理成员 ${member.username}`}
                                                                disabled={busyMemberId === member.userId}
                                                            >
                                                                <MoreHorizontal size={16} />
                                                            </button>
                                                        </DropdownMenuPrimitive.Trigger>
                                                        <DropdownMenuPrimitive.Portal>
                                                            <DropdownMenuPrimitive.Content
                                                                className="group-dropdown-content"
                                                                align="end"
                                                                sideOffset={6}
                                                            >
                                                                {member.status === 'muted' ? (
                                                                    <DropdownMenuPrimitive.Item
                                                                        className="group-dropdown-item"
                                                                        onSelect={() => handleMemberAction('unmute', member)}
                                                                    >
                                                                        <Volume2 size={14} />
                                                                        <span>解除禁言</span>
                                                                    </DropdownMenuPrimitive.Item>
                                                                ) : (
                                                                    <DropdownMenuPrimitive.Item
                                                                        className="group-dropdown-item"
                                                                        onSelect={() => handleMemberAction('mute', member)}
                                                                    >
                                                                        <VolumeX size={14} />
                                                                        <span>禁言 24 小时</span>
                                                                    </DropdownMenuPrimitive.Item>
                                                                )}

                                                                {currentRole === 'owner' && member.role === 'member' && (
                                                                    <DropdownMenuPrimitive.Item
                                                                        className="group-dropdown-item"
                                                                        onSelect={() => handleMemberAction('promote', member)}
                                                                    >
                                                                        <Shield size={14} />
                                                                        <span>设为管理员</span>
                                                                    </DropdownMenuPrimitive.Item>
                                                                )}

                                                                {currentRole === 'owner' && member.role === 'admin' && (
                                                                    <DropdownMenuPrimitive.Item
                                                                        className="group-dropdown-item"
                                                                        onSelect={() => handleMemberAction('demote', member)}
                                                                    >
                                                                        <ShieldOff size={14} />
                                                                        <span>取消管理员</span>
                                                                    </DropdownMenuPrimitive.Item>
                                                                )}

                                                                {currentRole === 'owner' && member.role !== 'owner' && (
                                                                    <DropdownMenuPrimitive.Item
                                                                        className="group-dropdown-item"
                                                                        onSelect={() => setPendingTransferMember(member)}
                                                                    >
                                                                        <Crown size={14} />
                                                                        <span>转让群主</span>
                                                                    </DropdownMenuPrimitive.Item>
                                                                )}

                                                                <DropdownMenuPrimitive.Separator className="group-dropdown-separator" />

                                                                <DropdownMenuPrimitive.Item
                                                                    className="group-dropdown-item is-danger"
                                                                    onSelect={() => handleMemberAction('kick', member)}
                                                                >
                                                                    <UserMinus size={14} />
                                                                    <span>移出群组</span>
                                                                </DropdownMenuPrimitive.Item>
                                                            </DropdownMenuPrimitive.Content>
                                                        </DropdownMenuPrimitive.Portal>
                                                    </DropdownMenuPrimitive.Root>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </section>

                        {/* 5. 危险操作区（内联二次确认） */}
                        <section className="group-inset-card group-detail-actions">
                            {confirmLeaveOpen ? (
                                <div className="group-confirm-inline">
                                    <p className="group-confirm-text">
                                        {isOwner
                                            ? '确定要解散该群组吗？所有聊天记录与成员关系将被清除。'
                                            : '确定要退出该群组吗？退出后将不再接收群消息。'}
                                    </p>
                                    <div className="group-confirm-actions">
                                        <button
                                            type="button"
                                            className="group-edit-btn danger"
                                            disabled={leaving}
                                            onClick={handleLeaveOrDeleteGroup}
                                        >
                                            {leaving ? '处理中...' : isOwner ? '确认解散' : '确认退出'}
                                        </button>
                                        <button
                                            type="button"
                                            className="group-edit-btn ghost"
                                            disabled={leaving}
                                            onClick={() => setConfirmLeaveOpen(false)}
                                        >
                                            取消
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    className="group-action-btn danger"
                                    onClick={() => setConfirmLeaveOpen(true)}
                                >
                                    {isOwner ? '解散群组' : '退出群组'}
                                </button>
                            )}
                        </section>
                    </div>
                </motion.aside>
            )}
        </AnimatePresence>
    );
};

export default GroupDetailPanel;
