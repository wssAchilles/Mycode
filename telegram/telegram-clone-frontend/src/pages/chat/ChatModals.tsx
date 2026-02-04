/**
 * ChatModals - 聊天页面模态框集合
 * 包含：添加联系人、创建群组
 */

import React from 'react';
import { AddContactModal } from '../../components/AddContactModal';
import CreateGroupModal from '../../features/chat/components/CreateGroupModal';

interface ChatModalsProps {
    showAddContactModal: boolean;
    isGroupModalOpen: boolean;
    onCloseAddContact: () => void;
    onCloseGroupModal: () => void;
    onContactAdded: () => void;
    onGroupCreated: () => void;
}

const ChatModals: React.FC<ChatModalsProps> = ({
    showAddContactModal,
    isGroupModalOpen,
    onCloseAddContact,
    onCloseGroupModal,
    onContactAdded,
    onGroupCreated,
}) => {
    return (
        <>
            <AddContactModal
                isOpen={showAddContactModal}
                onClose={onCloseAddContact}
                onContactAdded={onContactAdded}
            />

            <CreateGroupModal
                isOpen={isGroupModalOpen}
                onClose={onCloseGroupModal}
                onGroupCreated={onGroupCreated}
            />
        </>
    );
};

export default ChatModals;
