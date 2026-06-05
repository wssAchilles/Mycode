import React, { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LoaderCircle, Paperclip, Send, Smile } from 'lucide-react';
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
    const trimmedMessage = message.trim();
    const canSend = Boolean(trimmedMessage && isConnected);

    const handleSend = () => {
        if (canSend) {
            onSendMessage(trimmedMessage);
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
        <form
            className={`message-input ${!isConnected ? 'message-input--offline' : ''}`}
            onSubmit={(event) => {
                event.preventDefault();
                handleSend();
            }}
        >
            {/* Hidden File Input */}
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="message-input__file"
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
                    whileTap={{ scale: 0.94 }}
                >
                    {isUploading ? (
                        <LoaderCircle className="message-input__spinner" size={20} aria-hidden="true" />
                    ) : (
                        <Paperclip size={20} aria-hidden="true" />
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
            <motion.button
                type="submit"
                className={`message-input__btn message-input__btn--send ${canSend ? 'message-input__btn--active' : ''}`}
                disabled={!canSend}
                title="Send Message"
                aria-label="发送消息"
                whileTap={canSend ? { scale: 0.92 } : undefined}
            >
                <Send size={20} aria-hidden="true" />
            </motion.button>
        </form>
    );
};

export default MessageInput;
