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

export interface PrepareUploadFileOptions {
  maxEdge?: number;
  quality?: number;
  // Only transcode images above this byte size threshold.
  minBytesForTranscode?: number;
}

export interface PreparedUploadFile {
  blob: Blob;
  fileName: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  transformed: boolean;
}

export interface UploadPreparedFileOptions extends PrepareUploadFileOptions {
  uploadUrl: string;
  authToken?: string | null;
  fieldName?: string;
  requestTimeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
}

export interface UploadedFileResult {
  success: boolean;
  data?: {
    fileUrl?: string;
    fileName?: string;
    fileType?: string;
    fileSize?: number;
    mimeType?: string;
    thumbnailUrl?: string;
    [key: string]: any;
  };
  message?: string;
  status: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shouldRetryUploadStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
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

  async prepareUploadFile(file: File, options: PrepareUploadFileOptions = {}): Promise<PreparedUploadFile> {
    if (!(file instanceof Blob)) {
      throw new Error('INVALID_FILE');
    }

    const minBytesForTranscode = clamp(
      Math.floor(options.minBytesForTranscode || 320 * 1024),
      64 * 1024,
      8 * 1024 * 1024,
    );

    // Non-image uploads should bypass media transforms.
    if (!file.type.startsWith('image/')) {
      return {
        blob: file,
        fileName: typeof (file as any).name === 'string' ? (file as any).name : 'upload.bin',
        mimeType: file.type || 'application/octet-stream',
        byteSize: file.size,
        transformed: false,
      };
    }

    // Small images keep original fidelity and avoid needless CPU.
    if (file.size < minBytesForTranscode) {
      return {
        blob: file,
        fileName: typeof (file as any).name === 'string' ? (file as any).name : 'image',
        mimeType: file.type || 'image/jpeg',
        byteSize: file.size,
        transformed: false,
      };
    }

    const { blob, width, height } = await transcodeImage(file, options);
    return {
      blob,
      fileName: typeof (file as any).name === 'string' ? (file as any).name : 'image',
      mimeType: blob.type || file.type || 'image/jpeg',
      byteSize: blob.size,
      width,
      height,
      transformed: blob !== file,
    };
  },

  async prepareAndUploadFile(
    file: File,
    options: UploadPreparedFileOptions,
  ): Promise<{ prepared: PreparedUploadFile; upload: UploadedFileResult }> {
    if (!options?.uploadUrl || typeof options.uploadUrl !== 'string') {
      throw new Error('UPLOAD_URL_REQUIRED');
    }

    const prepared = await mediaWorkerApi.prepareUploadFile(file, options);
    const uploadName = prepared.fileName || (typeof (file as any).name === 'string' ? (file as any).name : 'upload.bin');
    const fieldName = options.fieldName && options.fieldName.trim() ? options.fieldName.trim() : 'file';
    const requestTimeoutMs = clamp(
      Math.floor(options.requestTimeoutMs ?? 20_000),
      3_000,
      120_000,
    );
    const maxAttempts = clamp(
      Math.floor(options.maxAttempts ?? 3),
      1,
      5,
    );
    const retryBaseDelayMs = clamp(
      Math.floor(options.retryBaseDelayMs ?? 350),
      100,
      3_000,
    );

    const formData = new FormData();
    formData.append(fieldName, prepared.blob, uploadName);

    const headers: Record<string, string> = {};
    if (options.authToken) {
      headers.Authorization = `Bearer ${options.authToken}`;
    }

    let lastFailure: UploadedFileResult = {
      success: false,
      message: 'UPLOAD_FAILED',
      status: 0,
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

      try {
        const response = await fetch(options.uploadUrl, {
          method: 'POST',
          headers,
          body: formData,
          signal: controller.signal,
        });

        let payload: any = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }

        const upload: UploadedFileResult = {
          success: !!payload?.success && response.ok,
          data: payload?.data,
          message: payload?.message,
          status: response.status,
        };

        if (upload.success) {
          clearTimeout(timeout);
          return { prepared, upload };
        }

        lastFailure = upload;
        if (attempt >= maxAttempts || !shouldRetryUploadStatus(response.status)) {
          clearTimeout(timeout);
          return { prepared, upload };
        }
      } catch (error: any) {
        const isAbort = error?.name === 'AbortError';
        lastFailure = {
          success: false,
          status: 0,
          message: isAbort ? 'UPLOAD_TIMEOUT' : 'UPLOAD_NETWORK_ERROR',
        };
        if (attempt >= maxAttempts) {
          clearTimeout(timeout);
          return { prepared, upload: lastFailure };
        }
      } finally {
        clearTimeout(timeout);
      }

      const backoff = retryBaseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * 120);
      await sleepMs(backoff + jitter);
    }

    return { prepared, upload: lastFailure };
  },
};

Comlink.expose(mediaWorkerApi);
