import mongoose, { Document, Schema } from 'mongoose';
import type {
  ChatDeliveryChunkStatus,
  ChatDeliveryDispatchMode,
  ChatDeliveryOutboxStatus,
  FanoutTopology,
} from '../services/chatDelivery/contracts';

export interface IChatDeliveryOutboxChunk {
  chunkIndex: number;
  recipientIds: string[];
  status: ChatDeliveryChunkStatus;
  jobId?: string | null;
  attemptCount: number;
  lastAttemptAt?: Date | null;
  lastErrorMessage?: string | null;
  projection?: {
    recipientCount: number;
    chunkCount: number;
  } | null;
}

export interface IChatDeliveryOutbox extends Document {
  messageId: string;
  chatId: string;
  chatType: 'private' | 'group';
  seq: number;
  senderId: string;
  emittedAt: Date;
  topology: FanoutTopology;
  dispatchMode: ChatDeliveryDispatchMode | null;
  status: ChatDeliveryOutboxStatus;
  totalRecipientCount: number;
  chunkCountExpected: number;
  queuedChunkCount: number;
  completedChunkCount: number;
  failedChunkCount: number;
  projectedRecipientCount: number;
  projectedChunkCount: number;
  replayCount: number;
  queuedJobIds: string[];
  lastDispatchedAt?: Date | null;
  lastCompletedAt?: Date | null;
  lastErrorMessage?: string | null;
  chunks: IChatDeliveryOutboxChunk[];
  createdAt: Date;
  updatedAt: Date;
}

const ProjectionSchema = new Schema(
  {
    recipientCount: { type: Number, required: true },
    chunkCount: { type: Number, required: true },
  },
  { _id: false },
);

const ChatDeliveryOutboxChunkSchema = new Schema<IChatDeliveryOutboxChunk>(
  {
    chunkIndex: { type: Number, required: true },
    recipientIds: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['pending', 'queued', 'projecting', 'completed', 'failed'],
      default: 'pending',
    },
    jobId: { type: String, default: null },
    attemptCount: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    lastErrorMessage: { type: String, default: null },
    projection: { type: ProjectionSchema, default: null },
  },
  { _id: false },
);

const ChatDeliveryOutboxSchema = new Schema<IChatDeliveryOutbox>(
  {
    messageId: { type: String, required: true, unique: true, index: true },
    chatId: { type: String, required: true, index: true },
    chatType: { type: String, enum: ['private', 'group'], required: true, index: true },
    seq: { type: Number, required: true, index: true },
    senderId: { type: String, required: true },
    emittedAt: { type: Date, required: true },
    topology: { type: String, enum: ['eager', 'large_group_compat'], required: true },
    dispatchMode: {
      type: String,
      enum: ['queued', 'go_primary', 'sync_fallback', 'skipped'],
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending_dispatch', 'queued', 'projecting', 'partially_completed', 'completed', 'failed', 'sync_fallback_completed'],
      default: 'pending_dispatch',
      index: true,
    },
    totalRecipientCount: { type: Number, required: true },
    chunkCountExpected: { type: Number, required: true },
    queuedChunkCount: { type: Number, default: 0 },
    completedChunkCount: { type: Number, default: 0 },
    failedChunkCount: { type: Number, default: 0 },
    projectedRecipientCount: { type: Number, default: 0 },
    projectedChunkCount: { type: Number, default: 0 },
    replayCount: { type: Number, default: 0 },
    queuedJobIds: { type: [String], default: [] },
    lastDispatchedAt: { type: Date, default: null },
    lastCompletedAt: { type: Date, default: null },
    lastErrorMessage: { type: String, default: null },
    chunks: { type: [ChatDeliveryOutboxChunkSchema], default: [] },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

ChatDeliveryOutboxSchema.index({ status: 1, updatedAt: -1 });
ChatDeliveryOutboxSchema.index({ chatId: 1, seq: -1 });

const ChatDeliveryOutbox =
  mongoose.models.ChatDeliveryOutbox ||
  mongoose.model<IChatDeliveryOutbox>('ChatDeliveryOutbox', ChatDeliveryOutboxSchema);

export default ChatDeliveryOutbox;
