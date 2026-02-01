/**
 * GroupState - 群组全局状态模型
 * P2: 存储大群的全局消息指针，用于读扩散模式
 */
import mongoose, { Document, Schema } from 'mongoose';

export interface IGroupState extends Document {
    _id: string;           // groupId (使用群组 ID 作为主键)
    lastSeq: number;       // 群组最新消息 seq
    lastMessageId: string; // 最新消息 ObjectId
    updatedAt: Date;
}

const GroupStateSchema = new Schema<IGroupState>({
    _id: { type: String, required: true },
    lastSeq: { type: Number, default: 0, index: true },
    lastMessageId: { type: String, default: null },
}, {
    timestamps: { createdAt: false, updatedAt: true },
    versionKey: false,
});

// 索引优化查询性能
GroupStateSchema.index({ lastSeq: -1 });

const GroupState = mongoose.model<IGroupState>('GroupState', GroupStateSchema);

export default GroupState;
