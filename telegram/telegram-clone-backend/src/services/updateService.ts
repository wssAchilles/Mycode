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
    await Promise.all(
      userIds.map((userId) =>
        this.appendUpdate({
          userId,
          ...params,
        })
      )
    );
  }

  async getUpdates(userId: string, fromUpdateId: number, limit: number = 100): Promise<{ updates: any[]; lastUpdateId: number }> {
    const updates = await UpdateLog.find({
      userId,
      updateId: { $gt: fromUpdateId },
    })
      .sort({ updateId: 1 })
      .limit(limit)
      .lean();

    const lastUpdateId = updates.length ? updates[updates.length - 1].updateId : fromUpdateId;
    return { updates, lastUpdateId };
  }
}

export const updateService = new UpdateService();
export default updateService;
