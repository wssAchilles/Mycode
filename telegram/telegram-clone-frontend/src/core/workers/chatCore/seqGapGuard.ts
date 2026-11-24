/**
 * 会话级消息序列号乱序补洞器（对标 Telegram TDLib / Web A 的 PTS Gap 500ms 修复机制）
 *
 * 当实时推送消息出现 seq 跳跃（minIncoming > prevMaxSeq + 1）时，不立即发起高开销 HTTP 请求，
 * 而是先登记缺失序列集合并等待短时间窗口（默认 500ms）；
 * 若乱序分片在窗口期内补齐，则自动撤除定时器实现零请求闭合；
 * 若超时仍存在空洞，则触发精确的 afterSeq 增量补齐回调。
 */

export interface SeqGapGuardOptions {
  /** 乱序等待窗口，默认 500ms */
  waitMs?: number;
  /** 单次追踪的最大空洞跨度，超过该上限视为长断线，直接交由全量同步处理 */
  maxSpan?: number;
  /** 超时仍存在空洞时的增量拉取回调 */
  onGapTimeout: (chatId: string, afterSeq: number, missingToSeq: number) => void | Promise<void>;
}

interface PendingGapState {
  anchorAfterSeq: number;
  missingToSeq: number;
  missingSeqs: Set<number>;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
}

export class SeqGapGuard {
  private readonly waitMs: number;
  private readonly maxSpan: number;
  private readonly onGapTimeout: SeqGapGuardOptions['onGapTimeout'];
  private readonly pendingByChat = new Map<string, PendingGapState>();

  constructor(options: SeqGapGuardOptions) {
    this.waitMs = typeof options.waitMs === 'number' && options.waitMs >= 0 ? options.waitMs : 500;
    this.maxSpan = typeof options.maxSpan === 'number' && options.maxSpan > 0 ? options.maxSpan : 200;
    this.onGapTimeout = options.onGapTimeout;
  }

  /**
   * 在写入本批实时消息前观察 seq 连续性与空洞补齐情况
   */
  observeIncoming(chatId: string, prevMaxSeq: number | null, incomingSeqs: number[]): void {
    if (!chatId || !Array.isArray(incomingSeqs) || incomingSeqs.length === 0) return;

    const positiveSeqs: number[] = [];
    for (const raw of incomingSeqs) {
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        positiveSeqs.push(Math.floor(raw));
      }
    }
    if (!positiveSeqs.length) return;

    let minIncoming = positiveSeqs[0];
    let maxIncoming = positiveSeqs[0];
    for (const seq of positiveSeqs) {
      if (seq < minIncoming) minIncoming = seq;
      if (seq > maxIncoming) maxIncoming = seq;
    }

    // 1) 若当前会话已有挂起的空洞，尝试用本批到达的 seq 填补
    const existing = this.pendingByChat.get(chatId);
    if (existing) {
      for (const seq of positiveSeqs) {
        existing.missingSeqs.delete(seq);
      }

      // 若本次还出现了更大的跳号区间，一并并入追踪范围
      if (prevMaxSeq !== null && prevMaxSeq > 0 && minIncoming > prevMaxSeq + 1) {
        const span = minIncoming - prevMaxSeq - 1;
        if (span <= this.maxSpan) {
          for (let s = prevMaxSeq + 1; s < minIncoming; s += 1) {
            if (!positiveSeqs.includes(s)) {
              existing.missingSeqs.add(s);
            }
          }
          existing.missingToSeq = Math.max(existing.missingToSeq, minIncoming - 1);
          existing.anchorAfterSeq = Math.min(existing.anchorAfterSeq, prevMaxSeq);
        }
      }

      if (existing.missingSeqs.size === 0) {
        this.clearChat(chatId);
        return;
      }

      // 若原先空洞已收敛到更大连续前沿，同步更新 anchorAfterSeq
      let smallestMissing = existing.missingToSeq;
      for (const s of existing.missingSeqs) {
        if (s < smallestMissing) smallestMissing = s;
      }
      existing.anchorAfterSeq = Math.max(0, smallestMissing - 1);
      return;
    }

    // 2) 仅当会话已有本地 seq 基线时检测跳号空洞，避免首次加载误报
    if (prevMaxSeq === null || prevMaxSeq <= 0) return;
    if (minIncoming <= prevMaxSeq + 1) return;

    const span = minIncoming - prevMaxSeq - 1;
    if (span <= 0 || span > this.maxSpan) return;

    const incomingSet = new Set(positiveSeqs);
    const missingSeqs = new Set<number>();
    for (let seq = prevMaxSeq + 1; seq < minIncoming; seq += 1) {
      if (!incomingSet.has(seq)) {
        missingSeqs.add(seq);
      }
    }
    if (!missingSeqs.size) return;

    const state: PendingGapState = {
      anchorAfterSeq: prevMaxSeq,
      missingToSeq: maxIncoming > minIncoming ? minIncoming - 1 : minIncoming - 1,
      missingSeqs,
      timer: null,
      inFlight: false,
    };

    state.timer = setTimeout(() => {
      void this.flushGap(chatId);
    }, this.waitMs);

    this.pendingByChat.set(chatId, state);
  }

  private async flushGap(chatId: string): Promise<void> {
    const state = this.pendingByChat.get(chatId);
    if (!state || state.inFlight) return;

    state.timer = null;
    if (state.missingSeqs.size === 0) {
      this.pendingByChat.delete(chatId);
      return;
    }

    state.inFlight = true;
    const { anchorAfterSeq, missingToSeq } = state;
    try {
      await this.onGapTimeout(chatId, anchorAfterSeq, missingToSeq);
    } finally {
      // 无论成功或异常，完成本次超时回调后清除状态（后续新跳号重新建窗口）
      if (this.pendingByChat.get(chatId) === state) {
        this.pendingByChat.delete(chatId);
      }
    }
  }

  /**
   * 清理指定会话的补洞定时器与挂起状态
   */
  clearChat(chatId: string): void {
    const state = this.pendingByChat.get(chatId);
    if (!state) return;
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    this.pendingByChat.delete(chatId);
  }

  /**
   * 在 Worker 初始化或关闭时清空全部定时器，防止泄漏
   */
  clearAll(): void {
    for (const state of this.pendingByChat.values()) {
      if (state.timer !== null) {
        clearTimeout(state.timer);
      }
    }
    this.pendingByChat.clear();
  }

  /**
   * 供测试检查当前是否存在挂起空洞
   */
  hasPendingGap(chatId: string): boolean {
    return this.pendingByChat.has(chatId);
  }
}
