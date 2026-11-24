/**
 * ChatModals - 聊天页面模态框集合
 * 包含：添加联系人与好友申请中心、创建群组弹窗
 */

import React from 'react';
import { AddContactModal, type AddContactModalTab } from '../../components/AddContactModal';
import CreateGroupModal from '../../features/chat/components/CreateGroupModal';

interface ChatModalsProps {
    showAddContactModal: boolean;
    addContactInitialTab?: AddContactModalTab;
    isGroupModalOpen: boolean;
    onCloseAddContact: () => void;
    onCloseGroupModal: () => void;
    onContactAdded: () => void;
    onStartChatWithContact?: (userId: string) => void;
    onOpenAddContactFromGroup?: () => void;
    onGroupCreated: () => void;
}

const ChatModals: React.FC<ChatModalsProps> = ({
    showAddContactModal,
    addContactInitialTab = 'search',
    isGroupModalOpen,
    onCloseAddContact,
    onCloseGroupModal,
    onContactAdded,
    onStartChatWithContact,
    onOpenAddContactFromGroup,
    onGroupCreated,
}) => {
    return (
        <>
            <AddContactModal
                isOpen={showAddContactModal}
                initialTab={addContactInitialTab}
                onClose={onCloseAddContact}
                onContactAdded={onContactAdded}
                onStartChatWithContact={onStartChatWithContact}
            />

            <CreateGroupModal
                isOpen={isGroupModalOpen}
                onClose={onCloseGroupModal}
                onGroupCreated={onGroupCreated}
                onOpenAddContact={onOpenAddContactFromGroup}
            />
        </>
    );
};

export default ChatModals;
