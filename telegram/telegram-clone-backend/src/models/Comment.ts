import mongoose, { Document, Schema, Model } from 'mongoose';

/**
 * 评论接口
 */
export interface IComment extends Document {
    userId: string;
    postId: mongoose.Types.ObjectId;
    content: string;

    // 回复其他评论
    parentId?: mongoose.Types.ObjectId;
    replyToUserId?: string;

    // 统计
    likeCount: number;

    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date;
}

const CommentSchema = new Schema<IComment>(
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
        content: {
            type: String,
            required: true,
            maxlength: 1000,
        },
        parentId: {
            type: Schema.Types.ObjectId,
            ref: 'Comment',
            index: true,
        },
        replyToUserId: String,
        likeCount: { type: Number, default: 0 },
        deletedAt: Date,
    },
    {
        timestamps: true,
        collection: 'comments',
    }
);

// 复合索引: 查询帖子的评论 (时间排序)
CommentSchema.index({ postId: 1, createdAt: -1 });

// 复合索引: 查询评论的回复
CommentSchema.index({ parentId: 1, createdAt: 1 });

/**
 * 实例方法: 软删除
 */
CommentSchema.methods.softDelete = async function (): Promise<IComment> {
    this.deletedAt = new Date();
    this.content = '[评论已删除]';
    return this.save();
};

/**
 * 静态方法: 获取帖子的评论 (分页)
 */
CommentSchema.statics.getPostComments = async function (
    postId: mongoose.Types.ObjectId,
    limit: number = 20,
    cursor?: Date
): Promise<IComment[]> {
    const query: Record<string, unknown> = {
        postId,
        parentId: null, // 只获取顶级评论
        deletedAt: null,
    };
    if (cursor) {
        query.createdAt = { $lt: cursor };
    }
    return this.find(query).sort({ createdAt: -1 }).limit(limit);
};

interface CommentModel extends Model<IComment> {
    getPostComments(
        postId: mongoose.Types.ObjectId,
        limit?: number,
        cursor?: Date
    ): Promise<IComment[]>;
}

const Comment = mongoose.model<IComment, CommentModel>('Comment', CommentSchema);

export default Comment;
