import * as Comlink from 'comlink';
import { runtimeFlags } from '../chat/runtimeFlags';
import { authUtils } from '../../services/apiClient';
import { resolveChatRuntimePolicy } from '../chat/rolloutPolicy';
import type {
  PreparedAiImage,
  PrepareAiImageOptions,
  PreparedUploadFile,
  PrepareUploadFileOptions,
  UploadPreparedFileOptions,
  UploadedFileResult,
} from '../workers/media.worker';

const currentUserId = authUtils.getCurrentUser()?.id || '';
const runtimePolicy = currentUserId ? resolveChatRuntimePolicy(currentUserId) : null;

type MediaWorkerApi = {
  prepareAiImage(file: File, options?: PrepareAiImageOptions): Promise<PreparedAiImage>;
  prepareUploadFile(file: File, options?: PrepareUploadFileOptions): Promise<PreparedUploadFile>;
  prepareAndUploadFile(
    file: File,
    options: UploadPreparedFileOptions,
  ): Promise<{ prepared: PreparedUploadFile; upload: UploadedFileResult }>;
};

type MediaTaskKind = 'cpu' | 'upload';

type MediaQueuedTask<T> = {
  id: number;
  kind: MediaTaskKind;
  run: (api: Comlink.Remote<MediaWorkerApi>) => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type MediaWorkerSlot = {
  worker: Worker;
  api: Comlink.Remote<MediaWorkerApi>;
  busy: boolean;
  taskId: number | null;
};

class MediaWorkerClient {
  private readonly poolEnabled = runtimePolicy
    ? runtimePolicy.enableMediaWorkerPool
    : runtimeFlags.mediaWorkerPoolEnabled;
  private readonly maxWorkers = this.poolEnabled ? runtimeFlags.mediaWorkerPoolSize : 1;
  private readonly queueLimit = runtimeFlags.mediaWorkerQueueLimit;
  private readonly queueWarnAt = Math.max(8, Math.floor(this.queueLimit * 0.75));
  private readonly maxCpuConcurrent = Math.max(1, Math.floor(this.maxWorkers / 2));
  private readonly maxUploadConcurrent = this.maxWorkers;

  private workers: MediaWorkerSlot[] = [];
  private queue: Array<MediaQueuedTask<any>> = [];
  private nextTaskId = 1;
  private queueWarned = false;
  private shuttingDown = false;
  private inFlightByKind: Record<MediaTaskKind, number> = {
    cpu: 0,
    upload: 0,
  };

  private createWorkerSlot(): MediaWorkerSlot {
    const worker = new Worker(new URL('../workers/media.worker.ts', import.meta.url), {
      type: 'module',
      name: `media-worker-${this.workers.length + 1}`,
    });
    const api = Comlink.wrap<MediaWorkerApi>(worker);
    return {
      worker,
      api,
      busy: false,
      taskId: null,
    };
  }

  private getIdleWorker(): MediaWorkerSlot | null {
    for (const slot of this.workers) {
      if (!slot.busy) return slot;
    }
    if (this.workers.length >= this.maxWorkers) return null;
    const slot = this.createWorkerSlot();
    this.workers.push(slot);
    return slot;
  }

  private canRunKind(kind: MediaTaskKind): boolean {
    if (kind === 'cpu') {
      return this.inFlightByKind.cpu < this.maxCpuConcurrent;
    }
    return this.inFlightByKind.upload < this.maxUploadConcurrent;
  }

  private pickRunnableTaskIndex(): number {
    if (!this.queue.length) return -1;
    for (let i = 0; i < this.queue.length; i += 1) {
      if (this.canRunKind(this.queue[i].kind)) {
        return i;
      }
    }
    return -1;
  }

  private runTask<T>(slot: MediaWorkerSlot, task: MediaQueuedTask<T>): void {
    slot.busy = true;
    slot.taskId = task.id;
    this.inFlightByKind[task.kind] += 1;

    void task
      .run(slot.api)
      .then((result) => {
        task.resolve(result);
      })
      .catch((error) => {
        task.reject(error);
      })
      .finally(() => {
        slot.busy = false;
        slot.taskId = null;
        this.inFlightByKind[task.kind] = Math.max(0, this.inFlightByKind[task.kind] - 1);
        this.pumpQueue();
      });
  }

  private pumpQueue(): void {
    if (this.shuttingDown) return;
    while (this.queue.length > 0) {
      const slot = this.getIdleWorker();
      if (!slot) return;

      const index = this.pickRunnableTaskIndex();
      if (index < 0) return;

      const task = this.queue.splice(index, 1)[0];
      this.runTask(slot, task);
    }

    if (this.queueWarned && this.queue.length < Math.floor(this.queueWarnAt / 2)) {
      this.queueWarned = false;
    }
  }

  private enqueue<T>(
    kind: MediaTaskKind,
    run: (api: Comlink.Remote<MediaWorkerApi>) => Promise<T>,
  ): Promise<T> {
    if (this.shuttingDown) {
      return Promise.reject(new Error('MEDIA_WORKER_SHUTDOWN'));
    }
    if (this.queue.length >= this.queueLimit) {
      return Promise.reject(new Error('MEDIA_WORKER_QUEUE_OVERFLOW'));
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        id: this.nextTaskId++,
        kind,
        run,
        resolve,
        reject,
      });

      if (!this.queueWarned && this.queue.length >= this.queueWarnAt) {
        this.queueWarned = true;
        // eslint-disable-next-line no-console
        console.warn('[media-worker] queue pressure', this.queue.length);
      }

      this.pumpQueue();
    });
  }

  async prepareAiImage(file: File, options?: PrepareAiImageOptions): Promise<PreparedAiImage> {
    return this.enqueue('cpu', (api) => api.prepareAiImage(file, options));
  }

  async prepareUploadFile(file: File, options?: PrepareUploadFileOptions): Promise<PreparedUploadFile> {
    return this.enqueue('cpu', (api) => api.prepareUploadFile(file, options));
  }

  async prepareAndUploadFile(
    file: File,
    options: UploadPreparedFileOptions,
  ): Promise<{ prepared: PreparedUploadFile; upload: UploadedFileResult }> {
    return this.enqueue('upload', (api) => api.prepareAndUploadFile(file, options));
  }

  shutdown(): void {
    this.shuttingDown = true;

    for (const task of this.queue) {
      task.reject(new Error('MEDIA_WORKER_SHUTDOWN'));
    }
    this.queue = [];

    for (const slot of this.workers) {
      try {
        slot.worker.terminate();
      } catch {
        // ignore
      }
    }
    this.workers = [];
    this.inFlightByKind.cpu = 0;
    this.inFlightByKind.upload = 0;
    this.queueWarned = false;
    this.shuttingDown = false;
  }
}

export const mediaWorkerClient = new MediaWorkerClient();
export default mediaWorkerClient;
