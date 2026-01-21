import mongoose, { Document, Schema, Model } from 'mongoose';

/**
 * 帖子媒体类型
 */
export enum MediaType {
    IMAGE = 'image',
    VIDEO = 'video',
    GIF = 'gif',
}

/**
 * 帖子媒体接口
 */
export interface IPostMedia {
    type: MediaType;
    url: string;
    thumbnailUrl?: string;
    width?: number;
    height?: number;
    duration?: number; // 视频时长 (秒)
}

/**
 * 帖子统计接口
 */
export interface IPostStats {
    likeCount: number;
    repostCount: number;
    quoteCount: number;
    commentCount: number;
    viewCount: number;
}

/**
 * 帖子接口 - 对标 x-algorithm PostCandidate
 */
export interface IPost extends Document {
    authorId: string;
    content: string;
    media: IPostMedia[];
    stats: IPostStats;

    // 转发/引用相关 (复刻 x-algorithm 的 retweet 概念)
    isRepost: boolean;
    originalPostId?: mongoose.Types.ObjectId;
    quoteContent?: string; // 引用转发时的评论

    // 回复相关 (复刻 x-algorithm 的 in_reply_to_tweet_id)
    isReply: boolean;
    replyToPostId?: mongoose.Types.ObjectId;
    conversationId?: mongoose.Types.ObjectId; // 对话根帖子ID

    // 推荐辅助字段
    keywords: string[]; // 用于 MutedKeywordFilter
    language?: string;
    isNsfw: boolean;
    isPinned: boolean;

    // 推荐评分 (借鉴 Phoenix)
    engagementScore?: number; // 聚合参与度分数
    phoenixScores?: {
        likeScore?: number;
        replyScore?: number;
        repostScore?: number;
        clickScore?: number;
        dwellTimeScore?: number;
    };

    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date;
}

/**
 * 帖子 Schema
 */
const PostMediaSchema = new Schema<IPostMedia>(
    {
        type: {
            type: String,
            enum: Object.values(MediaType),
            required: true,
        },
        url: { type: String, required: true },
        thumbnailUrl: String,
        width: Number,
        height: Number,
        duration: Number,
    },
    { _id: false }
);

const PostStatsSchema = new Schema<IPostStats>(
    {
        likeCount: { type: Number, default: 0 },
        repostCount: { type: Number, default: 0 },
        quoteCount: { type: Number, default: 0 },
        commentCount: { type: Number, default: 0 },
        viewCount: { type: Number, default: 0 },
    },
    { _id: false }
);

const PhoenixScoresSchema = new Schema(
    {
        likeScore: Number,
        replyScore: Number,
        repostScore: Number,
        clickScore: Number,
        dwellTimeScore: Number,
    },
    { _id: false }
);

const PostSchema = new Schema<IPost>(
    {
        authorId: {
            type: String,
            required: true,
            index: true, // 用于按作者查询
        },
        content: {
            type: String,
            maxlength: 2000, // 支持长文本
            default: '',
        },
        media: {
            type: [PostMediaSchema],
            default: [],
        },
        stats: {
            type: PostStatsSchema,
            default: () => ({
                likeCount: 0,
                repostCount: 0,
                quoteCount: 0,
                commentCount: 0,
                viewCount: 0,
            }),
        },

        // 转发相关
        isRepost: { type: Boolean, default: false },
        originalPostId: {
            type: Schema.Types.ObjectId,
            ref: 'Post',
            index: true,
        },
        quoteContent: String,

        // 回复相关
        isReply: { type: Boolean, default: false },
        replyToPostId: {
            type: Schema.Types.ObjectId,
            ref: 'Post',
            index: true,
        },
        conversationId: {
            type: Schema.Types.ObjectId,
            ref: 'Post',
            index: true,
        },

        // 推荐辅助
        keywords: { type: [String], default: [] },
        language: String,
        isNsfw: { type: Boolean, default: false },
        isPinned: { type: Boolean, default: false },

        // 推荐评分
        engagementScore: { type: Number, default: 0 },
        phoenixScores: PhoenixScoresSchema,

        deletedAt: Date,
    },
    {
        timestamps: true,
        collection: 'posts',
    }
);

// 复合索引: 用于 Feed 查询 (时间排序 + 未删除)
PostSchema.index({ createdAt: -1, deletedAt: 1 });

// 复合索引: 用于作者 Feed
PostSchema.index({ authorId: 1, createdAt: -1 });

// 文本索引: 用于关键词搜索和屏蔽词匹配
PostSchema.index({ content: 'text', keywords: 'text' });

/**
 * 实例方法: 软删除
 */
PostSchema.methods.softDelete = async function (): Promise<IPost> {
    this.deletedAt = new Date();
    return this.save();
};

/**
 * 静态方法: 增加统计计数
 */
PostSchema.statics.incrementStat = async function (
    postId: mongoose.Types.ObjectId,
    stat: keyof IPostStats,
    delta: number = 1
): Promise<void> {
    await this.findByIdAndUpdate(postId, {
        $inc: { [`stats.${stat}`]: delta },
    });
};

/**
 * 静态方法: 批量获取帖子 (用于 Hydrator)
 */
PostSchema.statics.findByIds = async function (
    ids: mongoose.Types.ObjectId[]
): Promise<IPost[]> {
    return this.find({
        _id: { $in: ids },
        deletedAt: null,
    });
};

// 扩展静态方法类型
interface PostModel extends Model<IPost> {
    incrementStat(
        postId: mongoose.Types.ObjectId,
        stat: keyof IPostStats,
        delta?: number
    ): Promise<void>;
    findByIds(ids: mongoose.Types.ObjectId[]): Promise<IPost[]>;
}

const Post = mongoose.model<IPost, PostModel>('Post', PostSchema);

export default Post;
