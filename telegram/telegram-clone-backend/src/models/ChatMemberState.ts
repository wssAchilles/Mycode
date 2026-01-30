import mongoose, { Document, Schema } from 'mongoose';

export interface IChatMemberState extends Document {
  chatId: string;
  userId: string;
  lastReadSeq: number;
  lastDeliveredSeq: number;
  lastSeenAt?: Date;
  mutedUntil?: Date;
  role?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ChatMemberStateSchema = new Schema<IChatMemberState>({
  chatId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  lastReadSeq: { type: Number, default: 0 },
  lastDeliveredSeq: { type: Number, default: 0 },
  lastSeenAt: { type: Date, default: null },
  mutedUntil: { type: Date, default: null },
  role: { type: String, default: null },
}, {
  timestamps: true,
  versionKey: false,
});

ChatMemberStateSchema.index({ chatId: 1, userId: 1 }, { unique: true });

const ChatMemberState = mongoose.model<IChatMemberState>('ChatMemberState', ChatMemberStateSchema);

export default ChatMemberState;
