/**
 * MessageBubble 组件测试
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from '../components/chat/MessageBubble';
import type { Message } from '../types/store';

describe('MessageBubble', () => {
    const baseMessage: Message = {
        id: '1',
        chatId: 'p:user1:user2',
        chatType: 'private',
        content: 'Hello World',
        senderId: 'user1',
        senderUsername: 'TestUser',
        userId: 'user1',
        username: 'TestUser',
        timestamp: new Date().toISOString(),
        type: 'text',
        isGroupChat: false,
    };

    it('renders text message correctly', () => {
        render(<MessageBubble message={baseMessage} isOwn={false} />);
        expect(screen.getByText('Hello World')).toBeInTheDocument();
    });

    it('applies own message styling', () => {
        const { container } = render(
            <MessageBubble message={baseMessage} isOwn={true} />
        );
        expect(container.querySelector('.message-bubble-wrapper.own')).toBeInTheDocument();
    });

    it('applies other message styling', () => {
        const { container } = render(
            <MessageBubble message={baseMessage} isOwn={false} />
        );
        expect(container.querySelector('.message-bubble-wrapper.other')).toBeInTheDocument();
    });

    it('displays sender name when provided', () => {
        render(
            <MessageBubble
                message={baseMessage}
                isOwn={false}
                senderName="Alice"
            />
        );
        expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    it('shows avatar for non-own messages', () => {
        const { container } = render(
            <MessageBubble
                message={baseMessage}
                isOwn={false}
                senderName="Alice"
                showAvatar={true}
            />
        );
        expect(container.querySelector('.message-avatar')).toBeInTheDocument();
    });

    it('hides avatar when showAvatar is false', () => {
        const { container } = render(
            <MessageBubble
                message={baseMessage}
                isOwn={false}
                showAvatar={false}
            />
        );
        expect(container.querySelector('.message-avatar')).not.toBeInTheDocument();
    });
});
