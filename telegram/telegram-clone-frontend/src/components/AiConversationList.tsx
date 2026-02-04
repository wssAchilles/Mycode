/**
 * AI 会话列表组件
 * 显示所有历史 AI 对话，支持选择、删除和新建
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAiChatStore } from '../features/chat/store/aiChatStore';
import './AiConversationList.css';

interface AiConversationListProps {
    onSelectConversation?: (conversationId: string) => void;
    onNewConversation?: () => void;
}

const AiConversationList: React.FC<AiConversationListProps> = ({
    onSelectConversation,
    onNewConversation
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

    // 初始加载
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

    const handleDelete = async (e: React.MouseEvent, conversationId: string) => {
        e.stopPropagation();
        if (confirm('确定要删除这个会话吗？')) {
            await deleteConversation(conversationId);
        }
    };

    // 格式化时间
    const formatTime = (timestamp: string) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) {
            return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        } else if (days === 1) {
            return '昨天';
        } else if (days < 7) {
            return `${days} 天前`;
        } else {
            return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        }
    };

    return (
        <div className="ai-conversation-list">
            <div className="ai-conversation-list__header">
                <h3>AI 对话历史</h3>
                <button
                    className="ai-conversation-list__new-btn"
                    onClick={handleNew}
                    title="新建对话"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                </button>
            </div>

            <div className="ai-conversation-list__content">
                {isLoadingConversations ? (
                    <div className="ai-conversation-list__loading">
                        <div className="ai-conversation-list__spinner"></div>
                        <span>加载中...</span>
                    </div>
                ) : conversations.length === 0 ? (
                    <div className="ai-conversation-list__empty">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <p>暂无对话历史</p>
                        <button onClick={handleNew} className="ai-conversation-list__start-btn">
                            开始新对话
                        </button>
                    </div>
                ) : (
                    <AnimatePresence>
                        {conversations.map((conv) => (
                            <motion.div
                                key={conv.conversationId}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{ duration: 0.2 }}
                                className={`ai-conversation-item ${activeConversationId === conv.conversationId ? 'ai-conversation-item--active' : ''}`}
                                onClick={() => handleSelect(conv.conversationId)}
                            >
                                <div className="ai-conversation-item__icon">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                    </svg>
                                </div>
                                <div className="ai-conversation-item__content">
                                    <div className="ai-conversation-item__title">{conv.title}</div>
                                    <div className="ai-conversation-item__meta">
                                        <span className="ai-conversation-item__count">
                                            {conv.messages?.length || 0} 条消息
                                        </span>
                                        <span className="ai-conversation-item__time">
                                            {formatTime(conv.updatedAt)}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    className="ai-conversation-item__delete"
                                    onClick={(e) => handleDelete(e, conv.conversationId)}
                                    title="删除会话"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="3 6 5 6 21 6"></polyline>
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                    </svg>
                                </button>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                )}
            </div>
        </div>
    );
};

export default AiConversationList;
