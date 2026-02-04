import React, { useState, useEffect } from 'react';
import { useChatStore } from '../store/chatStore';
import { Avatar } from '../../../components/common';
import './CreateGroupModal.css';

interface CreateGroupModalProps {
    isOpen: boolean;
    onClose: () => void;
    onGroupCreated: () => void;
}

const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
    isOpen,
    onClose,
    onGroupCreated
}) => {
    const [step, setStep] = useState(1); // 1: Select Contacts, 2: Group Info
    const [groupName, setGroupName] = useState('');
    const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    const contacts = useChatStore((state) => state.contacts);
    const loadContacts = useChatStore((state) => state.loadContacts);
    const createGroup = useChatStore((state) => state.createGroup);

    useEffect(() => {
        if (isOpen) {
            loadContacts();
            setStep(1);
            setGroupName('');
            setSelectedContactIds([]);
            setSearchQuery('');
        }
    }, [isOpen, loadContacts]);

    const filteredContacts = contacts.filter(contact =>
        contact.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (contact.alias && contact.alias.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    const toggleContact = (contactId: string) => {
        setSelectedContactIds(prev =>
            prev.includes(contactId)
                ? prev.filter(id => id !== contactId)
                : [...prev, contactId]
        );
    };

    const handleCreate = async () => {
        if (!groupName.trim()) return;

        setIsCreating(true);
        try {
            await createGroup(groupName, 'Created via Web Client', selectedContactIds);
            onGroupCreated();
            onClose();
        } catch (error) {
            console.error('Failed to create group:', error);
            alert('创建群组失败，请重试');
        } finally {
            setIsCreating(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content create-group-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <button className="modal-close" onClick={step === 1 ? onClose : () => setStep(1)}>
                        {step === 1 ? '取消' : '返回'}
                    </button>
                    <h2>{step === 1 ? '新建群组' : '群组信息'}</h2>
                    <button
                        className="modal-next"
                        disabled={step === 1 && selectedContactIds.length === 0}
                        onClick={() => {
                            if (step === 1) setStep(2);
                            else handleCreate();
                        }}
                    >
                        {step === 1 ? '下一步' : (isCreating ? '创建中...' : '创建')}
                    </button>
                </div>

                <div className="modal-body">
                    {step === 1 ? (
                        <>
                            <div className="search-bar">
                                <input
                                    type="text"
                                    placeholder="搜索联系人..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                />
                            </div>
                            <div className="contact-list-select">
                                {filteredContacts.map(contact => (
                                    <div
                                        key={contact.id}
                                        className={`contact-item ${selectedContactIds.includes(contact.userId) ? 'selected' : ''}`}
                                        onClick={() => toggleContact(contact.userId)}
                                    >
                                        <div className="contact-avatar-wrapper">
                                            <Avatar src={contact.avatarUrl} name={contact.alias || contact.username} size="md" />
                                            {selectedContactIds.includes(contact.userId) && (
                                                <div className="selection-badge">✓</div>
                                            )}
                                        </div>
                                        <div className="contact-info">
                                            <div className="contact-name">{contact.alias || contact.username}</div>
                                            <div className="contact-status">{contact.isOnline ? '在线' : '离线'}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="group-info-step">
                            <div className="group-avatar-upload">
                                <div className="avatar-placeholder camera-icon">📷</div>
                            </div>
                            <input
                                type="text"
                                className="group-name-input"
                                placeholder="群组名称"
                                value={groupName}
                                onChange={e => setGroupName(e.target.value)}
                                autoFocus
                            />
                            <div className="member-count">
                                {selectedContactIds.length} 位成员
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CreateGroupModal;
