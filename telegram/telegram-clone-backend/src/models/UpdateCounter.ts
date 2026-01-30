import mongoose, { Document, Schema } from 'mongoose';

export interface IUpdateCounter extends Document {
  _id: string; // userId
  updateId: number;
  updatedAt: Date;
}

const UpdateCounterSchema = new Schema<IUpdateCounter>({
  _id: { type: String, required: true },
  updateId: { type: Number, default: 0 },
}, {
  timestamps: { createdAt: false, updatedAt: true },
  versionKey: false,
});

const UpdateCounter = mongoose.model<IUpdateCounter>('UpdateCounter', UpdateCounterSchema);

export default UpdateCounter;
