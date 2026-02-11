import React, { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
    placeholder = 'Message',
}) => {
    const [message, setMessage] = useState('');
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleSend = () => {
        if (message.trim() && isConnected) {
            onSendMessage(message.trim());
            setMessage('');
            inputRef.current?.focus();
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
            e.target.value = '';
        }
    };

    const handleEmojiSelect = (emoji: string) => {
        setMessage((prev) => prev + emoji);
        // Don't close picker for multi-select
        // setShowEmojiPicker(false);
        inputRef.current?.focus();
    };

    // Close emoji picker when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (showEmojiPicker && !target.closest('.message-input__emoji-container') && !target.closest('.message-input__emoji-picker')) {
                setShowEmojiPicker(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showEmojiPicker]);

    return (
        <div className="message-input">
            {/* Hidden File Input */}
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                style={{ display: 'none' }}
                accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.txt,.zip"
                id="chat-message-file-input"
                name="chat-message-file-input"
                aria-label="上传附件"
            />

            <div className="message-input__wrapper">
                {/* Attach Button */}
                <motion.button
                    type="button"
                    className="message-input__btn message-input__btn--attach"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!isConnected || isUploading}
                    title="Attach File"
                    aria-label="上传附件"
                    whileHover={{ scale: 1.1, rotate: 45 }}
                    whileTap={{ scale: 0.9 }}
                >
                    {isUploading ? (
                        <div className="spinner" style={{ width: 20, height: 20, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                        </svg>
                    )}
                </motion.button>

                {/* Input Field */}
                <input
                    ref={inputRef}
                    type="text"
                    id="chat-message-input"
                    name="chat-message-input"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder={placeholder}
                    disabled={!isConnected}
                    className="message-input__field"
                    autoComplete="off"
                    aria-label="输入消息内容"
                />

                {/* Emoji Button */}
                <div className="message-input__emoji-container">
                    <motion.button
                        type="button"
                        className="message-input__btn message-input__btn--emoji"
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        disabled={!isConnected}
                        title="Add Emoji"
                        aria-label="打开表情面板"
                        aria-haspopup="true"
                        aria-expanded={showEmojiPicker}
                        style={{ color: showEmojiPicker ? 'var(--tg-blue)' : '' }}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                            <circle cx="12" cy="12" r="10" />
                            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                            <line x1="9" y1="9" x2="9.01" y2="9" />
                            <line x1="15" y1="9" x2="15.01" y2="9" />
                        </svg>
                    </motion.button>

                    <AnimatePresence>
                        {showEmojiPicker && (
                            <motion.div
                                className="message-input__emoji-picker"
                                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                            >
                                {COMMON_EMOJIS.map((emoji) => (
                                    <motion.button
                                        type="button"
                                        key={emoji}
                                        className="message-input__emoji-item"
                                        onClick={() => handleEmojiSelect(emoji)}
                                        aria-label={`插入表情 ${emoji}`}
                                        whileHover={{ scale: 1.2, backgroundColor: "rgba(255,255,255,0.1)" }}
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

            {/* Send Button */}
            <AnimatePresence>
                {message.trim() && (
                    <motion.button
                        type="button"
                        className="message-input__btn message-input__btn--send message-input__btn--active"
                        onClick={handleSend}
                        disabled={!isConnected || !message.trim()}
                        title="Send Message"
                        aria-label="发送消息"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                    >
                        <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 20, height: 20 }}>
                            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                        </svg>
                    </motion.button>
                )}
            </AnimatePresence>
        </div>
    );
};

export default MessageInput;
