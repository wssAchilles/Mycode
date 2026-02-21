import * as Comlink from 'comlink';

export interface PrepareAiImageOptions {
  maxEdge?: number;
  quality?: number;
}

export interface PreparedAiImage {
  base64Data: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function transcodeImage(
  file: File,
  options: PrepareAiImageOptions,
): Promise<{ blob: Blob; width?: number; height?: number }> {
  const maxEdge = clamp(Math.floor(options.maxEdge || 1536), 512, 4096);
  const quality = clamp(typeof options.quality === 'number' ? options.quality : 0.84, 0.5, 0.95);

  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    return { blob: file };
  }

  const bitmap = await createImageBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
  const targetHeight = Math.max(1, Math.round(bitmap.height * scale));

  const preferredType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';

  if (targetWidth === bitmap.width && targetHeight === bitmap.height) {
    bitmap.close();
    return { blob: file, width: bitmap.width, height: bitmap.height };
  }

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d', { alpha: preferredType === 'image/png' });
  if (!ctx) {
    bitmap.close();
    return { blob: file, width: bitmap.width, height: bitmap.height };
  }

  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: preferredType, quality });
  return { blob, width: targetWidth, height: targetHeight };
}

const mediaWorkerApi = {
  async prepareAiImage(file: File, options: PrepareAiImageOptions = {}): Promise<PreparedAiImage> {
    if (!(file instanceof Blob)) {
      throw new Error('INVALID_FILE');
    }
    if (!file.type.startsWith('image/')) {
      throw new Error('UNSUPPORTED_MIME');
    }

    const { blob, width, height } = await transcodeImage(file, options);
    const bytes = await blob.arrayBuffer();
    return {
      base64Data: arrayBufferToBase64(bytes),
      mimeType: blob.type || file.type || 'image/jpeg',
      byteSize: bytes.byteLength,
      width,
      height,
    };
  },
};

Comlink.expose(mediaWorkerApi);
