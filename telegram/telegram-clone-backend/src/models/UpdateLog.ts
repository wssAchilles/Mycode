import mongoose, { Document, Schema } from 'mongoose';

export type UpdateType = 'message' | 'read' | 'delivered' | 'member_change' | 'system';

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

const UpdateLog = mongoose.model<IUpdateLog>('UpdateLog', UpdateLogSchema);

export default UpdateLog;
