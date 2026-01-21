import mongoose, { Document, Schema, Model } from 'mongoose';

/**
 * 转发类型
 */
export enum RepostType {
    REPOST = 'repost', // 纯转发
    QUOTE = 'quote', // 引用转发 (带评论)
}

/**
 * 转发接口
 * 复刻 x-algorithm 的 retweet 概念
 */
export interface IRepost extends Document {
    userId: string;
    postId: mongoose.Types.ObjectId; // 被转发的帖子
    type: RepostType;
    quotePostId?: mongoose.Types.ObjectId; // 引用转发时，指向新创建的引用帖子
    createdAt: Date;
}

const RepostSchema = new Schema<IRepost>(
    {
        userId: {
            type: String,
            required: true,
            index: true,
        },
        postId: {
            type: Schema.Types.ObjectId,
            ref: 'Post',
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: Object.values(RepostType),
            default: RepostType.REPOST,
        },
        quotePostId: {
            type: Schema.Types.ObjectId,
            ref: 'Post',
        },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
        collection: 'reposts',
    }
);

// 复合唯一索引: 防止重复纯转发 (引用转发可以多次)
RepostSchema.index(
    { userId: 1, postId: 1, type: 1 },
    {
        unique: true,
        partialFilterExpression: { type: RepostType.REPOST },
    }
);

/**
 * 静态方法: 检查是否已转发
 */
RepostSchema.statics.hasReposted = async function (
    userId: string,
    postId: mongoose.Types.ObjectId
): Promise<boolean> {
    const count = await this.countDocuments({
        userId,
        postId,
        type: RepostType.REPOST,
    });
    return count > 0;
};

/**
 * 静态方法: 批量检查转发状态
 */
RepostSchema.statics.getRepostedPostIds = async function (
    userId: string,
    postIds: mongoose.Types.ObjectId[]
): Promise<Set<string>> {
    const reposts = await this.find({
        userId,
        postId: { $in: postIds },
        type: RepostType.REPOST,
    }).select('postId');
    return new Set(reposts.map((r: IRepost) => r.postId.toString()));
};

interface RepostModel extends Model<IRepost> {
    hasReposted(userId: string, postId: mongoose.Types.ObjectId): Promise<boolean>;
    getRepostedPostIds(
        userId: string,
        postIds: mongoose.Types.ObjectId[]
    ): Promise<Set<string>>;
}

const Repost = mongoose.model<IRepost, RepostModel>('Repost', RepostSchema);

export default Repost;
