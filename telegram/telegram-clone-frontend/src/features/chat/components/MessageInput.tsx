import React, { useRef, useState } from 'react';
import './MessageInput.css';

interface MessageInputProps {
    onSendMessage: (content: string) => void;
    onFileUpload: (file: File) => void;
    isConnected: boolean;
    isUploading?: boolean;
    placeholder?: string;
}

const COMMON_EMOJIS = [
    '😀', '😁', '😂', '🤣', '😄', '😅', '😆', '😉',
    '😊', '😋', '😍', '🥰', '😘', '😙', '😚', '❤️',
    '👍', '🔥', '🎉', '✨',
];

const MessageInput: React.FC<MessageInputProps> = ({
    onSendMessage,
    onFileUpload,
    isConnected,
    isUploading = false,
    placeholder = '输入消息...',
}) => {
    const [message, setMessage] = useState('');
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSend = () => {
        if (message.trim() && isConnected) {
            onSendMessage(message.trim());
            setMessage('');
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onFileUpload(file);
            e.target.value = ''; // 重置以允许重复上传同一文件
        }
    };

    const handleEmojiSelect = (emoji: string) => {
        setMessage((prev) => prev + emoji);
        setShowEmojiPicker(false);
    };

    return (
        <div className="message-input">
            {/* 隐藏的文件输入 */}
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                style={{ display: 'none' }}
                accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.txt,.zip"
            />

            {/* 附件按钮 */}
            <button
                className="message-input__btn message-input__btn--attach"
                onClick={() => fileInputRef.current?.click()}
                disabled={!isConnected || isUploading}
                title="附件"
            >
                {isUploading ? '⏳' : '📎'}
            </button>

            {/* 表情按钮 */}
            <div className="message-input__emoji-container">
                <button
                    className="message-input__btn message-input__btn--emoji"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    disabled={!isConnected}
                    title="表情"
                >
                    😊
                </button>
                {showEmojiPicker && (
                    <div className="message-input__emoji-picker">
                        {COMMON_EMOJIS.map((emoji) => (
                            <button
                                key={emoji}
                                className="message-input__emoji-item"
                                onClick={() => handleEmojiSelect(emoji)}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* 输入框 */}
            <div className="message-input__wrapper">
                <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder={placeholder}
                    disabled={!isConnected}
                    className="message-input__field"
                />
            </div>

            {/* 发送按钮 */}
            <button
                className={`message-input__btn message-input__btn--send ${isConnected && message.trim() ? 'message-input__btn--active' : ''
                    }`}
                onClick={handleSend}
                disabled={!isConnected || !message.trim()}
                title="发送"
            >
                🚀
            </button>
        </div>
    );
};

export default MessageInput;
