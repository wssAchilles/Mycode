import React from 'react';
import { Download } from 'lucide-react';
import type { Message } from '../../../../types/chat';
import { FileTypeIcon, getFileIconType } from '../../../../components/icons/FileTypeIcon';
import { withApiBase } from '../../../../utils/apiUrl';
import './ChatAttachmentCard.css';

interface ChatAttachmentCardProps {
  message: Message;
}

function formatAttachmentSize(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '未知大小';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ChatAttachmentCard: React.FC<ChatAttachmentCardProps> = ({ message }) => {
  const firstAttachment = message.attachments?.[0];
  const rawUrl = message.fileUrl || firstAttachment?.fileUrl || '';
  const resolvedUrl = withApiBase(rawUrl) || rawUrl;
  const fileName = message.fileName || firstAttachment?.fileName || message.content || '附件文件';
  const fileSize = message.fileSize ?? firstAttachment?.fileSize;
  const mimeType = message.mimeType || firstAttachment?.mimeType || '';

  if (message.type === 'video' && resolvedUrl) {
    return (
      <video
        controls
        preload="metadata"
        src={resolvedUrl}
        className="chat-attachment-media__video"
      >
        当前浏览器不支持视频播放
      </video>
    );
  }

  if (message.type === 'audio' && resolvedUrl) {
    return (
      <audio
        controls
        preload="metadata"
        src={resolvedUrl}
        className="chat-attachment-media__audio"
      >
        当前浏览器不支持音频播放
      </audio>
    );
  }

  return (
    <div className="chat-attachment-card">
      <div className="chat-attachment-card__icon" aria-hidden="true">
        <FileTypeIcon type={getFileIconType(fileName, mimeType)} size={28} />
      </div>
      <div className="chat-attachment-card__info">
        <span className="chat-attachment-card__name" title={fileName}>
          {fileName}
        </span>
        <span className="chat-attachment-card__size">{formatAttachmentSize(fileSize)}</span>
      </div>
      {resolvedUrl && (
        <a
          href={resolvedUrl}
          download={fileName}
          target="_blank"
          rel="noopener noreferrer"
          className="chat-attachment-card__download"
          aria-label={`下载 ${fileName}`}
          title="下载文件"
          onClick={(e) => e.stopPropagation()}
        >
          <Download size={15} />
        </a>
      )}
    </div>
  );
};

export default ChatAttachmentCard;
