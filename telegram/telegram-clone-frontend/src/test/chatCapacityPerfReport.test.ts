import { describe, expect, it } from 'vitest';
import { ChatCoreStore } from '../core/chat/store/chatCoreStore';
import type { Message } from '../types/chat';

type CapacityRoundResult = {
  round: number;
  totalDurationMs: number;
  mergeBatchP95Ms: number;
  mergeBatchP99Ms: number;
  trimBatchP95Ms: number;
  rollingBatchP95Ms: number;
  rollingBatchP99Ms: number;
  maxBatchMs: number;
  finalWindowSize: number;
  finalMinSeq: number;
  finalMaxSeq: number;
  smoothPass: boolean;
  usablePass: boolean;
};

type CapacityPerfReport = {
  runAt: string;
  profile: {
    rounds: number;
    totalMessages: number;
    hotWindowSize: number;
    batchSize: number;
  };
  budgets: {
    smoothBatchP95Ms: number;
    usableTotalMs: number;
  };
  rounds: CapacityRoundResult[];
  summary: {
    roundsCompleted: number;
    smoothBatchP95MedianMs: number;
    smoothBatchP99MedianMs: number;
    totalRoundMedianMs: number;
    maxBatchObservedMs: number;
    smoothPassRate: number;
    usablePassRate: number;
    integrityPassRate: number;
    status: 'pass' | 'fail';
  };
};

const REPORT_MARKER = 'CHAT_CAPACITY_REPORT::';

function parseIntEnv(name: string, fallback: number): number {
  const raw = Number.parseInt(String((import.meta as any).env?.[name] ?? ''), 10);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return raw;
}

function parseFloatEnv(name: string, fallback: number): number {
  const raw = Number.parseFloat(String((import.meta as any).env?.[name] ?? ''));
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return raw;
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = values
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
}

function makeMessage(chatId: string, seq: number): Message {
  return {
    id: `n4-${seq}`,
    chatId,
    chatType: 'private',
    content: `load-${seq}`,
    senderId: 'u:bench',
    senderUsername: 'bench',
    userId: 'u:bench',
    username: 'bench',
    receiverId: 'u:target',
    timestamp: new Date(1_700_000_000_000 + seq).toISOString(),
    type: 'text',
    isGroupChat: false,
    status: 'delivered',
    seq,
  };
}

function runSingleRound(
  round: number,
  totalMessages: number,
  hotWindowSize: number,
  batchSize: number,
  smoothBatchP95BudgetMs: number,
  usableTotalBudgetMs: number,
): CapacityRoundResult {
  const chatId = 'p:u:bench:u:target';
  const store = new ChatCoreStore(30);
  const mergeDurations: number[] = [];
  const trimDurations: number[] = [];
  const rollingDurations: number[] = [];
  const startedAt = performance.now();

  for (let start = 1; start <= totalMessages; start += batchSize) {
    const end = Math.min(totalMessages, start + batchSize - 1);
    const batch: Message[] = [];
    for (let seq = start; seq <= end; seq += 1) {
      batch.push(makeMessage(chatId, seq));
    }

    // Inject controlled out-of-order pressure to mimic diff/reconnect replay merges.
    if (((Math.floor(start / batchSize) + round) % 4) === 1) {
      batch.reverse();
    }

    const t0 = performance.now();
    store.mergeMessages(chatId, false, batch);
    const mergeMs = performance.now() - t0;
    mergeDurations.push(mergeMs);

    const state = store.getOrCreate(chatId, false);
    let trimMs = 0;
    if (state.messages.length > hotWindowSize) {
      const t1 = performance.now();
      store.trimOldest(chatId, hotWindowSize);
      trimMs = performance.now() - t1;
      trimDurations.push(trimMs);
    }

    rollingDurations.push(mergeMs + trimMs);
  }

  const totalDurationMs = performance.now() - startedAt;
  const final = store.getOrCreate(chatId, false);
  const finalMinSeq = final.messages[0]?.seq || 0;
  const finalMaxSeq = final.messages[final.messages.length - 1]?.seq || 0;
  const integrityPass =
    final.messages.length === hotWindowSize &&
    finalMinSeq === totalMessages - hotWindowSize + 1 &&
    finalMaxSeq === totalMessages;

  const mergeBatchP95Ms = quantile(mergeDurations, 0.95);
  const mergeBatchP99Ms = quantile(mergeDurations, 0.99);
  const trimBatchP95Ms = quantile(trimDurations, 0.95);
  const rollingBatchP95Ms = quantile(rollingDurations, 0.95);
  const rollingBatchP99Ms = quantile(rollingDurations, 0.99);
  const maxBatchMs = quantile(rollingDurations, 1);

  return {
    round,
    totalDurationMs,
    mergeBatchP95Ms,
    mergeBatchP99Ms,
    trimBatchP95Ms,
    rollingBatchP95Ms,
    rollingBatchP99Ms,
    maxBatchMs,
    finalWindowSize: final.messages.length,
    finalMinSeq,
    finalMaxSeq,
    smoothPass: integrityPass && rollingBatchP95Ms <= smoothBatchP95BudgetMs,
    usablePass: integrityPass && totalDurationMs <= usableTotalBudgetMs,
  };
}

