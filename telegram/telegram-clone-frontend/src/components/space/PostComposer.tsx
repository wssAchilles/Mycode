/**
 * PostComposer - 发帖组件
 * 类 Twitter 发帖体验
 */

import React, { useState, useCallback, useRef, useEffect, type ChangeEvent } from 'react';
import { mlService } from '../../services/mlService';
import { showToast } from '../ui/Toast';
import { giphyApi, type GiphyGif } from '../../services/giphyApi';
import { resolveSpaceMediaUrl } from '../../utils/spaceMediaUrl';
import './PostComposer.css';

const MAX_CHARS = 280;
const MAX_MEDIA = 4;
const EMOJI_SET = ['😀', '😂', '😍', '🥳', '😎', '🤔', '😭', '🔥', '👍', '🎉', '✨', '💬', '🚀', '🌟', '🍀', '🍉', '🐳', '🏔️', '📸', '❤️'];

export interface PostComposerProps {
    currentUser: {
        username: string;
        avatarUrl?: string;
    };
    onSubmit: (content: string, media?: File[]) => Promise<void>;
    placeholder?: string;
    autoFocus?: boolean;
}

const COMPOSER_DRAFT_KEY_PREFIX = 'tg:space:composer-draft:';

function readDraft(username: string): string {
    if (typeof window === 'undefined' || !username) return '';
    try {
        return window.localStorage.getItem(`${COMPOSER_DRAFT_KEY_PREFIX}${username}`) || '';
    } catch {
        return '';
    }
}

function writeDraft(username: string, value: string): void {
    if (typeof window === 'undefined' || !username) return;
    try {
        const key = `${COMPOSER_DRAFT_KEY_PREFIX}${username}`;
        if (!value) {
            window.localStorage.removeItem(key);
        } else {
            window.localStorage.setItem(key, value);
        }
    } catch {
        // 忽略存储异常
    }
}

// SVG 图标（Apple SF Symbols 1.85px 圆润几何笔触）
const ImageIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" width="19" height="19">
        <rect x="3.25" y="3.25" width="17.5" height="17.5" rx="3.75" ry="3.75" />
        <circle cx="8.75" cy="8.75" r="1.5" />
        <path d="M20.5 15.25l-4.65-4.65a1.5 1.5 0 0 0-2.12 0L5 19.38" />
    </svg>
);

const GifIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" width="19" height="19">
        <rect x="2.5" y="5.5" width="19" height="13" rx="3.5" />
        <text x="6.5" y="14.5" fontSize="7.5" fontWeight="700" letterSpacing="0.03em" fill="currentColor" stroke="none">GIF</text>
    </svg>
);

const EmojiIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" width="19" height="19">
        <circle cx="12" cy="12" r="9.25" />
        <path d="M8.25 14.25s1.4 1.9 3.75 1.9 3.75-1.9 3.75-1.9" />
        <line x1="9" y1="9.5" x2="9.01" y2="9.5" strokeWidth="2.4" />
        <line x1="15" y1="9.5" x2="15.01" y2="9.5" strokeWidth="2.4" />
    </svg>
);

const CloseIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

// 安全警告图标 (SVG)
const WarningIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

