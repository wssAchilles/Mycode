import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Edit3, FileText, LoaderCircle, Paperclip, Reply, Send, Smile, X } from 'lucide-react';
import type { Message } from '../../../types/chat';
import { useChatUiPrefsStore } from '../state/chatUiPrefsStore';
import { MentionPopover, type MentionCandidate } from './input/MentionPopover';
import './MessageInput.css';

interface StagedAttachmentItem {
  id: string;
  file: File;
  previewUrl: string | null;
}

interface MessageInputProps {
  chatId?: string;
  onSendMessage: (content: string) => void;
  onFileUpload: (file: File, caption?: string) => void;
  onFilesUpload?: (files: File[], caption?: string) => void;
  isConnected: boolean;
  isUploading?: boolean;
  uploadProgress?: number | null;
  placeholder?: string;
  editingMessage?: Message | null;
  replyingMessage?: Message | null;
  isGroupChat?: boolean;
  groupMembers?: MentionCandidate[];
  currentUsername?: string;
  canMentionAll?: boolean;
  onCancelContext?: () => void;
  onSaveEdit?: (messageId: string, newContent: string) => Promise<boolean | void> | boolean | void;
  onEditLastOwnMessage?: () => void;
  onTypingChange?: (isTyping: boolean) => void;
}

const COMMON_EMOJIS = [
  '😀', '😁', '😂', '🤣', '😄', '😅', '😆', '😉',
  '😊', '😋', '😍', '🥰', '😘', '😙', '😚', '❤️',
  '👍', '🔥', '🎉', '✨',
];

