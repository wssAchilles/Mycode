import mongoose, { Document, Schema } from 'mongoose';

export type UpdateType =
  | 'message'
  | 'read'
  | 'delivered'
  | 'member_change'
  | 'contact_change'
  | 'message_edit'
  | 'message_delete'
  | 'social_notification'
  | 'system';

export interface IUpdateLog extends Document {
  userId: string;
  updateId: number;
  type: UpdateType;
  chatId: string;
  seq?: number;
  messageId?: string;
  payload?: Record<string, any>;
  createdAt: Date;
}

const UpdateLogSchema = new Schema<IUpdateLog>({
  userId: { type: String, required: true, index: true },
  updateId: { type: Number, required: true },
  type: { type: String, required: true },
  chatId: { type: String, required: true },
  seq: { type: Number, default: null },
  messageId: { type: String, default: null },
  payload: { type: Schema.Types.Mixed, default: null },
}, {
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false,
});

UpdateLogSchema.index({ userId: 1, updateId: 1 }, { unique: true });
// 支撑扇出投影按用户+类型+会话+消息 ID 的幂等去重检索，消除历史全表扫描
UpdateLogSchema.index({ userId: 1, type: 1, chatId: 1, messageId: 1 });

const UpdateLog = mongoose.model<IUpdateLog>('UpdateLog', UpdateLogSchema);

export default UpdateLog;