describe('capacity perf report (10k smooth / 50k usable)', () => {
  it('emits benchmark payload for N4 automation pipeline', () => {
    const rounds = parseIntEnv('CAPACITY_PERF_ROUNDS', 5);
    const totalMessages = parseIntEnv('CAPACITY_PERF_TOTAL_MESSAGES', 50_000);
    const hotWindowSize = parseIntEnv('CAPACITY_PERF_HOT_WINDOW', 10_000);
    const batchSize = parseIntEnv('CAPACITY_PERF_BATCH_SIZE', 1_000);
    const smoothBatchP95BudgetMs = parseFloatEnv('PERF_BUDGET_CAPACITY_SMOOTH_BATCH_P95_MS', 18);
    const usableTotalBudgetMs = parseFloatEnv('PERF_BUDGET_CAPACITY_USABLE_TOTAL_MS', 7_000);

    const roundResults: CapacityRoundResult[] = [];
    for (let round = 1; round <= rounds; round += 1) {
      roundResults.push(
        runSingleRound(
          round,
          totalMessages,
          hotWindowSize,
          batchSize,
          smoothBatchP95BudgetMs,
          usableTotalBudgetMs,
        ),
      );
    }

    const smoothP95Values = roundResults.map((item) => item.rollingBatchP95Ms);
    const smoothP99Values = roundResults.map((item) => item.rollingBatchP99Ms);
    const totalValues = roundResults.map((item) => item.totalDurationMs);
    const maxBatchObservedMs = roundResults.length
      ? Math.max(...roundResults.map((item) => item.maxBatchMs))
      : 0;

    const smoothPassRate = roundResults.length
      ? roundResults.filter((item) => item.smoothPass).length / roundResults.length
      : 0;
    const usablePassRate = roundResults.length
      ? roundResults.filter((item) => item.usablePass).length / roundResults.length
      : 0;
    const integrityPassRate = roundResults.length
      ? roundResults.filter(
        (item) =>
          item.finalWindowSize === hotWindowSize &&
          item.finalMinSeq === totalMessages - hotWindowSize + 1 &&
          item.finalMaxSeq === totalMessages,
      ).length / roundResults.length
      : 0;

    const report: CapacityPerfReport = {
      runAt: new Date().toISOString(),
      profile: {
        rounds,
        totalMessages,
        hotWindowSize,
        batchSize,
      },
      budgets: {
        smoothBatchP95Ms: smoothBatchP95BudgetMs,
        usableTotalMs: usableTotalBudgetMs,
      },
      rounds: roundResults,
      summary: {
        roundsCompleted: roundResults.length,
        smoothBatchP95MedianMs: quantile(smoothP95Values, 0.5),
        smoothBatchP99MedianMs: quantile(smoothP99Values, 0.5),
        totalRoundMedianMs: quantile(totalValues, 0.5),
        maxBatchObservedMs,
        smoothPassRate,
        usablePassRate,
        integrityPassRate,
        status:
          integrityPassRate === 1 && smoothPassRate === 1 && usablePassRate === 1
            ? 'pass'
            : 'fail',
      },
    };

    expect(report.summary.roundsCompleted).toBe(rounds);
    expect(report.summary.integrityPassRate).toBe(1);
    expect(report.summary.smoothBatchP95MedianMs).toBeGreaterThan(0);
    expect(report.summary.totalRoundMedianMs).toBeGreaterThan(0);

    // Picked up by scripts/run-chat-capacity-perf.mjs for file output + CI assertions.
    // eslint-disable-next-line no-console
    console.log(`${REPORT_MARKER}${JSON.stringify(report)}`);
  });
});
