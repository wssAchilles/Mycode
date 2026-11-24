import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Check,
  Clock,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { contactAPI, getErrorMessage } from '../services/apiClient';
import { formatChatListTimestamp, useChatStore } from '../features/chat/store/chatStore';
import { withApiBase } from '../utils/apiUrl';
import { Avatar } from './common';
import { showToast } from './ui/Toast';
import { motionDurations, useAnimeScope, waapi } from '../core/animation';
import './AddContactModal.css';

export type AddContactModalTab = 'search' | 'requests' | 'sent';

interface SearchUserItem {
  id: string;
  username: string;
  email?: string;
  avatarUrl?: string;
  contactStatus?: 'accepted' | 'pending' | 'blocked' | 'rejected' | null;
}

interface SentRequestItem {
  id: string;
  contactId: string;
  username: string;
  avatarUrl?: string;
  addedAt?: string;
}

interface AddContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContactAdded: () => void;
  initialTab?: AddContactModalTab;
  onStartChatWithContact?: (userId: string) => void;
}

const SEARCH_DEBOUNCE_MS = 300;

export const AddContactModal: React.FC<AddContactModalProps> = ({
  isOpen,
  onClose,
  onContactAdded,
  initialTab = 'search',
  onStartChatWithContact,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pointerDownOutsideRef = useRef(false);
  const searchSeqRef = useRef(0);

  const [activeTab, setActiveTab] = useState<AddContactModalTab>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchUserItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingContactId, setAddingContactId] = useState<string | null>(null);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [sentRequests, setSentRequests] = useState<SentRequestItem[]>([]);
  const [isLoadingSent, setIsLoadingSent] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const contacts = useChatStore((state) => state.contacts);
  const pendingRequests = useChatStore((state) => state.pendingRequests);
  const isLoadingPendingRequests = useChatStore((state) => state.isLoadingPendingRequests);
  const loadPendingRequests = useChatStore((state) => state.loadPendingRequests);
  const handleContactRequest = useChatStore((state) => state.handleContactRequest);

  const modalMotion = useAnimeScope<HTMLDivElement, { enter: () => void }>(
    ({ root, reducedMotion, duration }) => ({
      enter: () => {
        if (reducedMotion || !root || typeof root.animate !== 'function') return;
        waapi.animate(root, {
          opacity: [0, 1],
          y: ['10px', '0px'],
          scale: [0.985, 1],
          duration: duration(motionDurations.normal),
          ease: 'out(4)',
        });
      },
    }),
    [],
  );

  const loadSentRequests = useCallback(async () => {
    setIsLoadingSent(true);
    try {
      const response = await contactAPI.getContacts('pending');
      const rawList = Array.isArray(response?.contacts) ? response.contacts : [];
      const mapped: SentRequestItem[] = rawList.map((item: any) => ({
        id: String(item.id || item.contactId),
        contactId: String(item.contactId || item.userId || ''),
        username: item.contact?.username || item.username || '未知用户',
        avatarUrl: withApiBase(item.contact?.avatarUrl || item.avatarUrl) ?? undefined,
        addedAt: item.addedAt,
      }));
      setSentRequests(mapped);
    } catch {
      // 静默兜底，避免打断当前查找与审批操作
    } finally {
      setIsLoadingSent(false);
    }
  }, []);

  const resetModalState = useCallback(() => {
    searchSeqRef.current += 1;
    setSearchQuery('');
    setSearchResults([]);
    setHasSearched(false);
    setIsSearching(false);
    setAddingContactId(null);
    setBusyRequestId(null);
    setFeedback(null);
  }, []);

  // 使用原生 dialog.showModal() / close() 控制模态生命周期（兼容 JSDOM 测试环境）
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      resetModalState();
      setActiveTab(initialTab);
      void loadPendingRequests();
      void loadSentRequests();

      if (typeof dialog.showModal === 'function') {
        if (!dialog.open) {
          dialog.showModal();
        }
      } else {
        dialog.setAttribute('open', '');
      }
      modalMotion.run('enter');

      if (initialTab === 'search') {
        const timer = window.setTimeout(() => {
          searchInputRef.current?.focus();
        }, 40);
        return () => window.clearTimeout(timer);
      }
    } else if (typeof dialog.close === 'function') {
      if (dialog.open) {
        dialog.close();
      }
    } else {
      dialog.removeAttribute('open');
    }
    return undefined;
  }, [initialTab, isOpen, loadPendingRequests, loadSentRequests, modalMotion, resetModalState]);

  const runSearch = useCallback(async (rawQuery: string) => {
    const trimmed = rawQuery.trim();
    if (!trimmed) {
      searchSeqRef.current += 1;
      setSearchResults([]);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }

    const requestSeq = searchSeqRef.current + 1;
    searchSeqRef.current = requestSeq;
    setIsSearching(true);
    setFeedback(null);

    try {
      const response = await contactAPI.searchUsers(trimmed);
      if (searchSeqRef.current !== requestSeq) return;
      const users = Array.isArray(response?.users) ? response.users : [];
      setSearchResults(
        users.map((u: SearchUserItem) => ({
          ...u,
          avatarUrl: withApiBase(u.avatarUrl) ?? undefined,
        })),
      );
      setHasSearched(true);
    } catch (error: unknown) {
      if (searchSeqRef.current !== requestSeq) return;
      setFeedback({
        text: `搜索失败: ${getErrorMessage(error, '搜索用户失败')}`,
        type: 'error',
      });
    } finally {
      if (searchSeqRef.current === requestSeq) {
        setIsSearching(false);
      }
    }
  }, []);

  // 输入停顿 300ms 自动检索，同时清零输入时立即收起结果
  useEffect(() => {
    if (!isOpen || activeTab !== 'search') return;
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      searchSeqRef.current += 1;
      setSearchResults([]);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }

    const timer = window.setTimeout(() => {
      void runSearch(trimmed);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [activeTab, isOpen, runSearch, searchQuery]);

  const acceptedContactIds = useMemo(
    () => new Set(contacts.map((c) => c.userId)),
    [contacts],
  );
  const sentUserIds = useMemo(
    () => new Set(sentRequests.map((item) => item.contactId)),
    [sentRequests],
  );
  const pendingRequestByUserId = useMemo(
    () => new Map(pendingRequests.map((req) => [req.userId, req])),
    [pendingRequests],
  );

  const handleRequestClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog) {
      if (typeof dialog.close === 'function') {
        if (dialog.open) dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    }
    onClose();
  }, [onClose]);

  const handleAddContact = async (user: SearchUserItem) => {
    if (addingContactId) return;
    setAddingContactId(user.id);
    setFeedback(null);

    try {
      await contactAPI.addContact(user.id);
      setSearchResults((prev) =>
        prev.map((item) =>
          item.id === user.id ? { ...item, contactStatus: 'pending' } : item,
        ),
      );
      setSentRequests((prev) => {
        if (prev.some((item) => item.contactId === user.id)) return prev;
        return [
          {
            id: `local-${user.id}`,
            contactId: user.id,
            username: user.username,
            avatarUrl: user.avatarUrl,
            addedAt: new Date().toISOString(),
          },
          ...prev,
        ];
      });
      setFeedback({
        text: `已向 ${user.username} 发送好友申请`,
        type: 'success',
      });
      showToast(`已向 ${user.username} 发送好友申请`, 'success');
      onContactAdded();
      void loadSentRequests();
    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error, '添加联系人失败');
      setFeedback({ text: `添加失败: ${errorMsg}`, type: 'error' });
      showToast(errorMsg, 'error');
    } finally {
      setAddingContactId(null);
    }
  };

  const handleProcessIncomingRequest = async (
    requestId: string,
    displayName: string,
    action: 'accept' | 'reject',
    userId?: string,
  ) => {
    if (busyRequestId) return;
    setBusyRequestId(requestId);
    setFeedback(null);

    try {
      await handleContactRequest(requestId, action);
      if (userId) {
        setSearchResults((prev) =>
          prev.map((item) =>
            item.id === userId
              ? { ...item, contactStatus: action === 'accept' ? 'accepted' : null }
              : item,
          ),
        );
      }
      const msg =
        action === 'accept'
          ? `已同意 ${displayName} 的好友申请`
          : `已拒绝 ${displayName} 的好友申请`;
      setFeedback({ text: msg, type: 'success' });
      showToast(msg, action === 'accept' ? 'success' : 'info');
      onContactAdded();
    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error, '处理好友申请失败');
      setFeedback({ text: errorMsg, type: 'error' });
      showToast(errorMsg, 'error');
    } finally {
      setBusyRequestId(null);
    }
  };

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
      event.target === dialog &&
      isPointerOutsideDialog(dialog, event.clientX, event.clientY)
    ) {
      handleRequestClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="add-contact-dialog"
      aria-labelledby="add-contact-dialog-title"
      {...({ closedby: 'any' } as Record<string, string>)}
      onClose={() => {
        if (isOpen) {
          onClose();
        }
      }}
      onPointerDown={handleDialogPointerDown}
      onPointerUp={handleDialogPointerUp}
    >
      <div ref={modalMotion.rootRef} className="add-contact-surface">
        {/* 顶部标题栏 */}
        <div className="add-contact-header">
          <div className="add-contact-title-group">
            <span className="add-contact-title-icon" aria-hidden="true">
              <UserPlus size={18} strokeWidth={2.2} />
            </span>
            <div>
              <h2 id="add-contact-dialog-title" className="add-contact-title">
                联系人与好友申请
              </h2>
              <p className="add-contact-subtitle">查找新朋友或处理收到的好友请求</p>
            </div>
          </div>

          <button
            type="button"
            className="add-contact-close"
            onClick={handleRequestClose}
            aria-label="关闭联系人弹窗"
          >
            <X size={18} />
          </button>
        </div>

        {/* 三段式标签页导航 */}
        <div className="add-contact-tabs" role="tablist" aria-label="联系人功能分类">
          <button
            type="button"
            role="tab"
            id="contact-tab-search"
            aria-selected={activeTab === 'search'}
            aria-controls="contact-panel-search"
            className={`add-contact-tab ${activeTab === 'search' ? 'is-active' : ''}`}
            onClick={() => {
              setFeedback(null);
              setActiveTab('search');
            }}
          >
            <Search size={14} aria-hidden="true" />
            <span>找人添加</span>
          </button>

          <button
            type="button"
            role="tab"
            id="contact-tab-requests"
            aria-selected={activeTab === 'requests'}
            aria-controls="contact-panel-requests"
            className={`add-contact-tab ${activeTab === 'requests' ? 'is-active' : ''}`}
            onClick={() => {
              setFeedback(null);
              setActiveTab('requests');
              void loadPendingRequests();
            }}
          >
            <Bell size={14} aria-hidden="true" />
            <span>好友申请</span>
            {pendingRequests.length > 0 && (
              <span className="add-contact-tab-badge">
                {pendingRequests.length > 99 ? '99+' : pendingRequests.length}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            id="contact-tab-sent"
            aria-selected={activeTab === 'sent'}
            aria-controls="contact-panel-sent"
            className={`add-contact-tab ${activeTab === 'sent' ? 'is-active' : ''}`}
            onClick={() => {
              setFeedback(null);
              setActiveTab('sent');
              void loadSentRequests();
            }}
          >
            <Send size={14} aria-hidden="true" />
            <span>已发出</span>
            {sentRequests.length > 0 && (
              <span className="add-contact-tab-muted-count">{sentRequests.length}</span>
            )}
          </button>
        </div>

        {/* 反馈消息横幅 */}
        {feedback && (
          <div className={`add-contact-banner add-contact-banner--${feedback.type}`} role="status">
            {feedback.type === 'success' ? <Check size={14} /> : <X size={14} />}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* 主体内容区 */}
        <div className="add-contact-body">
          {activeTab === 'search' && (
            <div
              id="contact-panel-search"
              role="tabpanel"
              aria-labelledby="contact-tab-search"
              className="add-contact-panel"
            >
              <form
                className="add-contact-search-bar"
                onSubmit={(e) => {
                  e.preventDefault();
                  void runSearch(searchQuery);
                }}
              >
                <div className="add-contact-input-shell">
                  <Search size={15} className="add-contact-input-icon" aria-hidden="true" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    id="add-contact-search"
                    name="add-contact-search"
                    className="add-contact-input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="输入用户名或邮箱查找..."
                    aria-label="输入用户名或邮箱搜索联系人"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="add-contact-input-clear"
                      onClick={() => setSearchQuery('')}
                      aria-label="清空搜索关键词"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  className="add-contact-search-submit"
                  disabled={isSearching || !searchQuery.trim()}
                >
                  {isSearching ? '搜索中' : '搜索'}
                </button>
              </form>

              {pendingRequests.length > 0 && (
                <button
                  type="button"
                  className="add-contact-pending-hint"
                  onClick={() => setActiveTab('requests')}
                >
                  <Bell size={14} aria-hidden="true" />
                  <span>你有 {pendingRequests.length} 条待处理好友申请，点击查看</span>
                </button>
              )}

              <div className="add-contact-list">
                {!searchQuery.trim() && (
                  <div className="add-contact-empty">
                    <div className="add-contact-empty-icon" aria-hidden="true">
                      <UserPlus size={28} strokeWidth={1.6} />
                    </div>
                    <p className="add-contact-empty-title">通过用户名或邮箱寻找好友</p>
                    <p className="add-contact-empty-desc">
                      支持实时检索匹配用户；若对方已向你发出申请，可直接在此一键同意
                    </p>
                  </div>
                )}

                {searchQuery.trim() && hasSearched && searchResults.length === 0 && !isSearching && (
                  <div className="add-contact-empty">
                    <div className="add-contact-empty-icon" aria-hidden="true">
                      <Search size={28} strokeWidth={1.6} />
                    </div>
                    <p className="add-contact-empty-title">未找到匹配的用户</p>
                    <p className="add-contact-empty-desc">请核对用户名或邮箱拼写后重试</p>
                  </div>
                )}

                {searchResults.map((user) => {
                  const incomingReq = pendingRequestByUserId.get(user.id);
                  const isAccepted =
                    user.contactStatus === 'accepted' || acceptedContactIds.has(user.id);
                  const isSentPending =
                    user.contactStatus === 'pending' || sentUserIds.has(user.id);
                  const isBlocked = user.contactStatus === 'blocked';
                  const secondaryLine = user.email?.trim()
                    ? user.email
                    : `ID · ${user.id.slice(0, 8)}`;

                  return (
                    <div key={user.id} className="add-contact-card">
                      <Avatar src={user.avatarUrl} name={user.username} size="md" priority="high" />
                      <div className="add-contact-card-info">
                        <div className="add-contact-card-name">{user.username}</div>
                        <div className="add-contact-card-meta">{secondaryLine}</div>
                      </div>

                      {incomingReq ? (
                        <button
                          type="button"
                          className="add-contact-btn add-contact-btn--accept"
                          disabled={!!busyRequestId}
                          onClick={() =>
                            void handleProcessIncomingRequest(
                              incomingReq.id,
                              user.username,
                              'accept',
                              user.id,
                            )
                          }
                        >
                          <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                          <span>{busyRequestId === incomingReq.id ? '处理中' : '同意申请'}</span>
                        </button>
                      ) : isAccepted ? (
                        onStartChatWithContact ? (
                          <button
                            type="button"
                            className="add-contact-btn add-contact-btn--chat"
                            onClick={() => onStartChatWithContact(user.id)}
                          >
                            <MessageSquare size={13} aria-hidden="true" />
                            <span>发消息</span>
                          </button>
                        ) : (
                          <span className="add-contact-status-pill">
                            <UserCheck size={13} aria-hidden="true" />
                            <span>已是好友</span>
                          </span>
                        )
                      ) : isSentPending ? (
                        <span className="add-contact-status-pill is-pending">
                          <Clock size={13} aria-hidden="true" />
                          <span>等待确认</span>
                        </span>
                      ) : isBlocked ? (
                        <span className="add-contact-status-pill is-blocked">已屏蔽</span>
                      ) : (
                        <button
                          type="button"
                          className="add-contact-btn add-contact-btn--primary"
                          disabled={addingContactId === user.id}
                          onClick={() => void handleAddContact(user)}
                          aria-label={`添加联系人 ${user.username}`}
                        >
                          <UserPlus size={14} aria-hidden="true" />
                          <span>{addingContactId === user.id ? '发送中...' : '添加好友'}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'requests' && (
            <div
              id="contact-panel-requests"
              role="tabpanel"
              aria-labelledby="contact-tab-requests"
              className="add-contact-panel"
            >
              <div className="add-contact-panel-toolbar">
                <span className="add-contact-panel-count">
                  共 {pendingRequests.length} 条待处理申请
                </span>
                <button
                  type="button"
                  className="add-contact-refresh-btn"
                  disabled={isLoadingPendingRequests}
                  onClick={() => void loadPendingRequests()}
                >
                  <RefreshCw
                    size={13}
                    className={isLoadingPendingRequests ? 'is-spinning' : ''}
                    aria-hidden="true"
                  />
                  <span>{isLoadingPendingRequests ? '刷新中' : '刷新'}</span>
                </button>
              </div>

              <div className="add-contact-list">
                {pendingRequests.length === 0 ? (
                  <div className="add-contact-empty">
                    <div className="add-contact-empty-icon" aria-hidden="true">
                      <Bell size={28} strokeWidth={1.6} />
                    </div>
                    <p className="add-contact-empty-title">暂无待处理的好友申请</p>
                    <p className="add-contact-empty-desc">
                      当其他用户向你发送好友请求时，会在这里实时出现
                    </p>
                  </div>
                ) : (
                  pendingRequests.map((req) => {
                    const displayName = req.alias || req.username;
                    const timeLabel = req.addedAt ? formatChatListTimestamp(req.addedAt) : '';
                    const isBusy = busyRequestId === req.id;

                    return (
                      <div key={req.id} className="add-contact-card">
                        <Avatar src={req.avatarUrl} name={displayName} size="md" priority="high" />
                        <div className="add-contact-card-info">
                          <div className="add-contact-card-name">{displayName}</div>
                          <div className="add-contact-card-meta">
                            请求添加你为好友{timeLabel ? ` · ${timeLabel}` : ''}
                          </div>
                        </div>
                        <div className="add-contact-card-actions">
                          <button
                            type="button"
                            className="add-contact-btn add-contact-btn--accept"
                            disabled={!!busyRequestId}
                            onClick={() =>
                              void handleProcessIncomingRequest(req.id, displayName, 'accept', req.userId)
                            }
                            aria-label={`同意 ${displayName} 的好友请求`}
                          >
                            <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                            <span>{isBusy ? '处理中' : '同意'}</span>
                          </button>
                          <button
                            type="button"
                            className="add-contact-btn add-contact-btn--ghost"
                            disabled={!!busyRequestId}
                            onClick={() =>
                              void handleProcessIncomingRequest(req.id, displayName, 'reject', req.userId)
                            }
                            aria-label={`拒绝 ${displayName} 的好友请求`}
                          >
                            拒绝
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === 'sent' && (
            <div
              id="contact-panel-sent"
              role="tabpanel"
              aria-labelledby="contact-tab-sent"
              className="add-contact-panel"
            >
              <div className="add-contact-panel-toolbar">
                <span className="add-contact-panel-count">
                  已发出 {sentRequests.length} 条好友申请
                </span>
                <button
                  type="button"
                  className="add-contact-refresh-btn"
                  disabled={isLoadingSent}
                  onClick={() => void loadSentRequests()}
                >
                  <RefreshCw
                    size={13}
                    className={isLoadingSent ? 'is-spinning' : ''}
                    aria-hidden="true"
                  />
                  <span>{isLoadingSent ? '刷新中' : '刷新'}</span>
                </button>
              </div>

              <div className="add-contact-list">
                {sentRequests.length === 0 ? (
                  <div className="add-contact-empty">
                    <div className="add-contact-empty-icon" aria-hidden="true">
                      <Send size={28} strokeWidth={1.6} />
                    </div>
                    <p className="add-contact-empty-title">暂无待对方确认的申请</p>
                    <p className="add-contact-empty-desc">你发出的好友请求在对方同意前会列在此处</p>
                    <button
                      type="button"
                      className="add-contact-btn add-contact-btn--primary"
                      onClick={() => setActiveTab('search')}
                    >
                      <Search size={13} aria-hidden="true" />
                      <span>去查找好友</span>
                    </button>
                  </div>
                ) : (
                  sentRequests.map((item) => {
                    const timeLabel = item.addedAt ? formatChatListTimestamp(item.addedAt) : '';
                    return (
                      <div key={item.id} className="add-contact-card">
                        <Avatar src={item.avatarUrl} name={item.username} size="md" priority="high" />
                        <div className="add-contact-card-info">
                          <div className="add-contact-card-name">{item.username}</div>
                          <div className="add-contact-card-meta">
                            {timeLabel ? `发送于 ${timeLabel}` : '已发出申请'}
                          </div>
                        </div>
                        <span className="add-contact-status-pill is-pending">
                          <Clock size={13} aria-hidden="true" />
                          <span>等待确认</span>
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
};

export default AddContactModal;