export const PostComposer: React.FC<PostComposerProps> = ({
    currentUser,
    onSubmit,
    placeholder = '发生了什么？',
    autoFocus = false,
}) => {
    const [content, setContent] = useState(() => readDraft(currentUser.username));
    const [mediaFiles, setMediaFiles] = useState<File[]>([]);
    const [mediaPreviewUrls, setMediaPreviewUrls] = useState<string[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [safetyWarning, setSafetyWarning] = useState<string | null>(null);
    const [isCheckingSafety, setIsCheckingSafety] = useState(false);
    const [showEmojiPanel, setShowEmojiPanel] = useState(false);
    const [showGifPanel, setShowGifPanel] = useState(false);
    const [gifUrl, setGifUrl] = useState('');
    const [gifQuery, setGifQuery] = useState('');
    const [gifTrending, setGifTrending] = useState<GiphyGif[]>([]);
    const [gifResults, setGifResults] = useState<GiphyGif[]>([]);
    const [gifLoading, setGifLoading] = useState(false);
    const [isAddingGif, setIsAddingGif] = useState(false);
    const [avatarError, setAvatarError] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const charCount = content.length;
    const isOverLimit = charCount > MAX_CHARS;
    const isNearLimit = charCount > MAX_CHARS * 0.9;
    const canSubmit =
        (content.trim().length > 0 || mediaFiles.length > 0)
        && !isOverLimit
        && !isSubmitting
        && !isCheckingSafety;
    const resolvedAvatarUrl = !avatarError ? resolveSpaceMediaUrl(currentUser.avatarUrl) : null;

    useEffect(() => {
        // When avatar changes (e.g. user updated profile), retry loading.
        setAvatarError(false);
    }, [currentUser.avatarUrl]);

    useEffect(() => {
        writeDraft(currentUser.username, content);
    }, [currentUser.username, content]);

    useEffect(() => {
        if (autoFocus) {
            requestAnimationFrame(() => textareaRef.current?.focus());
        }
    }, [autoFocus]);

    // 自动调整高度
    const adjustTextareaHeight = useCallback(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        }
    }, []);

    // 处理内容变化
    const handleContentChange = useCallback(
        (e: ChangeEvent<HTMLTextAreaElement>) => {
            setContent(e.target.value);
            adjustTextareaHeight();
        },
        [adjustTextareaHeight]
    );

    const appendImageFiles = useCallback((files: File[]) => {
        const remaining = MAX_MEDIA - mediaFiles.length;
        if (remaining <= 0) {
            showToast('最多只能添加 4 张图片', 'info');
            return;
        }
        const validFiles = files.filter((file) => file.type.startsWith('image/')).slice(0, remaining);
        if (validFiles.length === 0) return;
        setMediaFiles((prev) => [...prev, ...validFiles]);
        const newUrls = validFiles.map((file) => URL.createObjectURL(file));
        setMediaPreviewUrls((prev) => [...prev, ...newUrls]);
    }, [mediaFiles.length]);

    // 处理图片选择
    const handleImageSelect = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        appendImageFiles(files);
        // 清空 input 以允许重复选择
        if (e.target) e.target.value = '';
    }, [appendImageFiles]);

    // 移除媒体
    const removeMedia = useCallback((index: number) => {
        setMediaFiles((prev) => prev.filter((_, i) => i !== index));
        setMediaPreviewUrls((prev) => {
            URL.revokeObjectURL(prev[index]);
            return prev.filter((_, i) => i !== index);
        });
    }, []);

    const insertEmoji = useCallback((emoji: string) => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart ?? content.length;
        const end = textarea.selectionEnd ?? content.length;
        const next = `${content.slice(0, start)}${emoji}${content.slice(end)}`;
        setContent(next);
        setShowEmojiPanel(false);
        requestAnimationFrame(() => {
            textarea.focus();
            const cursor = start + emoji.length;
            textarea.setSelectionRange(cursor, cursor);
            adjustTextareaHeight();
        });
    }, [content, adjustTextareaHeight]);

    const addGifByUrl = useCallback(async (url?: string) => {
        const trimmed = (url ?? gifUrl).trim();
        if (!trimmed) {
            showToast('请输入 GIF 地址', 'info');
            return;
        }
        if (mediaFiles.length >= MAX_MEDIA) {
            showToast('最多只能添加 4 个媒体文件', 'info');
            return;
        }
        setIsAddingGif(true);
        try {
            const response = await fetch(trimmed);
            if (!response.ok) throw new Error('GIF 下载失败');
            const blob = await response.blob();
            const file = new File([blob], `gif-${Date.now()}.gif`, { type: blob.type || 'image/gif' });
            setMediaFiles((prev) => [...prev, file]);
            const url = URL.createObjectURL(file);
            setMediaPreviewUrls((prev) => [...prev, url]);
            setGifUrl('');
            setGifQuery('');
            setGifResults([]);
            setShowGifPanel(false);
            showToast('GIF 已添加', 'success');
        } catch (error) {
            console.warn(error);
            showToast('GIF 加载失败，请检查链接或下载后上传', 'error');
        } finally {
            setIsAddingGif(false);
        }
    }, [gifUrl, mediaFiles.length]);

    const loadTrendingGifs = useCallback(async () => {
        if (gifTrending.length > 0) return;
        setGifLoading(true);
        try {
            const results = await giphyApi.trending(24);
            setGifTrending(results);
        } catch (error) {
            console.warn(error);
            showToast('GIF 加载失败，请稍后再试', 'error');
        } finally {
            setGifLoading(false);
        }
    }, [gifTrending.length]);

    const searchGifs = useCallback(async () => {
        const query = gifQuery.trim();
        if (!query) {
            showToast('请输入搜索关键词', 'info');
            return;
        }
        setGifLoading(true);
        try {
            const results = await giphyApi.search(query, 24);
            setGifResults(results);
        } catch (error) {
            console.warn(error);
            showToast('GIF 搜索失败，请稍后再试', 'error');
        } finally {
            setGifLoading(false);
        }
    }, [gifQuery]);

    useEffect(() => {
        if (showGifPanel) {
            loadTrendingGifs();
        }
    }, [showGifPanel, loadTrendingGifs]);

    // 提交帖子 (带安全检测)
    const handleSubmit = useCallback(async () => {
        if (!canSubmit) return;

        setSafetyWarning(null);
        setIsCheckingSafety(true);

        try {
            // Step 1: 安全检测 (Phoenix VF v2)，纯图片动态无需检测空文本
            const trimmedContent = content.trim();
            if (trimmedContent) {
                const vfResult = await mlService.vfCheckContent(trimmedContent);
                if (vfResult && vfResult.safe === false) {
                    setSafetyWarning(vfResult.reason || '内容被系统拦截 (安全策略)');
                    setIsCheckingSafety(false);
                    return;
                }
            }

            // (Previous array check logic removed)

        } catch {
            // 安全检测失败时降级：允许发布
            console.warn('[Safety] 检测服务不可用，跳过检测');
        } finally {
            setIsCheckingSafety(false);
        }

        // Step 2: 提交帖子
        setIsSubmitting(true);
        try {
            await onSubmit(content.trim(), mediaFiles.length > 0 ? mediaFiles : undefined);

            // 清空表单并清除草稿
            setContent('');
            writeDraft(currentUser.username, '');
            setMediaFiles([]);
            mediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
            setMediaPreviewUrls([]);

            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
            }
        } finally {
            setIsSubmitting(false);
        }
    }, [canSubmit, content, currentUser.username, mediaFiles, mediaPreviewUrls, onSubmit]);

    const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = Array.from(event.clipboardData?.items || []);
        const imageFiles: File[] = [];
        for (const item of items) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const f = item.getAsFile();
                if (f) imageFiles.push(f);
            }
        }
        if (imageFiles.length > 0) {
            event.preventDefault();
            appendImageFiles(imageFiles);
        }
    }, [appendImageFiles]);

    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSubmit) {
                void handleSubmit();
            }
        }
    }, [canSubmit, handleSubmit]);

    // 获取首字母
    const getInitials = (name: string): string => name.charAt(0).toUpperCase();

    // 获取字符计数样式类
    const getCharCountClass = (): string => {
        if (isOverLimit) return 'post-composer__char-count post-composer__char-count--error';
        if (isNearLimit) return 'post-composer__char-count post-composer__char-count--warning';
        return 'post-composer__char-count';
    };

    return (
        <div
            className={`post-composer ${isDragOver ? 'is-drag-over' : ''}`}
            onDragOver={(event) => {
                if (event.dataTransfer?.types?.includes('Files')) {
                    event.preventDefault();
                    setIsDragOver(true);
                }
            }}
            onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setIsDragOver(false);
                }
            }}
            onDrop={(event) => {
                setIsDragOver(false);
                const dropped = Array.from(event.dataTransfer?.files || []);
                if (dropped.some((f) => f.type.startsWith('image/'))) {
                    event.preventDefault();
                    appendImageFiles(dropped);
                }
            }}
        >
            {/* 头像 */}
            <div className="post-composer__avatar">
                {resolvedAvatarUrl ? (
                    <img
                        src={resolvedAvatarUrl}
                        alt={currentUser.username}
                        onError={() => setAvatarError(true)}
                    />
                ) : (
                    <div className="post-composer__avatar-placeholder">
                        {getInitials(currentUser.username)}
                    </div>
                )}
            </div>

            {/* 表单 */}
            <div className="post-composer__form">
                {/* 文本输入 */}
                <div className="post-composer__input-wrapper">
                    <label className="post-composer__sr-only" htmlFor="space-post-content">
                        发布动态内容
                    </label>
                    <textarea
                        ref={textareaRef}
                        id="space-post-content"
                        name="spacePostContent"
                        className="post-composer__textarea"
                        placeholder={placeholder}
                        value={content}
                        onChange={handleContentChange}
                        onPaste={handlePaste}
                        onKeyDown={handleKeyDown}
                        rows={1}
                    />
                    {charCount > 0 && (
                        <span className={getCharCountClass()}>
                            <svg className="post-composer__char-ring" viewBox="0 0 20 20" aria-hidden="true">
                                <circle
                                    className="post-composer__char-ring-track"
                                    cx="10"
                                    cy="10"
                                    r="7.5"
                                    fill="none"
                                    strokeWidth="2"
                                />
                                <circle
                                    className="post-composer__char-ring-fill"
                                    cx="10"
                                    cy="10"
                                    r="7.5"
                                    fill="none"
                                    strokeWidth="2"
                                    strokeDasharray={47.12}
                                    strokeDashoffset={47.12 * (1 - Math.min(1, charCount / MAX_CHARS))}
                                />
                            </svg>
                            <span>{charCount}/{MAX_CHARS}</span>
                        </span>
                    )}
                </div>

                {/* 安全警告 */}
                {safetyWarning && (
                    <div className="post-composer__safety-warning">
                        <span className="post-composer__safety-icon"><WarningIcon /></span>
                        <span>{safetyWarning}</span>
                        <button
                            type="button"
                            className="post-composer__safety-dismiss"
                            onClick={() => setSafetyWarning(null)}
                            aria-label="关闭警告"
                        >
                            ×
                        </button>
                    </div>
                )}

                {/* 媒体预览 */}
                {mediaPreviewUrls.length > 0 && (
                    <div className="post-composer__media-preview">
                        {mediaPreviewUrls.map((url, index) => (
                            <div key={index} className="post-composer__media-item">
                                <img src={url} alt="" />
                                <button
                                    type="button"
                                    className="post-composer__media-remove"
                                    onClick={() => removeMedia(index)}
                                    aria-label="移除图片"
                                >
                                    <CloseIcon />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* 工具栏 */}
                <div className="post-composer__toolbar">
                    <div className="post-composer__tools">
                        <button
                            type="button"
                            className="post-composer__tool-btn"
                            onClick={handleImageSelect}
                            disabled={mediaFiles.length >= MAX_MEDIA}
                            aria-label="添加图片"
                            title="添加图片"
                        >
                            <ImageIcon />
                        </button>
                        <button
                            type="button"
                            className="post-composer__tool-btn"
                            aria-label="添加 GIF"
                            title="添加 GIF"
                            aria-expanded={showGifPanel}
                            aria-controls="space-composer-gif-panel"
                            onClick={() => {
                                setShowGifPanel((prev) => !prev);
                                setShowEmojiPanel(false);
                            }}
                        >
                            <GifIcon />
                        </button>
                        <button
                            type="button"
                            className="post-composer__tool-btn"
                            aria-label="添加表情"
                            title="添加表情"
                            aria-expanded={showEmojiPanel}
                            aria-controls="space-composer-emoji-panel"
                            onClick={() => {
                                setShowEmojiPanel((prev) => !prev);
                                setShowGifPanel(false);
                            }}
                        >
                            <EmojiIcon />
                        </button>
                    </div>

                    <div className="post-composer__submit-group">
                        <span className="post-composer__shortcut-hint" aria-hidden="true">
                            ⌘/Ctrl + Enter 发送 · 支持粘贴图片
                        </span>
                        <button
                            type="button"
                            className={`post-composer__submit ${isSubmitting || isCheckingSafety ? 'post-composer__submit--loading' : ''}`}
                            onClick={handleSubmit}
                            disabled={!canSubmit}
                        >
                            {isCheckingSafety ? '检测中...' : isSubmitting ? '发布中...' : '发布'}
                        </button>
                    </div>
                </div>

                {showGifPanel && (
                    <div
                        id="space-composer-gif-panel"
                        className="post-composer__panel"
                        role="dialog"
                        aria-label="添加 GIF"
                    >
                        <div className="post-composer__panel-header">
                            <span>添加 GIF</span>
                            <button type="button" onClick={() => setShowGifPanel(false)} aria-label="关闭">×</button>
                        </div>
                        <div className="post-composer__panel-body">
                            <input
                                type="url"
                                placeholder="粘贴 GIF 地址"
                                value={gifUrl}
                                onChange={(e) => setGifUrl(e.target.value)}
                            />
                            <button
                                type="button"
                                className="post-composer__panel-btn"
                                onClick={() => addGifByUrl()}
                                disabled={isAddingGif}
                            >
                                {isAddingGif ? '添加中...' : '添加 GIF'}
                            </button>
                        </div>
                        <div className="post-composer__panel-search">
                            <input
                                type="text"
                                placeholder="搜索 GIF"
                                value={gifQuery}
                                onChange={(e) => setGifQuery(e.target.value)}
                            />
                            <button
                                type="button"
                                className="post-composer__panel-btn"
                                onClick={searchGifs}
                                disabled={gifLoading}
                            >
                                {gifLoading ? '搜索中...' : '搜索'}
                            </button>
                        </div>
                        <div className="post-composer__gif-section">
                            <div className="post-composer__gif-title">
                                {gifResults.length > 0 ? '搜索结果' : '热门推荐'}
                            </div>
                            <div className="post-composer__gif-grid">
                                {(gifResults.length > 0 ? gifResults : gifTrending).map((gif) => (
                                    <button
                                        key={gif.id}
                                        type="button"
                                        className="post-composer__gif-item"
                                        onClick={() => addGifByUrl(gif.images.original.url)}
                                        aria-label={`添加 GIF：${gif.title || '未命名 GIF'}`}
                                    >
                                        <img src={gif.images.fixed_width.url} alt={gif.title || 'gif'} loading="lazy" />
                                    </button>
                                ))}
                                {!gifLoading && gifResults.length === 0 && gifTrending.length === 0 && (
                                    <div className="post-composer__gif-empty">暂无 GIF</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {showEmojiPanel && (
                    <div
                        id="space-composer-emoji-panel"
                        className="post-composer__panel post-composer__panel--emoji"
                        role="dialog"
                        aria-label="选择表情"
                    >
                        <div className="post-composer__panel-header">
                            <span>表情</span>
                            <button type="button" onClick={() => setShowEmojiPanel(false)} aria-label="关闭">×</button>
                        </div>
                        <div className="post-composer__emoji-grid">
                            {EMOJI_SET.map((emoji) => (
                                <button
                                    key={emoji}
                                    type="button"
                                    className="post-composer__emoji-btn"
                                    onClick={() => insertEmoji(emoji)}
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* 隐藏的文件输入 */}
                <input
                    ref={fileInputRef}
                    type="file"
                    id="space-post-media"
                    name="media"
                    accept="image/*"
                    multiple
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                />
            </div>
        </div>
    );
};

export default PostComposer;
