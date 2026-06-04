import React, { useState, useEffect } from 'react';
import { useChatStore } from '../store/chatStore';
import { Avatar } from '../../../components/common';
import {
    createTimeline,
    limitedMotionItems,
    motionDurations,
    motionStaggers,
    stagger,
    useAnimeScope,
    useMotionPresence,
    waapi,
} from '../../../core/animation';
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
    const filteredContacts = contacts.filter(contact =>
        contact.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (contact.alias && contact.alias.toLowerCase().includes(searchQuery.toLowerCase()))
    );
    const { isPresent, isExiting, finishExit } = useMotionPresence(isOpen, motionDurations.normal);
    const groupModalMotion = useAnimeScope<HTMLDivElement, {
        enter: () => void;
        exit: () => void;
        step: () => void;
        revealContacts: () => void;
        select: () => void;
    }>(
        ({ root, reducedMotion, duration, runHeavy }) => ({
            enter: () => {
                if (reducedMotion || !root) return;
                const modal = root.querySelector('.create-group-modal');
                if (!modal) return;
                runHeavy(motionDurations.normal, () => {
                    createTimeline()
                        .sync(
                            waapi.animate(root, {
                                opacity: [0, 1],
                                duration: duration(motionDurations.fast),
                            }),
                            0,
                        )
                        .sync(
                            waapi.animate(modal, {
                                opacity: [0, 1],
                                y: ['14px', '0px'],
                                scale: [0.98, 1],
                                duration: duration(motionDurations.normal),
                                ease: 'out(4)',
                            }),
                            0,
                        );
                });
            },
            exit: () => {
                if (reducedMotion || !root) {
                    finishExit();
                    return;
                }
                const modal = root.querySelector('.create-group-modal');
                if (!modal) {
                    finishExit();
                    return;
                }
                runHeavy(motionDurations.normal, () => {
                    createTimeline({ onComplete: finishExit })
                        .sync(
                            waapi.animate(modal, {
                                opacity: [1, 0],
                                y: ['0px', '12px'],
                                scale: [1, 0.98],
                                duration: duration(motionDurations.normal),
                                ease: 'out(3)',
                            }),
                            0,
                        )
                        .sync(
                            waapi.animate(root, {
                                opacity: [1, 0],
                                duration: duration(motionDurations.fast),
                            }),
                            60,
                        );
                });
            },
            step: () => {
                if (reducedMotion || !root) return;
                const body = root.querySelector('.modal-body');
                if (!body) return;
                waapi.animate(body, {
                    opacity: [0, 1],
                    x: ['8px', '0px'],
                    duration: duration(motionDurations.fast),
                    ease: 'out(4)',
                });
            },
            revealContacts: () => {
                if (reducedMotion || !root) return;
                const items = limitedMotionItems(root.querySelectorAll('.contact-list-select .contact-item'));
                if (items.length === 0) return;
                waapi.animate(items, {
                    opacity: [0, 1],
                    y: ['6px', '0px'],
                    duration: duration(motionDurations.fast),
                    delay: stagger(motionStaggers.tight),
                    ease: 'out(4)',
                });
            },
            select: () => {
                if (reducedMotion || !root) return;
                const selected = root.querySelector('.contact-item.selected .selection-badge');
                if (!selected) return;
                waapi.animate(selected, {
                    scale: [0.72, 1.08, 1],
                    duration: duration(motionDurations.normal),
                    ease: 'out(4)',
                });
            },
        }),
        [finishExit, step, filteredContacts.length, selectedContactIds.length],
    );

    useEffect(() => {
        if (isOpen) {
            loadContacts();
            setStep(1);
            setGroupName('');
            setSelectedContactIds([]);
            setSearchQuery('');
        }
    }, [isOpen, loadContacts]);

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

    useEffect(() => {
        if (isOpen && isPresent) {
            groupModalMotion.run('enter');
        } else if (isExiting) {
            groupModalMotion.run('exit');
        }
    }, [groupModalMotion, isExiting, isOpen, isPresent]);

    useEffect(() => {
        if (isOpen) {
            groupModalMotion.run('step');
            groupModalMotion.run('revealContacts');
        }
    }, [groupModalMotion, isOpen, step]);

    useEffect(() => {
        if (isOpen) {
            groupModalMotion.run('select');
        }
    }, [groupModalMotion, isOpen, selectedContactIds.length]);

    if (!isPresent) return null;

    return (
        <div ref={groupModalMotion.rootRef} className="modal-overlay" onClick={onClose}>
            <div className="modal-content create-group-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <button
                        type="button"
                        className="modal-close"
                        onClick={step === 1 ? onClose : () => setStep(1)}
                        aria-label={step === 1 ? '关闭新建群组弹窗' : '返回上一步'}
                    >
                        {step === 1 ? '取消' : '返回'}
                    </button>
                    <h2>{step === 1 ? '新建群组' : '群组信息'}</h2>
                    <button
                        type="button"
                        className="modal-next"
                        disabled={step === 1 && selectedContactIds.length === 0}
                        onClick={() => {
                            if (step === 1) setStep(2);
                            else handleCreate();
                        }}
                        aria-label={step === 1 ? '进入群组信息配置' : '创建群组'}
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
                                    id="create-group-search"
                                    name="create-group-search"
                                    placeholder="搜索联系人..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    aria-label="搜索联系人"
                                />
                            </div>
                            <div className="contact-list-select">
                                {filteredContacts.map(contact => (
                                    <button
                                        type="button"
                                        key={contact.id}
                                        className={`contact-item ${selectedContactIds.includes(contact.userId) ? 'selected' : ''}`}
                                        onClick={() => toggleContact(contact.userId)}
                                        aria-label={`${selectedContactIds.includes(contact.userId) ? '取消选择' : '选择'}联系人 ${contact.alias || contact.username}`}
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
                                    </button>
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
                                id="create-group-name"
                                name="create-group-name"
                                className="group-name-input"
                                placeholder="群组名称"
                                value={groupName}
                                onChange={e => setGroupName(e.target.value)}
                                autoFocus
                                aria-label="群组名称"
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
