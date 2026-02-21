import * as Comlink from 'comlink';
import type {
  PreparedAiImage,
  PrepareAiImageOptions,
  PreparedUploadFile,
  PrepareUploadFileOptions,
} from '../workers/media.worker';

type MediaWorkerApi = {
  prepareAiImage(file: File, options?: PrepareAiImageOptions): Promise<PreparedAiImage>;
  prepareUploadFile(file: File, options?: PrepareUploadFileOptions): Promise<PreparedUploadFile>;
};

class MediaWorkerClient {
  private worker: Worker | null = null;
  private api: Comlink.Remote<MediaWorkerApi> | null = null;

  private getApi(): Comlink.Remote<MediaWorkerApi> {
    if (this.api) return this.api;

    this.worker = new Worker(new URL('../workers/media.worker.ts', import.meta.url), {
      type: 'module',
      name: 'media-worker',
    });
    this.api = Comlink.wrap<MediaWorkerApi>(this.worker);
    return this.api;
  }

  async prepareAiImage(file: File, options?: PrepareAiImageOptions): Promise<PreparedAiImage> {
    const api = this.getApi();
    return api.prepareAiImage(file, options);
  }

  async prepareUploadFile(file: File, options?: PrepareUploadFileOptions): Promise<PreparedUploadFile> {
    const api = this.getApi();
    return api.prepareUploadFile(file, options);
  }

  shutdown(): void {
    if (this.worker) {
      this.worker.terminate();
    }
    this.worker = null;
    this.api = null;
  }
}

export const mediaWorkerClient = new MediaWorkerClient();
export default mediaWorkerClient;
