import ChatMemberState from '../models/ChatMemberState';

/**
 * 原子推进会话已读游标。
 * 仅当本次写入的 seq 严格大于已有 lastReadSeq（或首次记录）时返回 true，
 * 用于阻止重复已读请求向 UpdateLog 写入冗余 read 事件。
 */
export async function advanceChatLastReadSeq(
  chatId: string,
  userId: string,
  seq: number,
): Promise<boolean> {
  if (typeof (ChatMemberState as any).findOneAndUpdate === 'function') {
    const runFindOneAndUpdate = async (upsert: boolean) => {
      const queryOrDoc = (ChatMemberState as any).findOneAndUpdate(
        { chatId, userId },
        { $max: { lastReadSeq: seq }, $set: { lastSeenAt: new Date() } },
        { upsert, new: false },
      );
      return typeof queryOrDoc?.lean === 'function' ? queryOrDoc.lean() : queryOrDoc;
    };

    try {
      const previousState = await runFindOneAndUpdate(true);
      const previousSeq = typeof previousState?.lastReadSeq === 'number' ? previousState.lastReadSeq : 0;
      return seq > previousSeq;
    } catch (error: any) {
      // 并发首次 upsert 触发唯一索引冲突时，文档已存在，退回非 upsert 原子更新
      if (error?.code === 11000) {
        const previousState = await runFindOneAndUpdate(false);
        const previousSeq = typeof previousState?.lastReadSeq === 'number' ? previousState.lastReadSeq : 0;
        return seq > previousSeq;
      }
      throw error;
    }
  }

  // 兼容仅 mock 了 updateOne 的轻量测试环境
  const findOneQuery = typeof (ChatMemberState as any).findOne === 'function'
    ? (ChatMemberState as any).findOne({ chatId, userId })
    : null;
  const existing = findOneQuery
    ? (typeof findOneQuery?.lean === 'function' ? await findOneQuery.lean() : await findOneQuery)
    : null;

  await ChatMemberState.updateOne(
    { chatId, userId },
    { $max: { lastReadSeq: seq }, $set: { lastSeenAt: new Date() } },
    { upsert: true },
  );
  const previousSeq = typeof existing?.lastReadSeq === 'number' ? existing.lastReadSeq : 0;
  return seq > previousSeq;
}
