import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { withApiBase } from '../../../../utils/apiUrl';
import './ChatImageLightbox.css';

export interface LightboxMediaItem {
  id?: string;
  src: string;
  fileName?: string;
}

interface ChatImageLightboxProps {
  src: string | null;
  alt?: string;
  fileName?: string;
  items?: LightboxMediaItem[];
  initialIndex?: number;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 3;

export const ChatImageLightbox: React.FC<ChatImageLightboxProps> = ({
  src,
  alt = '图片大图预览',
  fileName,
  items,
  initialIndex = 0,
  onClose,
}) => {
  const gallery: LightboxMediaItem[] = items && items.length > 0
    ? items
    : src
      ? [{ src, fileName }]
      : [];

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setCurrentIndex(Math.max(0, Math.min(initialIndex, Math.max(0, gallery.length - 1))));
    setScale(1);
  }, [src, initialIndex, gallery.length]);

  const isOpen = gallery.length > 0 && (Boolean(src) || (items && items.length > 0));
  const safeIndex = Math.max(0, Math.min(currentIndex, Math.max(0, gallery.length - 1)));
  const activeItem = gallery[safeIndex];
  const hasMultiple = gallery.length > 1;

  const goPrev = () => {
    if (!hasMultiple) return;
    setScale(1);
    setCurrentIndex((prev) => (prev - 1 + gallery.length) % gallery.length);
  };

  const goNext = () => {
    if (!hasMultiple) return;
    setScale(1);
    setCurrentIndex((prev) => (prev + 1) % gallery.length);
  };

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (hasMultiple && event.key === 'ArrowLeft') {
        event.preventDefault();
        setScale(1);
        setCurrentIndex((prev) => (prev - 1 + gallery.length) % gallery.length);
        return;
      }
      if (hasMultiple && event.key === 'ArrowRight') {
        event.preventDefault();
        setScale(1);
        setCurrentIndex((prev) => (prev + 1) % gallery.length);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [gallery.length, hasMultiple, isOpen, onClose]);

  if (!isOpen || !activeItem) return null;

  const resolvedSrc = withApiBase(activeItem.src) || activeItem.src;
  const activeName = activeItem.fileName || fileName;
  const isZoomed = scale > 1.05;

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const delta = event.deltaY < 0 ? 0.2 : -0.2;
    setScale((prev) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number((prev + delta).toFixed(2)))));
  };

  return (
    <div
      className="chat-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="图片大图查看"
      onClick={onClose}
    >
      <div className="chat-lightbox__topbar" onClick={(e) => e.stopPropagation()}>
        <div className="chat-lightbox__meta">
          {hasMultiple && (
            <span className="chat-lightbox__counter">
              {safeIndex + 1} / {gallery.length}
            </span>
          )}
          {activeName && <span className="chat-lightbox__filename">{activeName}</span>}
        </div>

        <div className="chat-lightbox__toolbar">
          <button
            type="button"
            className="chat-lightbox__btn"
            onClick={() => setScale((prev) => Math.max(MIN_SCALE, Number((prev - 0.5).toFixed(2))))}
            disabled={scale <= MIN_SCALE}
            aria-label="缩小图片"
            title="缩小"
          >
            <ZoomOut size={18} />
          </button>
          <button
            type="button"
            className="chat-lightbox__btn"
            onClick={() => setScale((prev) => Math.min(MAX_SCALE, Number((prev + 0.5).toFixed(2))))}
            disabled={scale >= MAX_SCALE}
            aria-label="放大图片"
            title="放大"
          >
            <ZoomIn size={18} />
          </button>
          {isZoomed && (
            <button
              type="button"
              className="chat-lightbox__btn"
              onClick={() => setScale(1)}
              aria-label="重置缩放"
              title="还原尺寸"
            >
              <RotateCcw size={17} />
            </button>
          )}
          <a
            href={resolvedSrc}
            download={activeName || 'image'}
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
      </div>

      {hasMultiple && (
        <button
          type="button"
          className="chat-lightbox__nav chat-lightbox__nav--prev"
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          aria-label="上一张图片"
          title="上一张 (←)"
        >
          <ChevronLeft size={24} />
        </button>
      )}

      <div
        className="chat-lightbox__stage"
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
      >
        <img
          src={resolvedSrc}
          alt={activeName || alt}
          className={`chat-lightbox__img ${isZoomed ? 'is-zoomed' : ''}`}
          style={{ transform: `scale(${scale})` }}
          onDoubleClick={() => setScale((prev) => (prev > 1.05 ? 1 : 2))}
          onClick={() => setScale((prev) => (prev > 1.05 ? 1 : 1.75))}
        />
      </div>

      {hasMultiple && (
        <button
          type="button"
          className="chat-lightbox__nav chat-lightbox__nav--next"
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          aria-label="下一张图片"
          title="下一张 (→)"
        >
          <ChevronRight size={24} />
        </button>
      )}

      {hasMultiple && (
        <div className="chat-lightbox__strip" onClick={(e) => e.stopPropagation()}>
          {gallery.map((item, idx) => {
            const thumbSrc = withApiBase(item.src) || item.src;
            return (
              <button
                key={item.id || `${item.src}-${idx}`}
                type="button"
                className={`chat-lightbox__thumb ${idx === safeIndex ? 'is-active' : ''}`}
                onClick={() => {
                  setScale(1);
                  setCurrentIndex(idx);
                }}
                aria-label={`查看第 ${idx + 1} 张图片`}
              >
                <img src={thumbSrc} alt="" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ChatImageLightbox;
