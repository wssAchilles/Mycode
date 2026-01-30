/**
 * ChatDetailPanel - 联系人详情面板
 * 包含：用户信息、共享媒体、设置操作
 */

import React from 'react';
import { DetailPanel, DetailSection } from '../../components/layout';
import { Avatar } from '../../components/common';

interface SelectedContact {
    userId: string;
    username: string;
    alias?: string;
    avatarUrl?: string;
}

interface ChatDetailPanelProps {
    isOpen: boolean;
    onClose: () => void;
    selectedContact: SelectedContact | null;
}

const ChatDetailPanel: React.FC<ChatDetailPanelProps> = ({
    isOpen,
    onClose,
    selectedContact,
}) => {
    return (
        <DetailPanel
            isOpen={isOpen}
            onClose={onClose}
            title="详细信息"
        >
            {selectedContact && (
                <>
                    <div className="detail-panel-user">
                        <Avatar
                            src={selectedContact.avatarUrl}
                            name={selectedContact.alias || selectedContact.username}
                            size="lg"
                        />
                        <h2 className="detail-user-name">
                            {selectedContact.alias || selectedContact.username}
                        </h2>
                        <p className="detail-user-handle">@{selectedContact.username}</p>
                    </div>

                    <DetailSection title="共享媒体" collapsible defaultCollapsed>
                        <div className="detail-empty-media">暂无媒体文件</div>
                    </DetailSection>

                    <DetailSection title="设置" collapsible>
                        <div className="detail-settings-container">
                            <div className="detail-settings-action">删除联系人</div>
                            <div className="detail-settings-action">屏蔽用户</div>
                        </div>
                    </DetailSection>
                </>
            )}
        </DetailPanel>
    );
};

export default ChatDetailPanel;
