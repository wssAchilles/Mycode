import mongoose, { Document, Schema, Model } from 'mongoose';

/**
 * 点赞接口
 * 简单的用户-帖子关联，用于 engagement statistics
 */
export interface ILike extends Document {
    userId: string;
    postId: mongoose.Types.ObjectId;
    authorId: string; // 冗余存储帖子作者ID，用于快速统计
    createdAt: Date;
}

const LikeSchema = new Schema<ILike>(
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
        authorId: {
            type: String,
            required: true,
            index: true, // 用于查询"谁给我点赞了"
        },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
        collection: 'likes',
    }
);

// 复合唯一索引: 防止重复点赞
LikeSchema.index({ userId: 1, postId: 1 }, { unique: true });

// 复合索引: 查询用户是否点赞了某些帖子 (批量检查)
LikeSchema.index({ userId: 1, postId: 1, createdAt: -1 });

// 分页查询用户点赞列表 (按时间倒序)
LikeSchema.index({ userId: 1, createdAt: -1 });

/**
 * 静态方法: 检查是否已点赞
 */
LikeSchema.statics.hasLiked = async function (
    userId: string,
    postId: mongoose.Types.ObjectId
): Promise<boolean> {
    const count = await this.countDocuments({ userId, postId });
    return count > 0;
};

/**
 * 静态方法: 批量检查点赞状态 (用于 Feed Hydration)
 */
LikeSchema.statics.getLikedPostIds = async function (
    userId: string,
    postIds: mongoose.Types.ObjectId[]
): Promise<Set<string>> {
    const likes = await this.find({
        userId,
        postId: { $in: postIds },
    }).select('postId');
    return new Set(likes.map((l: ILike) => l.postId.toString()));
};

interface LikeModel extends Model<ILike> {
    hasLiked(userId: string, postId: mongoose.Types.ObjectId): Promise<boolean>;
    getLikedPostIds(
        userId: string,
        postIds: mongoose.Types.ObjectId[]
    ): Promise<Set<string>>;
}

const Like = mongoose.model<ILike, LikeModel>('Like', LikeSchema);

export default Like;
