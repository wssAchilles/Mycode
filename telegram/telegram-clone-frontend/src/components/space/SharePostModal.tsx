import React, { useMemo, useState } from 'react';
import { useChatStore } from '../../features/chat/store/chatStore';
import './SharePostModal.css';

interface SharePostModalProps {
    open: boolean;
    postId: string | null;
    onClose: () => void;
    onSend: (receiverId: string) => Promise<void>;
}

const SharePostModal: React.FC<SharePostModalProps> = ({ open, postId, onClose, onSend }) => {
    const [search, setSearch] = useState('');
    const [isSending, setIsSending] = useState(false);
    const contacts = useChatStore((state) => state.contacts);
    const isLoadingContacts = useChatStore((state) => state.isLoadingContacts);

    const filtered = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        const accepted = contacts.filter((c) => c.status === 'accepted');
        if (!keyword) return accepted;
        return accepted.filter((c) =>
            c.username.toLowerCase().includes(keyword)
            || (c.alias && c.alias.toLowerCase().includes(keyword))
        );
    }, [contacts, search]);

    if (!open) return null;

    return (
        <div className="share-modal__overlay" onClick={onClose} role="presentation">
            <div className="share-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                <div className="share-modal__header">
                    <div>
                        <h3>分享动态给好友</h3>
                        <p>选择联系人后将立即发送</p>
                    </div>
                    <button className="share-modal__close" onClick={onClose} aria-label="关闭">
                        ×
                    </button>
                </div>

                <div className="share-modal__search">
                    <input
                        id="share-contact-search"
                        name="shareContactSearch"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="搜索联系人"
                        aria-label="搜索联系人"
                        autoComplete="off"
                    />
                </div>

                <div className="share-modal__body">
                    {isLoadingContacts && (
                        <div className="share-modal__state">正在加载联系人...</div>
                    )}
                    {!isLoadingContacts && filtered.length === 0 && (
                        <div className="share-modal__state">暂无可分享的联系人</div>
                    )}

                    {!isLoadingContacts && filtered.length > 0 && (
                        <div className="share-modal__list">
                            {filtered.map((contact) => (
                                <button
                                    key={contact.userId}
                                    className="share-modal__item"
                                    onClick={async () => {
                                        if (!postId || isSending) return;
                                        setIsSending(true);
                                        try {
                                            await onSend(contact.userId);
                                        } finally {
                                            setIsSending(false);
                                        }
                                    }}
                                    disabled={isSending}
                                >
                                    <span className="share-modal__avatar">
                                        {contact.avatarUrl ? (
                                            <img src={contact.avatarUrl} alt={contact.username} />
                                        ) : (
                                            contact.username.charAt(0).toUpperCase()
                                        )}
                                    </span>
                                    <span className="share-modal__meta">
                                        <span className="share-modal__name">{contact.alias || contact.username}</span>
                                        <span className="share-modal__sub">@{contact.username}</span>
                                    </span>
                                    <span className="share-modal__action">{isSending ? '发送中' : '发送'}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SharePostModal;
