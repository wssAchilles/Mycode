import { z } from 'zod';

export const OFFLINE_REWARD_HEADS_V1 = [
  'click',
  'like',
  'reply',
  'repost',
  'quote',
  'share',
  'dismiss',
  'blockAuthor',
  'report',
  'dwell',
] as const;

export type OfflineRewardHeadV1 = typeof OFFLINE_REWARD_HEADS_V1[number];

const probability = z.number().finite().min(0).max(1);

export const offlinePrimitivePredictionsSchema = z.object(
  Object.fromEntries(OFFLINE_REWARD_HEADS_V1.map((head) => [head, probability])) as {
    [Head in OfflineRewardHeadV1]: typeof probability;
  },
).strict();

export type OfflinePrimitivePredictionsV1 = z.infer<
  typeof offlinePrimitivePredictionsSchema
>;

export const offlineObservedLabelsSchema = z.object({
  click: z.boolean(),
  like: z.boolean(),
  reply: z.boolean(),
  repost: z.boolean(),
  quote: z.boolean(),
  share: z.boolean(),
  dismiss: z.boolean(),
  blockAuthor: z.boolean(),
  report: z.boolean(),
  dwellTimeMs: z.number().finite().nonnegative(),
}).strict();

export type OfflineObservedLabelsV1 = z.infer<typeof offlineObservedLabelsSchema>;

export function encodeOfflineLabelsV1(
  labels: OfflineObservedLabelsV1,
  dwellCapMs: number,
): Record<OfflineRewardHeadV1, number> {
  if (!Number.isFinite(dwellCapMs) || dwellCapMs <= 0) {
    throw new Error('invalid_dwell_cap');
  }
  return {
    click: labels.click ? 1 : 0,
    like: labels.like ? 1 : 0,
    reply: labels.reply ? 1 : 0,
    repost: labels.repost ? 1 : 0,
    quote: labels.quote ? 1 : 0,
    share: labels.share ? 1 : 0,
    dismiss: labels.dismiss ? 1 : 0,
    blockAuthor: labels.blockAuthor ? 1 : 0,
    report: labels.report ? 1 : 0,
    dwell: Math.min(labels.dwellTimeMs, dwellCapMs) / dwellCapMs,
  };
}
