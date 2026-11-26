/**
 * AI 会话列表组件
 * 显示所有历史 AI 对话，支持选择、删除和新建
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAiChatStore } from '../features/chat/store/aiChatStore';
import { formatChatListTimestamp } from '../utils/dateTime';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { showToast } from './ui/Toast';
import './AiConversationList.css';

interface AiConversationListProps {
    onSelectConversation?: (conversationId: string) => void;
    onNewConversation?: () => void;
    onCloseList?: () => void;
}

const AiConversationList: React.FC<AiConversationListProps> = ({
    onSelectConversation,
    onNewConversation,
    onCloseList
}) => {
    const {
        conversations,
        activeConversationId,
        isLoadingConversations,
        selectConversation,
        createNewConversation,
        deleteConversation,
        loadConversations
    } = useAiChatStore();

    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);

    // 初始加载历史会话列表
    React.useEffect(() => {
        loadConversations();
    }, [loadConversations]);

    const handleSelect = (conversationId: string) => {
        selectConversation(conversationId);
        onSelectConversation?.(conversationId);
    };

    const handleNew = () => {
        createNewConversation();
        onNewConversation?.();
    };

    const handleConfirmDelete = async () => {
        if (!pendingDeleteId || deleting) return;
        setDeleting(true);
        try {
            await deleteConversation(pendingDeleteId);
            setPendingDeleteId(null);
            showToast('会话已删除', 'info');
        } catch {
            showToast('删除会话失败，请稍后重试', 'error');
        } finally {
            setDeleting(false);
        }
    };

    // 格式化会话更新时间（本日时分、本周周几、非本周具体日期）
    const formatTime = (timestamp: string) => {
        return formatChatListTimestamp(timestamp);
    };

    return (
        <div className="ai-conversation-list">
            <div className="ai-conversation-list__header">
                <h3>AI 对话历史</h3>
                <div className="ai-conversation-list__header-actions">
                    {onCloseList && (
                        <button
                            type="button"
                            className="ai-conversation-list__back-btn"
                            onClick={onCloseList}
                            title="返回聊天"
                            aria-label="返回聊天"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <line x1="19" y1="12" x2="5" y2="12"></line>
                                <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                        </button>
                    )}
                    <button
                        type="button"
                        className="ai-conversation-list__new-btn"
                        onClick={handleNew}
                        title="新建对话"
                        aria-label="新建对话"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        <span>新建</span>
                    </button>
                </div>
            </div>

            <div className="ai-conversation-list__content">
                {isLoadingConversations ? (
                    <div className="ai-conversation-list__loading">
                        <div className="ai-conversation-list__spinner"></div>
                        <span>加载中...</span>
                    </div>
                ) : conversations.length === 0 ? (
                    <div className="ai-conversation-list__empty">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <p>暂无对话历史</p>
                        <button type="button" onClick={handleNew} className="ai-conversation-list__start-btn">
                            开始新对话
                        </button>
                    </div>
                ) : (
                    <ul className="ai-conversation-list__items" aria-label="AI 对话历史">
                        <AnimatePresence>
                            {conversations.map((conv) => (
                                <motion.li
                                    key={conv.conversationId}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    transition={{ duration: 0.2 }}
                                    className={`ai-conversation-item ${activeConversationId === conv.conversationId ? 'ai-conversation-item--active' : ''}`}
                                >
                                    <button
                                        type="button"
                                        className="ai-conversation-item__open"
                                        onClick={() => handleSelect(conv.conversationId)}
                                        aria-current={activeConversationId === conv.conversationId ? 'true' : undefined}
                                        aria-label={`打开会话 ${conv.title}`}
                                    >
                                        <span className="ai-conversation-item__icon" aria-hidden="true">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                            </svg>
                                        </span>
                                        <span className="ai-conversation-item__content">
                                            <span className="ai-conversation-item__title">{conv.title}</span>
                                            <span className="ai-conversation-item__meta">
                                                <span className="ai-conversation-item__count">
                                                    {conv.messages?.length || 0} 条消息
                                                </span>
                                                <span className="ai-conversation-item__time">
                                                    {formatTime(conv.updatedAt)}
                                                </span>
                                            </span>
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className="ai-conversation-item__delete"
                                        onClick={() => setPendingDeleteId(conv.conversationId)}
                                        title="删除会话"
                                        aria-label={`删除会话 ${conv.title}`}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                            <polyline points="3 6 5 6 21 6"></polyline>
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                        </svg>
                                    </button>
                                </motion.li>
                            ))}
                        </AnimatePresence>
                    </ul>
                )}
            </div>

            <ConfirmDialog
                open={Boolean(pendingDeleteId)}
                title="删除 AI 对话历史？"
                description="删除后将无法恢复该条历史对话记录。"
                confirmText="确认删除"
                variant="danger"
                loading={deleting}
                onConfirm={handleConfirmDelete}
                onCancel={() => setPendingDeleteId(null)}
            />
        </div>
    );
};

export default AiConversationList;
