/**
 * GroupDetailPanel - 群组详情面板
 * 显示群组信息、成员列表，支持退群和管理操作
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore, type Group, type GroupMember } from '../../features/chat/store/chatStore';
import { Avatar } from '../../components/common';
import { authUtils, groupAPI } from '../../services/apiClient';
import './GroupDetailPanel.css';

interface GroupDetailPanelProps {
    isOpen: boolean;
    onClose: () => void;
    group: Group | null;
}

const panelVariants = {
    hidden: { x: '100%', opacity: 0 },
    visible: { x: 0, opacity: 1, transition: { type: 'spring' as const, damping: 25, stiffness: 300 } },
    exit: { x: '100%', opacity: 0, transition: { duration: 0.2 } }
};

const GroupDetailPanel: React.FC<GroupDetailPanelProps> = ({ isOpen, onClose, group }) => {
    const leaveGroup = useChatStore((s: { leaveGroup: (id: string) => Promise<void> }) => s.leaveGroup);
    const loadGroupDetails = useChatStore((s: { loadGroupDetails: (id: string) => Promise<void> }) => s.loadGroupDetails);
    const loadChats = useChatStore((s: { loadChats: () => Promise<void> }) => s.loadChats);
    const selectGroup = useChatStore((s: { selectGroup: (group: Group | null) => void }) => s.selectGroup);
    const currentUser = authUtils.getCurrentUser();
    const isOwner = currentUser?.id === group?.ownerId;
    const currentRole = group?.currentUserRole || (isOwner ? 'owner' : 'member');
    const canManage = currentRole === 'owner' || currentRole === 'admin';

    const [isEditing, setIsEditing] = useState(false);
    const [nameDraft, setNameDraft] = useState(group?.name || '');
    const [descDraft, setDescDraft] = useState(group?.description || '');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setNameDraft(group?.name || '');
        setDescDraft(group?.description || '');
        setIsEditing(false);
    }, [group?.id]);

    const resetDrafts = () => {
        setNameDraft(group?.name || '');
        setDescDraft(group?.description || '');
    };

    const handleLeaveGroup = async () => {
        if (!group) return;

        const confirmMessage = isOwner
            ? '您是群主，退出后群组将解散。确定要解散群组吗？'
            : '确定要退出群组吗？';

        if (window.confirm(confirmMessage)) {
            try {
                if (isOwner) {
                    await groupAPI.deleteGroup(group.id);
                    await loadChats();
                    selectGroup(null);
                } else {
                    await leaveGroup(group.id);
                }
                onClose();
            } catch (error) {
                console.error('退出群组失败:', error);
            }
        }
    };

    const handleSaveGroup = async () => {
        if (!group) return;
        setIsSaving(true);
        try {
            await groupAPI.updateGroup(group.id, {
                name: nameDraft.trim() || group.name,
                description: descDraft.trim()
            });
            await loadGroupDetails(group.id);
            await loadChats();
            setIsEditing(false);
        } catch (error) {
            console.error('更新群组失败:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleMemberAction = async (action: string, member: GroupMember) => {
        if (!group) return;
        try {
            if (action === 'mute') {
                await groupAPI.muteMember(group.id, member.userId, 24);
            } else if (action === 'unmute') {
                await groupAPI.unmuteMember(group.id, member.userId);
            } else if (action === 'kick') {
                await groupAPI.removeMember(group.id, member.userId);
            } else if (action === 'promote') {
                await groupAPI.promoteMember(group.id, member.userId);
            } else if (action === 'demote') {
                await groupAPI.demoteMember(group.id, member.userId);
            } else if (action === 'transfer') {
                const confirmTransfer = window.confirm(`确定将群主转让给 ${member.username} 吗？`);
                if (!confirmTransfer) return;
                await groupAPI.transferOwnership(group.id, member.userId);
            }
            await loadGroupDetails(group.id);
            await loadChats();
        } catch (error) {
            console.error('成员操作失败:', error);
        }
    };

    const getRoleBadge = (role: string) => {
        switch (role) {
            case 'owner': return '群主';
            case 'admin': return '管理员';
            default: return null;
        }
    };

    const sortedMembers = useMemo(() => {
        const members = group?.members || [];
        return members.slice().sort((a, b) => {
            const roleRank = (role?: string) => role === 'owner' ? 0 : role === 'admin' ? 1 : 2;
            return roleRank(a.role) - roleRank(b.role);
        });
    }, [group?.members]);

    if (!group) return null;

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="group-detail-panel"
                    variants={panelVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                >
                    {/* 头部 */}
                    <div className="group-detail-header">
                        <button className="group-detail-close" onClick={onClose}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                        <h2>群组信息</h2>
                    </div>

                    {/* 群组基本信息 */}
                    <div className="group-detail-info">
                        <div className="group-detail-avatar">
                            <Avatar
                                name={group.name}
                                src={group.avatarUrl}
                                size="lg"
                            />
                        </div>
                        {isEditing ? (
                            <div className="group-detail-edit">
                                <input
                                    className="group-detail-input"
                                    value={nameDraft}
                                    onChange={(e) => setNameDraft(e.target.value)}
                                    placeholder="群组名称"
                                />
                                <textarea
                                    className="group-detail-textarea"
                                    value={descDraft}
                                    onChange={(e) => setDescDraft(e.target.value)}
                                    placeholder="群组简介"
                                />
                                <div className="group-detail-edit-actions">
                                    <button
                                        className="group-edit-btn primary"
                                        onClick={handleSaveGroup}
                                        disabled={isSaving}
                                    >
                                        {isSaving ? '保存中...' : '保存'}
                                    </button>
                                    <button
                                        className="group-edit-btn ghost"
                                        onClick={() => {
                                            setIsEditing(false);
                                            resetDrafts();
                                        }}
                                    >
                                        取消
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <h3 className="group-detail-name">{group.name}</h3>
                                {group.description && (
                                    <p className="group-detail-description">{group.description}</p>
                                )}
                                {canManage && (
                                    <button
                                        className="group-edit-trigger"
                                        onClick={() => {
                                            setIsEditing(true);
                                            resetDrafts();
                                        }}
                                    >
                                        编辑群信息
                                    </button>
                                )}
                            </>
                        )}
                        <div className="group-detail-meta">
                            <span className="group-detail-type">
                                {group.type === 'public' ? '公开群组' : '私有群组'}
                            </span>
                            <span className="group-detail-count">
                                {group.memberCount} / {group.maxMembers} 成员
                            </span>
                        </div>
                    </div>

                    {/* 成员列表 */}
                    <div className="group-detail-members">
                        <h4 className="group-members-title">
                            成员 ({group.members?.length || 0})
                        </h4>
                        <div className="group-members-list">
                            {sortedMembers.map((member: GroupMember) => (
                                <div key={member.id} className="group-member-item">
                                    <Avatar
                                        name={member.username}
                                        src={member.avatarUrl}
                                        size="sm"
                                    />
                                    <div className="group-member-info">
                                        <span className="group-member-name">{member.username}</span>
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
                                        <span className="group-member-online" />
                                    )}

                                    {canManage && member.userId !== currentUser?.id && (
                                        <div className="group-member-actions">
                                            {(currentRole === 'owner' || (currentRole === 'admin' && member.role === 'member')) && (member.status === 'muted' ? (
                                                <button
                                                    className="member-action-btn"
                                                    onClick={() => handleMemberAction('unmute', member)}
                                                    aria-label="解除禁言"
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                                        <path d="M12 3v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                                                    </svg>
                                                </button>
                                            ) : (
                                                <button
                                                    className="member-action-btn"
                                                    onClick={() => handleMemberAction('mute', member)}
                                                    aria-label="禁言"
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                                        <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                                        <path d="M9 9v6l5 3V6l-2 1.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                                    </svg>
                                                </button>
                                            ))}

                                            {currentRole === 'owner' && member.role === 'member' && (
                                                <button
                                                    className="member-action-btn"
                                                    onClick={() => handleMemberAction('promote', member)}
                                                    aria-label="设为管理员"
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                                        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                                    </svg>
                                                </button>
                                            )}

                                            {currentRole === 'owner' && member.role === 'admin' && (
                                                <button
                                                    className="member-action-btn"
                                                    onClick={() => handleMemberAction('demote', member)}
                                                    aria-label="降级为成员"
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                                        <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                                    </svg>
                                                </button>
                                            )}

                                            {currentRole === 'owner' && member.role !== 'owner' && (
                                                <button
                                                    className="member-action-btn"
                                                    onClick={() => handleMemberAction('transfer', member)}
                                                    aria-label="转让群主"
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                                        <path d="M7 7h10v10H7z" stroke="currentColor" strokeWidth="2" />
                                                        <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                                    </svg>
                                                </button>
                                            )}

                                            {(currentRole === 'owner' || (currentRole === 'admin' && member.role === 'member')) && (
                                                <button
                                                    className="member-action-btn danger"
                                                    onClick={() => handleMemberAction('kick', member)}
                                                    aria-label="移出群组"
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                                        <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                                    </svg>
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="group-detail-actions">
                        <button
                            className="group-action-btn danger"
                            onClick={handleLeaveGroup}
                        >
                            {isOwner ? '解散群组' : '退出群组'}
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default GroupDetailPanel;
