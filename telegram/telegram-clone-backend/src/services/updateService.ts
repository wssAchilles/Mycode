import UpdateCounter from '../models/UpdateCounter';
import UpdateLog, { UpdateType } from '../models/UpdateLog';

interface AppendUpdateParams {
  userId: string;
  type: UpdateType;
  chatId: string;
  seq?: number;
  messageId?: string;
  payload?: Record<string, any>;
}

class UpdateService {
  private normalizeLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) return 100;
    return Math.min(Math.max(Math.floor(limit), 1), 200);
  }

  async getUpdateId(userId: string): Promise<number> {
    const doc = await UpdateCounter.findById(userId).lean();
    return doc?.updateId || 0;
  }

  async incrementUpdateId(userId: string, count: number = 1): Promise<number> {
    const doc = await UpdateCounter.findOneAndUpdate(
      { _id: userId },
      { $inc: { updateId: count } },
      { upsert: true, new: true }
    ).lean();
    return doc?.updateId || count;
  }

  async appendUpdate(params: AppendUpdateParams): Promise<number> {
    const updateId = await this.incrementUpdateId(params.userId, 1);
    await UpdateLog.create({
      userId: params.userId,
      updateId,
      type: params.type,
      chatId: params.chatId,
      seq: params.seq,
      messageId: params.messageId,
      payload: params.payload || null,
    });
    return updateId;
  }

  async appendUpdates(userIds: string[], params: Omit<AppendUpdateParams, 'userId'>): Promise<void> {
    if (!userIds.length) return;
    const deduped = Array.from(new Set(userIds.filter(Boolean)));
    if (!deduped.length) return;

    // Keep write pressure bounded under large fanout bursts.
    const chunkSize = 200;
    for (let i = 0; i < deduped.length; i += chunkSize) {
      const chunk = deduped.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map((userId) =>
          this.appendUpdate({
            userId,
            ...params,
          }),
        ),
      );
    }
  }

  async getUpdates(userId: string, fromUpdateId: number, limit: number = 100): Promise<{ updates: any[]; lastUpdateId: number }> {
    const normalizedLimit = this.normalizeLimit(limit);
    const normalizedFrom = Number.isFinite(fromUpdateId) && fromUpdateId >= 0 ? fromUpdateId : 0;

    const updates = await UpdateLog.find({
      userId,
      updateId: { $gt: normalizedFrom },
    })
      .sort({ updateId: 1 })
      .limit(normalizedLimit)
      .lean();

    const lastUpdateId = updates.length ? updates[updates.length - 1].updateId : normalizedFrom;
    return { updates, lastUpdateId };
  }
}

export const updateService = new UpdateService();
export default updateService;
