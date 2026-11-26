import React from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { PostComposer } from './PostComposer';
import './ComposePostModal.css';

export interface ComposePostModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentUser: {
        username: string;
        avatarUrl?: string;
    };
    onSubmit: (content: string, media?: File[]) => Promise<void>;
}

/**
 * 独立发帖模态框：从左侧“发布动态”或快捷键弹出，无需切离当前所在 Space 子视图
 */
export const ComposePostModal: React.FC<ComposePostModalProps> = ({
    open,
    onOpenChange,
    currentUser,
    onSubmit,
}) => {
    const handleModalSubmit = async (content: string, media?: File[]) => {
        await onSubmit(content, media);
        onOpenChange(false);
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="compose-post-modal__overlay" />
                <Dialog.Content className="compose-post-modal__content" aria-describedby={undefined}>
                    <div className="compose-post-modal__header">
                        <Dialog.Title className="compose-post-modal__title">
                            发布动态
                        </Dialog.Title>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                className="compose-post-modal__close"
                                aria-label="关闭发帖弹窗"
                            >
                                <X size={18} />
                            </button>
                        </Dialog.Close>
                    </div>
                    <div className="compose-post-modal__body">
                        <PostComposer
                            currentUser={currentUser}
                            onSubmit={handleModalSubmit}
                            placeholder="分享新鲜事、观点或图片..."
                            autoFocus
                        />
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};

export default ComposePostModal;
