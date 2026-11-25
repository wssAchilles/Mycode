/**
 * ChatDetailPanel - 联系人详情面板
 * 包含：用户信息、Space 主页跳转、备注管理、共享媒体预览与危险操作二次确认
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, Check, Edit2, ExternalLink, Image as ImageIcon, Trash2 } from 'lucide-react';
import { DetailPanel, DetailSection } from '../../components/layout';
import { Avatar } from '../../components/common';
import { showToast } from '../../components/ui/Toast';
import { contactAPI } from '../../services/apiClient';
import type { Message } from '../../types/chat';
import { withApiBase } from '../../utils/apiUrl';
import { formatLastSeen } from '../../utils/dateTime';
import './ChatDetailPanel.css';

interface SelectedContact {
    userId: string;
    username: string;
    alias?: string;
    avatarUrl?: string;
    isOnline?: boolean;
    lastSeen?: string;
}

interface ChatDetailPanelProps {
    isOpen: boolean;
    onClose: () => void;
    selectedContact: SelectedContact | null;
    sharedMediaMessages?: Message[];
    onPreviewImage?: (payload: { src: string; fileName?: string }) => void;
    onContactUpdated?: () => void;
    onContactRemoved?: (contactUserId: string) => void;
}

const ChatDetailPanel: React.FC<ChatDetailPanelProps> = ({
    isOpen,
    onClose,
    selectedContact,
    sharedMediaMessages = [],
    onPreviewImage,
    onContactUpdated,
    onContactRemoved,
}) => {
    const navigate = useNavigate();
    const [isEditingAlias, setIsEditingAlias] = useState(false);
    const [aliasInput, setAliasInput] = useState('');
    const [isSavingAlias, setIsSavingAlias] = useState(false);
    const [pendingAction, setPendingAction] = useState<'remove' | 'block' | null>(null);
    const [isMutatingContact, setIsMutatingContact] = useState(false);

    useEffect(() => {
        setIsEditingAlias(false);
        setAliasInput(selectedContact?.alias || '');
        setPendingAction(null);
    }, [selectedContact?.userId, selectedContact?.alias]);

    const { sharedImages, sharedFileCount } = useMemo(() => {
        const images: Array<{ id: string; src: string; thumb: string; fileName?: string }> = [];
        let files = 0;

        for (let i = sharedMediaMessages.length - 1; i >= 0; i -= 1) {
            const msg = sharedMediaMessages[i];
            const firstAtt = msg.attachments?.[0];
            const rawUrl = msg.fileUrl || firstAtt?.fileUrl;
            if (!rawUrl) continue;

            if (msg.type === 'image') {
                if (images.length < 9) {
                    const resolved = withApiBase(rawUrl) || rawUrl;
                    const resolvedThumb = withApiBase(msg.thumbnailUrl || firstAtt?.thumbnailUrl || rawUrl) || resolved;
                    images.push({
                        id: msg.id,
                        src: resolved,
                        thumb: resolvedThumb,
                        fileName: msg.fileName || firstAtt?.fileName,
                    });
                }
            } else if (
                msg.type === 'file'
                || msg.type === 'document'
                || msg.type === 'video'
                || msg.type === 'audio'
            ) {
                files += 1;
            }
        }
        return { sharedImages: images, sharedFileCount: files };
    }, [sharedMediaMessages]);

    const handleSaveAlias = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!selectedContact || isSavingAlias) return;
        const nextAlias = aliasInput.trim();
        setIsSavingAlias(true);
        try {
            await contactAPI.updateAlias(selectedContact.userId, nextAlias);
            showToast(nextAlias ? '联系人备注已更新' : '已清除备注名', 'info');
            setIsEditingAlias(false);
            onContactUpdated?.();
        } catch (error) {
            showToast(error instanceof Error ? error.message : '修改备注失败', 'error');
        } finally {
            setIsSavingAlias(false);
        }
    };

    const handleConfirmAction = async () => {
        if (!selectedContact || !pendingAction || isMutatingContact) return;
        setIsMutatingContact(true);
        try {
            if (pendingAction === 'block') {
                await contactAPI.blockContact(selectedContact.userId);
                showToast('已屏蔽该用户', 'info');
            } else {
                await contactAPI.removeContact(selectedContact.userId);
                showToast('已删除联系人', 'info');
            }
            const removedId = selectedContact.userId;
            setPendingAction(null);
            onClose();
            onContactRemoved?.(removedId);
            onContactUpdated?.();
        } catch (error) {
            showToast(
                error instanceof Error ? error.message : '操作失败，请稍后重试',
                'error',
            );
        } finally {
            setIsMutatingContact(false);
        }
    };

    const displayName = selectedContact?.alias || selectedContact?.username || '';
    const statusText = selectedContact?.isOnline
        ? '在线'
        : formatLastSeen(selectedContact?.lastSeen);

    return (
        <DetailPanel
            isOpen={isOpen}
            onClose={onClose}
            title="详细信息"
        >
            {selectedContact && (
                <>
                    <div className="detail-panel-user">
                        <Avatar
                            src={selectedContact.avatarUrl}
                            name={displayName}
                            online={selectedContact.isOnline}
                            size="lg"
                        />
                        <h2 className="detail-user-name">{displayName}</h2>
                        <p className="detail-user-handle">@{selectedContact.username}</p>
                        <div className={`detail-user-status ${selectedContact.isOnline ? 'is-online' : ''}`}>
                            {statusText}
                        </div>

                        <div className="detail-quick-actions">
                            <button
                                type="button"
                                className="detail-action-pill"
                                onClick={() => navigate(`/space/user/${selectedContact.userId}`)}
                            >
                                <ExternalLink size={14} />
                                <span>查看动态主页</span>
                            </button>
                            <button
                                type="button"
                                className="detail-action-pill"
                                onClick={() => {
                                    setAliasInput(selectedContact.alias || '');
                                    setIsEditingAlias((prev) => !prev);
                                }}
                            >
                                <Edit2 size={14} />
                                <span>修改备注</span>
                            </button>
                        </div>
                    </div>

                    {isEditingAlias && (
                        <DetailSection title="备注名设置">
                            <form className="detail-alias-form" onSubmit={(e) => void handleSaveAlias(e)}>
                                <div className="detail-alias-row">
                                    <input
                                        type="text"
                                        className="detail-alias-input"
                                        aria-label="联系人备注名"
                                        placeholder="输入备注名称（留空则清除）"
                                        maxLength={32}
                                        value={aliasInput}
                                        onChange={(e) => setAliasInput(e.target.value)}
                                        autoFocus
                                    />
                                    <button
                                        type="submit"
                                        className="detail-alias-btn"
                                        disabled={isSavingAlias}
                                        aria-label="保存备注名"
                                    >
                                        <Check size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        className="detail-alias-btn ghost"
                                        disabled={isSavingAlias}
                                        onClick={() => setIsEditingAlias(false)}
                                    >
                                        取消
                                    </button>
                                </div>
                            </form>
                        </DetailSection>
                    )}

                    <DetailSection title="共享媒体" collapsible defaultCollapsed={sharedImages.length === 0}>
                        {sharedImages.length > 0 ? (
                            <>
                                <div className="detail-media-grid">
                                    {sharedImages.map((img) => (
                                        <button
                                            key={img.id}
                                            type="button"
                                            className="detail-media-thumb"
                                            aria-label={`预览共享图片 ${img.fileName || ''}`.trim()}
                                            onClick={() =>
                                                onPreviewImage?.({ src: img.src, fileName: img.fileName })
                                            }
                                        >
                                            <img src={img.thumb} alt={img.fileName || '共享图片'} loading="lazy" />
                                        </button>
                                    ))}
                                </div>
                                {sharedFileCount > 0 && (
                                    <div className="detail-media-summary">
                                        另有 {sharedFileCount} 个文件/音视频记录在当前会话中
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="detail-empty-media">
                                <ImageIcon size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
                                {sharedFileCount > 0
                                    ? `暂无共享图片（当前会话含 ${sharedFileCount} 个文件/音视频）`
                                    : '暂无共享图片或媒体文件'}
                            </div>
                        )}
                    </DetailSection>

                    <DetailSection title="关系管理" collapsible>
                        <div className="detail-settings-container">
                            <button
                                type="button"
                                className="detail-settings-action is-warning"
                                onClick={() => setPendingAction('block')}
                            >
                                <Ban size={15} />
                                <span>屏蔽用户</span>
                            </button>
                            <button
                                type="button"
                                className="detail-settings-action is-danger"
                                onClick={() => setPendingAction('remove')}
                            >
                                <Trash2 size={15} />
                                <span>删除联系人</span>
                            </button>

                            {pendingAction && (
                                <div className="detail-confirm-box" role="alertdialog" aria-label="联系人操作二次确认">
                                    <p className="detail-confirm-box__text">
                                        {pendingAction === 'block'
                                            ? `确认屏蔽「${displayName}」吗？屏蔽后将不再接收对方消息。`
                                            : `确认删除联系人「${displayName}」吗？删除后需重新发送好友申请。`}
                                    </p>
                                    <div className="detail-confirm-box__actions">
                                        <button
                                            type="button"
                                            className="detail-confirm-box__btn"
                                            disabled={isMutatingContact}
                                            onClick={() => setPendingAction(null)}
                                        >
                                            取消
                                        </button>
                                        <button
                                            type="button"
                                            className="detail-confirm-box__btn is-danger"
                                            disabled={isMutatingContact}
                                            onClick={() => void handleConfirmAction()}
                                        >
                                            {isMutatingContact
                                                ? '处理中...'
                                                : pendingAction === 'block'
                                                    ? '确认屏蔽'
                                                    : '确认删除'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </DetailSection>
                </>
            )}
        </DetailPanel>
    );
};

export default ChatDetailPanel;
