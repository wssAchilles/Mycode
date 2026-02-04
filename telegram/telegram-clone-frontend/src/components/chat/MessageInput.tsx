/**
 * MessageInput 组件
 * 消息输入区域，支持文本、表情包、文件上传
 */
import React, { useState, useRef, useCallback } from 'react';
import './MessageInput.css';

// 常用表情包列表
const COMMON_EMOJIS = [
    '😀', '😁', '😂', '🤣', '😄', '😅', '😆', '😉',
    '😊', '😋', '😍', '🥰', '😘', '😗', '😙', '😚',
    '🙂', '🙃', '😉', '😌', '😔', '😑', '😐', '😯',
    '🙄', '😮', '😭', '😨', '😰', '😩', '😢', '😱',
    '😥', '😪', '😴', '😎', '🤓', '🤔', '🤗', '🤭',
    '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🙏',
    '❤️', '💕', '💞', '💓', '💗', '💖', '💘', '💝',
    '🔥', '✨', '⭐', '🎉', '🎈', '🎂', '🎁', '🎀',
];

interface MessageInputProps {
    onSend: (content: string) => void;
    onFileUpload?: (file: File) => void;
    disabled?: boolean;
    placeholder?: string;
    isUploading?: boolean;
}

export const MessageInput: React.FC<MessageInputProps> = ({
    onSend,
    onFileUpload,
    disabled = false,
    placeholder = '输入消息...',
    isUploading = false,
}) => {
    const [message, setMessage] = useState('');
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const emojiPickerRef = useRef<HTMLDivElement>(null);

    // 发送消息
    const handleSend = useCallback(() => {
        if (message.trim() && !disabled) {
            onSend(message.trim());
            setMessage('');
        }
    }, [message, disabled, onSend]);

    // 键盘事件
    const handleKeyPress = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        },
        [handleSend]
    );

    // 选择表情
    const handleEmojiSelect = useCallback((emoji: string) => {
        setMessage((prev) => prev + emoji);
        setShowEmojiPicker(false);
    }, []);

    // 文件选择
    const handleFileChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (file && onFileUpload) {
                onFileUpload(file);
            }
            // 重置 input
            e.target.value = '';
        },
        [onFileUpload]
    );

    // 触发文件选择
    const handleFileClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    return (
        <div className="message-input-container">
            {/* 表情包选择器 */}
            {showEmojiPicker && (
                <div className="emoji-picker" ref={emojiPickerRef}>
                    <div className="emoji-picker-header">
                        <span>表情</span>
                        <button
                            className="emoji-picker-close"
                            onClick={() => setShowEmojiPicker(false)}
                        >
                            ✕
                        </button>
                    </div>
                    <div className="emoji-grid">
                        {COMMON_EMOJIS.map((emoji, index) => (
                            <button
                                key={index}
                                className="emoji-item"
                                onClick={() => handleEmojiSelect(emoji)}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* 输入区域 */}
            <div className="message-input-wrapper">
                {/* 工具按钮 */}
                <div className="input-tools">
                    <button
                        className="tool-button"
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        title="表情"
                        disabled={disabled}
                    >
                        😊
                    </button>
                    <button
                        className="tool-button"
                        onClick={handleFileClick}
                        title="发送文件"
                        disabled={disabled || isUploading}
                    >
                        {isUploading ? '⏳' : '📎'}
                    </button>
                </div>

                {/* 文本输入 */}
                <textarea
                    className="message-textarea"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder={placeholder}
                    disabled={disabled}
                    rows={1}
                />

                {/* 发送按钮 */}
                <button
                    className="send-button"
                    onClick={handleSend}
                    disabled={disabled || !message.trim()}
                    title="发送"
                >
                    <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        fill="currentColor"
                    >
                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                    </svg>
                </button>

                {/* 隐藏的文件输入 */}
                <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden-file-input"
                    onChange={handleFileChange}
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"
                />
            </div>
        </div>
    );
};

export default MessageInput;
