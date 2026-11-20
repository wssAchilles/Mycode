export interface CompressImageOptions {
    maxWidth: number;
    maxHeight: number;
    quality?: number;
}

/**
 * 浏览器端上传前压缩与分辨率限制（优先 WebP，其次 JPEG）
 * 用于避免用户上传数 MB 级 4K PNG 封面/头像导致首屏下载缓慢
 */
export async function compressImageForUpload(
    file: File,
    options: CompressImageOptions
): Promise<File> {
    if (typeof document === 'undefined' || !file.type.startsWith('image/')) {
        return file;
    }
    // GIF / SVG 不走栅格重编码，避免破坏动图或矢量清晰度
    if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
        return file;
    }

    const { maxWidth, maxHeight, quality = 0.86 } = options;

    try {
        const loaded = await loadImageSource(file);
        const { width, height, source, cleanup } = loaded;

        try {
            const scale = Math.min(1, maxWidth / width, maxHeight / height);
            const targetWidth = Math.max(1, Math.round(width * scale));
            const targetHeight = Math.max(1, Math.round(height * scale));

            // 若尺寸已达标且体积较小（<= 220KB）且非 PNG 大图，直接原样上传
            if (scale === 1 && file.size <= 220 * 1024 && file.type !== 'image/png') {
                return file;
            }

            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return file;
            }

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

            const webpBlob = await canvasToBlob(canvas, 'image/webp', quality);
            const outputBlob =
                webpBlob && webpBlob.type === 'image/webp'
                    ? webpBlob
                    : await canvasToBlob(canvas, 'image/jpeg', quality);

            if (!outputBlob || outputBlob.size >= file.size) {
                return file;
            }

            const ext = outputBlob.type === 'image/webp' ? 'webp' : 'jpg';
            const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
            return new File([outputBlob], `${baseName}.${ext}`, {
                type: outputBlob.type,
                lastModified: Date.now(),
            });
        } finally {
            cleanup();
        }
    } catch {
        return file;
    }
}

interface LoadedImageSource {
    width: number;
    height: number;
    source: CanvasImageSource;
    cleanup: () => void;
}

async function loadImageSource(file: File): Promise<LoadedImageSource> {
    if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(file);
        return {
            width: bitmap.width,
            height: bitmap.height,
            source: bitmap,
            cleanup: () => bitmap.close(),
        };
    }

    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error('Image decode failed'));
            element.src = url;
        });
        return {
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height,
            source: img,
            cleanup: () => URL.revokeObjectURL(url),
        };
    } catch (err) {
        URL.revokeObjectURL(url);
        throw err;
    }
}

function canvasToBlob(
    canvas: HTMLCanvasElement,
    mimeType: string,
    quality: number
): Promise<Blob | null> {
    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), mimeType, quality);
    });
}
