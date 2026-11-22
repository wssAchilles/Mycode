import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Globe, Lock, Search, Users, X } from 'lucide-react';
import { useChatStore } from '../store/chatStore';
import { Avatar } from '../../../components/common';
import { showToast } from '../../../components/ui/Toast';
import { groupAPI } from '../../../services/apiClient';
import { motionDurations, useAnimeScope, waapi } from '../../../core/animation';
import {
    GROUP_DESCRIPTION_TEMPLATES,
    GROUP_MEMBER_LIMIT_PRESETS,
    GroupAvatarPicker,
    resolveGroupAvatarUrlForSubmit,
    type GroupAvatarSelection,
} from './group';
import './CreateGroupModal.css';

interface CreateGroupModalProps {
    isOpen: boolean;
    onClose: () => void;
    onGroupCreated: () => void;
}

const DEFAULT_MAX_MEMBERS = 200;

const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
    isOpen,
    onClose,
    onGroupCreated,
}) => {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const pointerDownOutsideRef = useRef(false);

    const [step, setStep] = useState<1 | 2>(1);
    const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
    const [searchQuery, setSearchQuery] = useState('');

    // Step 2：完整群组配置表单状态
    const [avatarSelection, setAvatarSelection] = useState<GroupAvatarSelection>({
        mode: 'existing',
        url: null,
    });
    const [groupName, setGroupName] = useState('');
    const [description, setDescription] = useState('');
    const [groupType, setGroupType] = useState<'public' | 'private'>('private');
    const [maxMembers, setMaxMembers] = useState<number>(DEFAULT_MAX_MEMBERS);
    const [submitStage, setSubmitStage] = useState<'idle' | 'uploading' | 'creating'>('idle');
    const [formError, setFormError] = useState<string | null>(null);

    const isCreating = submitStage !== 'idle';

    const contacts = useChatStore((state) => state.contacts);
    const loadContacts = useChatStore((state) => state.loadContacts);
    const createGroup = useChatStore((state) => state.createGroup);

    const filteredContacts = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return contacts;
        return contacts.filter(
            (contact) =>
                contact.username.toLowerCase().includes(q) ||
                (contact.alias && contact.alias.toLowerCase().includes(q)),
        );
    }, [contacts, searchQuery]);

    const selectedContacts = useMemo(() => {
        const selectedSet = new Set(selectedContactIds);
        return contacts.filter((c) => selectedSet.has(c.userId));
    }, [contacts, selectedContactIds]);

    const groupModalMotion = useAnimeScope<
        HTMLDivElement,
        {
            enter: () => void;
            step: () => void;
        }
    >(
        ({ root, reducedMotion, duration }) => ({
            enter: () => {
                if (reducedMotion || !root) return;
                waapi.animate(root, {
                    opacity: [0, 1],
                    y: ['10px', '0px'],
                    scale: [0.985, 1],
                    duration: duration(motionDurations.normal),
                    ease: 'out(4)',
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
        }),
        [],
    );

    const resetForm = useCallback(() => {
        setStep(1);
        setSelectedContactIds([]);
        setSearchQuery('');
        setAvatarSelection({ mode: 'existing', url: null });
        setGroupName('');
        setDescription('');
        setGroupType('private');
        setMaxMembers(DEFAULT_MAX_MEMBERS);
        setSubmitStage('idle');
        setFormError(null);
    }, []);

    // 通过原生 dialog.showModal() / dialog.close() 控制顶层模态打开与焦点归还
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        if (isOpen) {
            loadContacts();
            resetForm();
            if (!dialog.open) {
                dialog.showModal();
            }
            groupModalMotion.run('enter');
        } else if (dialog.open) {
            dialog.close();
        }
    }, [groupModalMotion, isOpen, loadContacts, resetForm]);

    useEffect(() => {
        if (isOpen) {
            groupModalMotion.run('step');
            if (step === 2) {
                // 切换至群组信息 step 时聚焦群组名称输入框
                const timer = window.setTimeout(() => {
                    nameInputRef.current?.focus();
                }, 40);
                return () => window.clearTimeout(timer);
            }
        }
        return undefined;
    }, [groupModalMotion, isOpen, step]);

    const handleRequestClose = useCallback(() => {
        if (isCreating) return;
        const dialog = dialogRef.current;
        if (dialog?.open) {
            dialog.close();
        }
        onClose();
    }, [isCreating, onClose]);

    const toggleContact = (contactId: string) => {
        setSelectedContactIds((prev) =>
            prev.includes(contactId) ? prev.filter((id) => id !== contactId) : [...prev, contactId],
        );
    };

    const handleCreate = async (event?: React.FormEvent) => {
        event?.preventDefault();
        if (isCreating) return;

        const trimmedName = groupName.trim();
        if (!trimmedName) {
            setFormError('请输入群组名称');
            nameInputRef.current?.focus();
            return;
        }

        setFormError(null);

        try {
            const needsAvatarUpload =
                avatarSelection.mode === 'file' || avatarSelection.mode === 'preset';
            setSubmitStage(needsAvatarUpload ? 'uploading' : 'creating');

            const resolvedAvatarUrl = await resolveGroupAvatarUrlForSubmit(
                avatarSelection,
                groupAPI.uploadGroupAvatar,
            );

            setSubmitStage('creating');
            await createGroup(trimmedName, description.trim(), selectedContactIds, {
                type: groupType,
                maxMembers,
                avatarUrl: resolvedAvatarUrl ?? undefined,
            });

            onGroupCreated();
            showToast('群组创建成功', 'success');
            handleRequestClose();
        } catch (error) {
            const message = error instanceof Error ? error.message : '创建群组失败，请重试';
            setFormError(message);
            showToast(message, 'error');
        } finally {
            setSubmitStage('idle');
        }
    };

    // 针对不支持 HTMLDialogElement.prototype.closedBy 的旧浏览器的背景点击兼容（含坐标防拖选误关）
    const isPointerOutsideDialog = (dialog: HTMLDialogElement, clientX: number, clientY: number) => {
        const rect = dialog.getBoundingClientRect();
        return (
            clientX < rect.left ||
            clientX > rect.right ||
            clientY < rect.top ||
            clientY > rect.bottom
        );
    };

    const handleDialogPointerDown = (event: React.PointerEvent<HTMLDialogElement>) => {
        const dialog = dialogRef.current;
        if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;
        pointerDownOutsideRef.current =
            event.target === dialog &&
            isPointerOutsideDialog(dialog, event.clientX, event.clientY);
    };

    const handleDialogPointerUp = (event: React.PointerEvent<HTMLDialogElement>) => {
        const dialog = dialogRef.current;
        const startedOutside = pointerDownOutsideRef.current;
        pointerDownOutsideRef.current = false;

        if (!dialog || 'closedBy' in HTMLDialogElement.prototype || !startedOutside) return;
        if (
            !isCreating &&
            event.target === dialog &&
            isPointerOutsideDialog(dialog, event.clientX, event.clientY)
        ) {
            handleRequestClose();
        }
    };

    const submitLabel =
        submitStage === 'uploading'
            ? '上传头像中...'
            : submitStage === 'creating'
              ? '创建中...'
              : '创建';

    return (
        <dialog
            ref={dialogRef}
            className={`create-group-dialog ${step === 2 ? 'is-step-info' : ''}`}
            aria-labelledby="create-group-title"
            {...({ closedby: 'any' } as Record<string, string>)}
            onCancel={(event) => {
                if (isCreating) {
                    event.preventDefault();
                }
            }}
            onClose={() => {
                if (isOpen) {
                    onClose();
                }
            }}
            onPointerDown={handleDialogPointerDown}
            onPointerUp={handleDialogPointerUp}
        >
            <div ref={groupModalMotion.rootRef} className="create-group-surface">
                <div className="modal-header">
                    <button
                        type="button"
                        className="modal-close"
                        disabled={isCreating}
                        onClick={
                            step === 1
                                ? handleRequestClose
                                : () => {
                                      setFormError(null);
                                      setStep(1);
                                  }
                        }
                        aria-label={step === 1 ? '关闭新建群组弹窗' : '返回上一步'}
                    >
                        {step === 1 ? '取消' : '返回'}
                    </button>

                    <div className="modal-header-title-wrap">
                        <h2 id="create-group-title">{step === 1 ? '新建群组' : '群组信息'}</h2>
                        <span className="modal-step-indicator">步骤 {step} / 2</span>
                    </div>

                    {step === 1 ? (
                        <button
                            type="button"
                            className="modal-next"
                            onClick={() => {
                                setFormError(null);
                                setStep(2);
                            }}
                            aria-label="进入群组信息配置"
                        >
                            {selectedContactIds.length > 0
                                ? `下一步 (${selectedContactIds.length})`
                                : '跳过'}
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="modal-next"
                            disabled={isCreating || !groupName.trim()}
                            onClick={() => handleCreate()}
                            aria-label="创建群组"
                        >
                            {submitLabel}
                        </button>
                    )}
                </div>

                <div className="modal-body">
                    {formError && (
                        <div className="group-modal-error-banner" role="alert">
                            <AlertCircle size={15} />
                            <span>{formError}</span>
                        </div>
                    )}

                    {step === 1 ? (
                        <div className="group-members-step">
                            <div className="search-bar">
                                <label className="sr-only" htmlFor="create-group-search">
                                    搜索联系人
                                </label>
                                <div className="search-input-shell">
                                    <Search size={15} className="search-input-icon" aria-hidden="true" />
                                    <input
                                        type="text"
                                        id="create-group-search"
                                        name="create-group-search"
                                        placeholder="搜索联系人姓名或备注..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        aria-label="搜索联系人"
                                    />
                                </div>
                            </div>

                            {selectedContacts.length > 0 && (
                                <div className="selected-contacts-strip" aria-label="已选初始成员">
                                    {selectedContacts.map((contact) => {
                                        const displayName = contact.alias || contact.username;
                                        return (
                                            <button
                                                key={contact.userId}
                                                type="button"
                                                className="selected-contact-chip"
                                                onClick={() => toggleContact(contact.userId)}
                                                aria-label={`移出成员 ${displayName}`}
                                            >
                                                <Avatar src={contact.avatarUrl} name={displayName} size="xs" />
                                                <span>{displayName}</span>
                                                <X size={12} />
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            <div className="contact-list-select">
                                {filteredContacts.length === 0 ? (
                                    <div className="group-contact-empty">
                                        {contacts.length === 0
                                            ? '暂无联系人，可直接点击右上角“跳过”创建群组'
                                            : '未找到匹配的联系人'}
                                    </div>
                                ) : (
                                    filteredContacts.map((contact) => {
                                        const displayName = contact.alias || contact.username;
                                        const isSelected = selectedContactIds.includes(contact.userId);
                                        return (
                                            <button
                                                type="button"
                                                key={contact.id}
                                                className={`contact-item ${isSelected ? 'selected' : ''}`}
                                                onClick={() => toggleContact(contact.userId)}
                                                aria-pressed={isSelected}
                                                aria-label={`${isSelected ? '取消选择' : '选择'}联系人 ${displayName}`}
                                            >
                                                <div className="contact-avatar-wrapper">
                                                    <Avatar src={contact.avatarUrl} name={displayName} size="md" />
                                                    {isSelected && (
                                                        <div className="selection-badge">
                                                            <Check size={11} strokeWidth={3} />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="contact-info">
                                                    <div className="contact-name">{displayName}</div>
                                                    <div className="contact-status">
                                                        {contact.isOnline ? '在线' : '离线'}
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    ) : (
                        <form className="group-info-step" onSubmit={handleCreate}>
                            {/* 区块 A：自选群头像 */}
                            <GroupAvatarPicker
                                inputId="create-group-avatar-input"
                                groupName={groupName.trim() || '新群组'}
                                selection={avatarSelection}
                                onChange={(next) => {
                                    setFormError(null);
                                    setAvatarSelection(next);
                                }}
                                onError={setFormError}
                                disabled={isCreating}
                            />

                            {/* 区块 B：基础档案（名称 + 简介） */}
                            <section className="group-bento-card" aria-label="基础信息">
                                <div className="group-form-field">
                                    <label className="group-field-label" htmlFor="create-group-name">
                                        <span>
                                            群组名称 <em className="group-field-required">*</em>
                                        </span>
                                        <span className="group-field-counter">{groupName.length}/100</span>
                                    </label>
                                    <input
                                        ref={nameInputRef}
                                        type="text"
                                        id="create-group-name"
                                        name="create-group-name"
                                        className="group-text-input"
                                        placeholder="例如：产品研发协作群"
                                        maxLength={100}
                                        value={groupName}
                                        onChange={(e) => {
                                            setFormError(null);
                                            setGroupName(e.target.value);
                                        }}
                                        disabled={isCreating}
                                        required
                                    />
                                </div>

                                <div className="group-form-field">
                                    <label className="group-field-label" htmlFor="create-group-desc">
                                        <span>
                                            群组简介 / 公告 <em className="group-field-optional">选填</em>
                                        </span>
                                        <span className="group-field-counter">{description.length}/500</span>
                                    </label>
                                    <textarea
                                        id="create-group-desc"
                                        name="create-group-desc"
                                        className="group-textarea-input"
                                        placeholder="介绍本群定位、群规或近期同步事项..."
                                        rows={3}
                                        maxLength={500}
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        disabled={isCreating}
                                    />
                                    <div className="group-template-row" aria-label="快速填入简介模板">
                                        {GROUP_DESCRIPTION_TEMPLATES.map((tpl) => (
                                            <button
                                                key={tpl.label}
                                                type="button"
                                                className="group-template-chip"
                                                disabled={isCreating}
                                                onClick={() => setDescription(tpl.content)}
                                            >
                                                + {tpl.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </section>

                            {/* 区块 C：可见性与规模设置 */}
                            <section className="group-bento-card" aria-label="权限与规模">
                                <div className="group-form-field">
                                    <span className="group-field-label" id="create-group-visibility-label">
                                        <span>群组可见性</span>
                                    </span>
                                    <div
                                        className="group-visibility-grid"
                                        role="radiogroup"
                                        aria-labelledby="create-group-visibility-label"
                                    >
                                        <button
                                            type="button"
                                            role="radio"
                                            aria-checked={groupType === 'private'}
                                            className={`group-visibility-card ${groupType === 'private' ? 'is-active' : ''}`}
                                            disabled={isCreating}
                                            onClick={() => setGroupType('private')}
                                        >
                                            <div className="group-visibility-head">
                                                <Lock size={15} />
                                                <span>私有群组</span>
                                            </div>
                                            <p>仅支持受邀成员加入，不对外公开检索</p>
                                        </button>

                                        <button
                                            type="button"
                                            role="radio"
                                            aria-checked={groupType === 'public'}
                                            className={`group-visibility-card ${groupType === 'public' ? 'is-active' : ''}`}
                                            disabled={isCreating}
                                            onClick={() => setGroupType('public')}
                                        >
                                            <div className="group-visibility-head">
                                                <Globe size={15} />
                                                <span>公开群组</span>
                                            </div>
                                            <p>允许通过群组搜索发现并查看公开简介</p>
                                        </button>
                                    </div>
                                </div>

                                <div className="group-form-field">
                                    <label className="group-field-label" htmlFor="create-group-max-members">
                                        <span>成员人数上限</span>
                                        <span className="group-limit-badge">{maxMembers} 人</span>
                                    </label>
                                    <div className="group-limit-presets" role="group" aria-label="人数上限预设档位">
                                        {GROUP_MEMBER_LIMIT_PRESETS.map((presetLimit) => (
                                            <button
                                                key={presetLimit}
                                                type="button"
                                                className={`group-limit-chip ${maxMembers === presetLimit ? 'is-active' : ''}`}
                                                disabled={isCreating}
                                                onClick={() => setMaxMembers(presetLimit)}
                                            >
                                                {presetLimit} 人
                                            </button>
                                        ))}
                                    </div>
                                    <input
                                        id="create-group-max-members"
                                        type="range"
                                        min={2}
                                        max={1000}
                                        step={1}
                                        value={maxMembers}
                                        onChange={(e) => setMaxMembers(Number(e.target.value))}
                                        className="group-range-input"
                                        disabled={isCreating}
                                    />
                                    <div className="group-range-scale" aria-hidden="true">
                                        <span>2 人</span>
                                        <span>1000 人</span>
                                    </div>
                                </div>
                            </section>

                            {/* 区块 D：初始成员摘要 */}
                            <section className="group-bento-card group-members-summary" aria-label="初始成员摘要">
                                <div className="group-summary-left">
                                    {selectedContacts.length > 0 ? (
                                        <div className="group-avatar-stack">
                                            {selectedContacts.slice(0, 4).map((member) => (
                                                <Avatar
                                                    key={member.userId}
                                                    src={member.avatarUrl}
                                                    name={member.alias || member.username}
                                                    size="xs"
                                                />
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="group-summary-icon">
                                            <Users size={15} />
                                        </span>
                                    )}
                                    <span className="group-summary-text">
                                        {selectedContacts.length > 0
                                            ? `已选 ${selectedContacts.length} 位联系人（含群主共 ${selectedContacts.length + 1} 人）`
                                            : '未选初始成员（建群后可随时在群设置中邀请）'}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    className="group-summary-adjust-btn"
                                    disabled={isCreating}
                                    onClick={() => setStep(1)}
                                >
                                    调整成员
                                </button>
                            </section>
                        </form>
                    )}
                </div>
            </div>
        </dialog>
    );
};

export default CreateGroupModal;
