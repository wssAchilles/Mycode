import { useState, useRef, useEffect, useCallback } from 'react';
import './ProgressiveImage.css';

interface ProgressiveImageProps {
  src: string;
  thumbnailSrc?: string;
  alt: string;
  className?: string;
}

type LoadPhase = 'placeholder' | 'thumbnail' | 'full';

export function ProgressiveImage({ src, thumbnailSrc, alt, className }: ProgressiveImageProps) {
  const [phase, setPhase] = useState<LoadPhase>(thumbnailSrc ? 'placeholder' : 'full');
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleThumbnailLoad = useCallback(() => {
    setPhase('thumbnail');
  }, []);

  const handleFullLoad = useCallback(() => {
    setPhase('full');
  }, []);

  const handleError = useCallback(() => {
    setPhase('full');
  }, []);

  const showThumbnail = phase !== 'full' && !!thumbnailSrc;
  const showFull = isVisible && phase !== 'placeholder';

  return (
    <div ref={containerRef} className={`progressive-image ${className ?? ''}`}>
      {showThumbnail && (
        <img
          src={thumbnailSrc}
          alt={alt}
          className="progressive-image__thumbnail"
          onLoad={handleThumbnailLoad}
          onError={handleError}
        />
      )}
      {showFull && (
        <img
          src={src}
          alt={alt}
          className={`progressive-image__full ${phase === 'full' ? 'progressive-image__full--loaded' : ''}`}
          loading="lazy"
          decoding="async"
          onLoad={handleFullLoad}
          onError={handleError}
        />
      )}
    </div>
  );
}
