import mongoose, { Schema, Document } from 'mongoose';

export interface IChannelSyncState {
  userId: string;
  chatId: string;
  pts: number;
  lastUpdatedAt: Date;
}

export interface IChannelSyncStateDocument extends IChannelSyncState, Document {}

const ChannelSyncStateSchema = new Schema<IChannelSyncStateDocument>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    chatId: {
      type: String,
      required: true,
    },
    pts: {
      type: Number,
      required: true,
      default: 0,
    },
    lastUpdatedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  }
);

// Compound index for efficient queries
ChannelSyncStateSchema.index({ userId: 1, chatId: 1 }, { unique: true });
ChannelSyncStateSchema.index({ userId: 1, pts: -1 });

const ChannelSyncState = mongoose.model<IChannelSyncStateDocument>(
  'ChannelSyncState',
  ChannelSyncStateSchema
);

export default ChannelSyncState;
