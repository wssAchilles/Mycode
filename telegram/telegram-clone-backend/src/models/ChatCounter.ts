import mongoose, { Document, Schema } from 'mongoose';

export interface IChatCounter extends Document {
  _id: string; // chatId
  seq: number;
  updatedAt: Date;
}

const ChatCounterSchema = new Schema<IChatCounter>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
}, {
  timestamps: { createdAt: false, updatedAt: true },
  versionKey: false,
});

const ChatCounter = mongoose.model<IChatCounter>('ChatCounter', ChatCounterSchema);

export default ChatCounter;
