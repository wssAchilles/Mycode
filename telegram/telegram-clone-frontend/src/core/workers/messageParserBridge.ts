/**
 * messageParserBridge - 主线程与 messageParser.worker.ts 的通信桥
 * 提供同步 API，内部通过 Worker 异步处理
 */

interface ParsedEntity {
  type: 'link' | 'mention' | 'hashtag' | 'code';
  text: string;
  start: number;
  end: number;
  url?: string;
}

interface ParsedContent {
  html: string;
  plainText: string;
  hasEmoji: boolean;
  emojiOnlyCount: number;
  entities: ParsedEntity[];
  estimatedHeight: number;
}

interface ParseRequest {
  id: string;
  type: 'parse' | 'batch_parse';
  payload: { text: string } | { messages: Array<{ text: string; messageId: string }> };
}

interface ParseResponse {
  id: string;
  type: 'parse_result' | 'batch_parse_result';
  result: ParsedContent | Record<string, ParsedContent>;
}

type PendingCallback = {
  resolve: (value: ParsedContent | Record<string, ParsedContent>) => void;
  reject: (reason: Error) => void;
};

class MessageParserBridge {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingCallback>();
  private idCounter = 0;
  private initAttempted = false;

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (this.initAttempted) return null;
    this.initAttempted = true;

    try {
      this.worker = new Worker(
        new URL('./messageParser.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (event: MessageEvent<ParseResponse>) => {
        const { id, result } = event.data;
        const cb = this.pending.get(id);
        if (cb) {
          this.pending.delete(id);
          cb.resolve(result);
        }
      };

      this.worker.onerror = (event) => {
        console.error('[messageParserBridge] Worker error:', event);
        for (const [id, cb] of this.pending) {
          cb.reject(new Error('Worker error'));
          this.pending.delete(id);
        }
      };

      return this.worker;
    } catch {
      return null;
    }
  }

  async parse(text: string): Promise<ParsedContent | null> {
    const worker = this.ensureWorker();
    if (!worker) return null;

    const id = `parse_${++this.idCounter}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Parse timeout'));
      }, 5000);

      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result as ParsedContent);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      worker.postMessage({ id, type: 'parse', payload: { text } } as ParseRequest);
    });
  }

  async batchParse(
    messages: Array<{ text: string; messageId: string }>
  ): Promise<Record<string, ParsedContent> | null> {
    const worker = this.ensureWorker();
    if (!worker) return null;

    const id = `batch_${++this.idCounter}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Batch parse timeout'));
      }, 10000);

      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result as Record<string, ParsedContent>);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      worker.postMessage({ id, type: 'batch_parse', payload: { messages } } as ParseRequest);
    });
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const cb of this.pending.values()) {
      cb.reject(new Error('Worker terminated'));
    }
    this.pending.clear();
  }
}

export const messageParserBridge = new MessageParserBridge();