const MAX_TEXTAREA_HEIGHT = 140;
const MAX_STAGED_FILES = 6;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MessageInput: React.FC<MessageInputProps> = ({
  chatId,
  onSendMessage,
  onFileUpload,
  onFilesUpload,
  isConnected,
  isUploading = false,
  uploadProgress = null,
  placeholder = '输入消息...',
  editingMessage = null,
  replyingMessage = null,
  isGroupChat = false,
  groupMembers = [],
  currentUsername,
  canMentionAll = false,
  onCancelContext,
  onSaveEdit,
  onEditLastOwnMessage,
  onTypingChange,
}) => {
  const [message, setMessage] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<StagedAttachmentItem[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<{ start: number; end: number; keyword: string } | null>(null);
  const [mentionActiveIdx, setMentionActiveIdx] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevEditingIdRef = useRef<string | null>(null);
  const lastTypingActiveRef = useRef(false);
  const stagedFilesRef = useRef<StagedAttachmentItem[]>([]);
  stagedFilesRef.current = stagedFiles;
  const setDraft = useChatUiPrefsStore((state) => state.setDraft);
  const clearDraft = useChatUiPrefsStore((state) => state.clearDraft);

  const trimmedMessage = message.trim();
  const isEditing = Boolean(editingMessage);
  const hasStagedFiles = stagedFiles.length > 0;
  const canSend = Boolean(
    isConnected
    && !isUploading
    && (isEditing ? trimmedMessage : trimmedMessage || hasStagedFiles),
  );

  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    if (!isGroupChat || !mentionQuery) return [];
    const kw = mentionQuery.keyword.toLowerCase();
    const list: MentionCandidate[] = [];
    if (canMentionAll && (!kw || '所有人'.includes(kw) || 'all'.startsWith(kw))) {
      list.push({
        userId: '__all__',
        username: '所有人',
        role: 'all',
      });
    }
    const selfName = currentUsername?.trim().toLowerCase();
    for (const member of groupMembers) {
      if (!member?.username) continue;
      if (selfName && member.username.trim().toLowerCase() === selfName) continue;
      if (!kw || member.username.toLowerCase().includes(kw)) {
        list.push(member);
      }
      if (list.length >= 8) break;
    }
    return list;
  }, [canMentionAll, currentUsername, groupMembers, isGroupChat, mentionQuery]);

  // 自动调整多行输入框高度
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(el.scrollHeight || 22, MAX_TEXTAREA_HEIGHT);
    el.style.height = `${Math.max(22, nextHeight)}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [message, adjustTextareaHeight]);

  // 组件卸载时统一释放暂存预览 URL，避免内存泄漏
  useEffect(() => {
    return () => {
      for (const item of stagedFilesRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  const clearStagedFiles = useCallback(() => {
    setStagedFiles((prev) => {
      for (const item of prev) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      return [];
    });
  }, []);

  const removeStagedFileAt = useCallback((id: string) => {
    setStagedFiles((prev) =>
      prev.filter((item) => {
        if (item.id === id) {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
          return false;
        }
        return true;
      }),
    );
  }, []);

  const appendFilesForSend = useCallback((files: File[]) => {
    if (!files.length) return;
    setStagedFiles((prev) => {
      const remaining = Math.max(0, MAX_STAGED_FILES - prev.length);
      if (remaining === 0) return prev;
      const accepted = files.slice(0, remaining).map((file, idx) => ({
        id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      }));
      return [...prev, ...accepted];
    });
    window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }, []);

  // 切换会话时恢复对应草稿，同时重置暂存附件与提及状态
  useEffect(() => {
    clearStagedFiles();
    setMentionQuery(null);
    if (editingMessage) return;
    const savedDraft = chatId ? (useChatUiPrefsStore.getState().draftByChatId[chatId] || '') : '';
    setMessage(savedDraft);
  }, [chatId, clearStagedFiles, editingMessage]);

  // 切换编辑态时填充被编辑消息正文，退出编辑态时恢复当前会话草稿
  useEffect(() => {
    const currentEditId = editingMessage?.id || null;
    if (currentEditId && currentEditId !== prevEditingIdRef.current) {
      prevEditingIdRef.current = currentEditId;
      clearStagedFiles();
      setMentionQuery(null);
      setMessage(editingMessage?.content || '');
      window.setTimeout(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
        }
      }, 0);
      return;
    }

    if (!currentEditId && prevEditingIdRef.current) {
      prevEditingIdRef.current = null;
      const savedDraft = chatId ? (useChatUiPrefsStore.getState().draftByChatId[chatId] || '') : '';
      setMessage(savedDraft);
    }
  }, [chatId, clearStagedFiles, editingMessage]);

  // 进入回复态时自动聚焦输入框
  useEffect(() => {
    if (replyingMessage) {
      window.setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    }
  }, [replyingMessage]);

  const notifyTyping = useCallback(
    (active: boolean) => {
      if (!onTypingChange) return;
      if (lastTypingActiveRef.current === active) return;
      lastTypingActiveRef.current = active;
      onTypingChange(active);
    },
    [onTypingChange],
  );

  // 切走会话或卸载时上报停止输入
  useEffect(() => {
    return () => {
      if (lastTypingActiveRef.current) {
        lastTypingActiveRef.current = false;
        onTypingChange?.(false);
      }
    };
  }, [chatId, onTypingChange]);

  const updateMentionQueryFromValue = useCallback(
    (value: string, caret: number | null) => {
      if (!isGroupChat || isEditing || caret === null) {
        setMentionQuery(null);
        return;
      }
      const beforeCaret = value.slice(0, caret);
      const match = beforeCaret.match(/(?:^|\s)@([^\s@]{0,24})$/);
      if (!match) {
        setMentionQuery(null);
        return;
      }
      const keyword = match[1] || '';
      const atStart = beforeCaret.length - keyword.length - 1;
      setMentionQuery({ start: atStart, end: caret, keyword });
      setMentionActiveIdx(0);
    },
    [isEditing, isGroupChat],
  );

  const handleSelectMention = useCallback(
    (candidate: MentionCandidate) => {
      if (!mentionQuery) return;
      const insertion = `@${candidate.username} `;
      const nextVal = `${message.slice(0, mentionQuery.start)}${insertion}${message.slice(mentionQuery.end)}`;
      const nextCaret = mentionQuery.start + insertion.length;
      setMessage(nextVal);
      setMentionQuery(null);
      if (!editingMessage && chatId) {
        setDraft(chatId, nextVal);
      }
      window.setTimeout(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(nextCaret, nextCaret);
        }
      }, 0);
    },
    [chatId, editingMessage, mentionQuery, message, setDraft],
  );

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextVal = e.target.value;
    setMessage(nextVal);
    if (!editingMessage && chatId) {
      setDraft(chatId, nextVal);
    }
    updateMentionQueryFromValue(nextVal, e.target.selectionStart);
    notifyTyping(!editingMessage && nextVal.trim().length > 0 && isConnected);
  };

  const handleSend = async () => {
    if (!canSend) return;

    if (editingMessage) {
      const nextText = trimmedMessage;
      if (!nextText) return;
      if (nextText === editingMessage.content.trim()) {
        onCancelContext?.();
        return;
      }
      const res = await onSaveEdit?.(editingMessage.id, nextText);
      if (res !== false) {
        onCancelContext?.();
      }
      return;
    }

    notifyTyping(false);
    setMentionQuery(null);

    if (stagedFiles.length > 0) {
      const filesToSend = stagedFiles.map((item) => item.file);
      const captionToSend = trimmedMessage;
      clearStagedFiles();
      setMessage('');
      if (chatId) clearDraft(chatId);
      if (onFilesUpload && filesToSend.length > 1) {
        onFilesUpload(filesToSend, captionToSend || undefined);
      } else if (filesToSend.length === 1) {
        onFileUpload(filesToSend[0], captionToSend || undefined);
      } else {
        for (let i = 0; i < filesToSend.length; i += 1) {
          onFileUpload(filesToSend[i], i === filesToSend.length - 1 ? (captionToSend || undefined) : undefined);
        }
      }
      textareaRef.current?.focus();
      return;
    }

    if (trimmedMessage) {
      const textToSend = trimmedMessage;
      setMessage('');
      if (chatId) clearDraft(chatId);
      onSendMessage(textToSend);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 拦截中文/日韩输入法组词阶段的回车确认，防止半截字母误发送
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }

    if (mentionQuery && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionActiveIdx((prev) => (prev + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionActiveIdx((prev) => (prev - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = mentionCandidates[mentionActiveIdx] || mentionCandidates[0];
        if (selected) handleSelectMention(selected);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
      return;
    }

    if (e.key === 'Escape' && (editingMessage || replyingMessage || hasStagedFiles)) {
      e.preventDefault();
      if (hasStagedFiles) {
        clearStagedFiles();
      }
      if (editingMessage || replyingMessage) {
        onCancelContext?.();
      }
      return;
    }

    if (
      e.key === 'ArrowUp'
      && !message
      && !editingMessage
      && !replyingMessage
      && !hasStagedFiles
      && onEditLastOwnMessage
    ) {
      e.preventDefault();
      onEditLastOwnMessage();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      appendFilesForSend(files);
      e.target.value = '';
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!isConnected || isEditing) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) pastedFiles.push(file);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      appendFilesForSend(pastedFiles);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLFormElement>) => {
    if (!isConnected || isEditing) return;
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!isDragActive) setIsDragActive(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLFormElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragActive(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLFormElement>) => {
    setIsDragActive(false);
    if (!isConnected || isEditing) return;
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) {
      e.preventDefault();
      appendFilesForSend(files);
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    const nextVal = `${message}${emoji}`;
    setMessage(nextVal);
    if (!editingMessage && chatId) {
      setDraft(chatId, nextVal);
    }
    textareaRef.current?.focus();
  };

  // 点击浮层外部关闭表情选择面板
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        showEmojiPicker
        && !target.closest('.message-input__emoji-container')
        && !target.closest('.message-input__emoji-picker')
      ) {
        setShowEmojiPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmojiPicker]);

  return (
    <form
      className={`message-input ${!isConnected ? 'message-input--offline' : ''} ${isDragActive ? 'message-input--dragging' : ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        void handleSend();
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* @群成员自动补全浮层 */}
      <MentionPopover
        open={Boolean(mentionQuery && mentionCandidates.length > 0)}
        candidates={mentionCandidates}
        activeIndex={mentionActiveIdx}
        onSelect={handleSelectMention}
      />

      {/* 上传进度条 */}
      {isUploading && (
        <div className="message-input__upload-progress" role="progressbar" aria-valuenow={uploadProgress ?? undefined} aria-valuemin={0} aria-valuemax={100}>
          <div className="message-input__upload-progress-track">
            <div
              className="message-input__upload-progress-fill"
              style={{ width: `${Math.max(8, Math.min(100, uploadProgress ?? 35))}%` }}
            />
          </div>
          <span className="message-input__upload-progress-label">
            正在上传附件{typeof uploadProgress === 'number' ? ` ${Math.round(uploadProgress)}%` : '...'}
          </span>
        </div>
      )}

      {/* 上下文预览条：正在编辑 / 引用回复 */}
      {(editingMessage || replyingMessage) && (
        <div className="message-input__context-bar" role="status">
          <span className="message-input__context-icon" aria-hidden="true">
            {editingMessage ? <Edit3 size={15} /> : <Reply size={15} />}
          </span>
          <div className="message-input__context-body">
            <span className="message-input__context-title">
              {editingMessage
                ? '正在编辑消息'
                : `回复 ${replyingMessage?.senderUsername || replyingMessage?.username || '联系人'}`}
            </span>
            <span className="message-input__context-preview">
              {editingMessage?.content || replyingMessage?.content || (replyingMessage?.fileName ? `[文件] ${replyingMessage.fileName}` : '[多媒体消息]')}
            </span>
          </div>
          <button
            type="button"
            className="message-input__context-close"
            onClick={onCancelContext}
            aria-label="取消当前编辑或回复"
            title="取消 (Esc)"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* 待发送附件确认预览条（支持多图/多文件队列） */}
      {stagedFiles.length > 0 && (
        <div className="message-input__staged-queue" role="status">
          <div className="message-input__staged-list">
            {stagedFiles.map((item) => (
              <div key={item.id} className="message-input__staged-file">
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt={item.file.name} className="message-input__staged-thumb" />
                ) : (
                  <div className="message-input__staged-icon" aria-hidden="true">
                    <FileText size={18} />
                  </div>
                )}
                <div className="message-input__staged-meta">
                  <span className="message-input__staged-name">{item.file.name || '粘贴的文件'}</span>
                  <span className="message-input__staged-size">{formatBytes(item.file.size)}</span>
                </div>
                <button
                  type="button"
                  className="message-input__context-close"
                  onClick={() => removeStagedFileAt(item.id)}
                  aria-label={`移除附件 ${item.file.name}`}
                  title="移除此附件"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          {stagedFiles.length > 1 && (
            <button
              type="button"
              className="message-input__staged-clear-all"
              onClick={clearStagedFiles}
            >
              清空全部 ({stagedFiles.length}/{MAX_STAGED_FILES})
            </button>
          )}
        </div>
      )}

      <div className="message-input__row">
        {/* 隐藏文件选择器（支持多选） */}
        <input
          type="file"
          multiple
          ref={fileInputRef}
          onChange={handleFileChange}
          className="message-input__file"
          accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.txt,.zip"
          id="chat-message-file-input"
          name="chat-message-file-input"
          aria-label="上传附件"
        />

        <div className="message-input__wrapper">
          <motion.button
            type="button"
            className="message-input__btn message-input__btn--attach"
            onClick={() => fileInputRef.current?.click()}
            disabled={!isConnected || isUploading || isEditing || stagedFiles.length >= MAX_STAGED_FILES}
            title="上传附件（最多 6 个）"
            aria-label="上传附件"
            whileTap={{ scale: 0.94 }}
          >
            {isUploading ? (
              <LoaderCircle className="message-input__spinner" size={20} aria-hidden="true" />
            ) : (
              <Paperclip size={20} aria-hidden="true" />
            )}
          </motion.button>

          <textarea
            ref={textareaRef}
            rows={1}
            id="chat-message-input"
            name="chat-message-input"
            value={message}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              !isConnected
                ? '连接中，暂不可发送...'
                : hasStagedFiles
                  ? '添加图片/文件说明（可选），按 Enter 发送...'
                  : isGroupChat
                    ? '输入消息，输入 @ 可提及群成员...'
                    : placeholder
            }
            disabled={!isConnected}
            className="message-input__field message-input__textarea"
            autoComplete="off"
            aria-label="输入消息内容"
          />

          <div className="message-input__emoji-container">
            <motion.button
              type="button"
              className="message-input__btn message-input__btn--emoji"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              disabled={!isConnected}
              title="选择表情"
              aria-label="打开表情面板"
              aria-haspopup="true"
              aria-expanded={showEmojiPicker}
              aria-pressed={showEmojiPicker}
              whileTap={{ scale: 0.94 }}
            >
              <Smile size={20} aria-hidden="true" />
            </motion.button>

            <AnimatePresence>
              {showEmojiPicker && (
                <motion.div
                  className="message-input__emoji-picker"
                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 10 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                >
                  {COMMON_EMOJIS.map((emoji) => (
                    <motion.button
                      type="button"
                      key={emoji}
                      className="message-input__emoji-item"
                      onClick={() => handleEmojiSelect(emoji)}
                      aria-label={`插入表情 ${emoji}`}
                      whileHover={{ scale: 1.2, backgroundColor: 'rgba(15, 20, 25, 0.06)' }}
                      whileTap={{ scale: 0.9 }}
                    >
                      {emoji}
                    </motion.button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <motion.button
          type="submit"
          className={`message-input__btn message-input__btn--send ${canSend ? 'message-input__btn--active' : ''}`}
          disabled={!canSend}
          title={isEditing ? '保存修改' : '发送消息'}
          aria-label={isEditing ? '保存修改' : '发送消息'}
          whileTap={canSend ? { scale: 0.92 } : undefined}
        >
          <Send size={20} aria-hidden="true" />
        </motion.button>
      </div>
    </form>
  );
};

export default MessageInput;
