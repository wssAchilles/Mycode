import React, { useEffect, useState } from 'react';
import { Download, X, ZoomIn, ZoomOut } from 'lucide-react';
import { withApiBase } from '../../../../utils/apiUrl';
import './ChatImageLightbox.css';

interface ChatImageLightboxProps {
  src: string | null;
  alt?: string;
  fileName?: string;
  onClose: () => void;
}

export const ChatImageLightbox: React.FC<ChatImageLightboxProps> = ({
  src,
  alt = '聊天图片预览',
  fileName,
  onClose,
}) => {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    setZoomed(false);
  }, [src]);

  useEffect(() => {
    if (!src || typeof window === 'undefined') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [src, onClose]);

  if (!src) return null;

  const resolvedSrc = withApiBase(src) || src;

  return (
    <div
      className="chat-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="图片大图查看"
      onClick={onClose}
    >
      <div className="chat-lightbox__toolbar" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="chat-lightbox__btn"
          onClick={() => setZoomed((prev) => !prev)}
          aria-label={zoomed ? '还原图片尺寸' : '放大查看图片'}
          title={zoomed ? '还原大小' : '放大图片'}
        >
          {zoomed ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
        </button>
        <a
          href={resolvedSrc}
          download={fileName || 'chat-image'}
          target="_blank"
          rel="noopener noreferrer"
          className="chat-lightbox__btn"
          aria-label="下载原图"
          title="下载原图"
        >
          <Download size={18} />
        </a>
        <button
          type="button"
          className="chat-lightbox__btn"
          onClick={onClose}
          aria-label="关闭大图预览"
          title="关闭 (Esc)"
        >
          <X size={18} />
        </button>
      </div>

      <div className="chat-lightbox__stage" onClick={(e) => e.stopPropagation()}>
        <img
          src={resolvedSrc}
          alt={alt}
          className={`chat-lightbox__img ${zoomed ? 'is-zoomed' : ''}`}
          onClick={() => setZoomed((prev) => !prev)}
        />
      </div>
    </div>
  );
};

export default ChatImageLightbox;
