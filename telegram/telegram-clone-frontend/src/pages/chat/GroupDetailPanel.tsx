/**
 * GroupDetailPanel - 群组详情面板
 * 显示群组信息、成员列表，支持退群和管理操作
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore, type Group, type GroupMember } from '../../features/chat/store/chatStore';
import { Avatar } from '../../components/common';
import { authUtils } from '../../services/apiClient';
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
    const currentUser = authUtils.getCurrentUser();
    const isOwner = currentUser?.id === group?.ownerId;

    const handleLeaveGroup = async () => {
        if (!group) return;

        const confirmMessage = isOwner
            ? '您是群主，退出后群组将解散。确定要解散群组吗？'
            : '确定要退出群组吗？';

        if (window.confirm(confirmMessage)) {
            try {
                await leaveGroup(group.id);
                onClose();
            } catch (error) {
                console.error('退出群组失败:', error);
            }
        }
    };

    const getRoleBadge = (role: string) => {
        switch (role) {
            case 'owner': return '群主';
            case 'admin': return '管理员';
            default: return null;
        }
    };

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
                        <h3 className="group-detail-name">{group.name}</h3>
                        {group.description && (
                            <p className="group-detail-description">{group.description}</p>
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
                            {group.members?.map((member: GroupMember) => (
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
                                    </div>
                                    {member.isOnline && (
                                        <span className="group-member-online" />
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
