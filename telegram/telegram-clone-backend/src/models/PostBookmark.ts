import mongoose, { Document, Schema } from 'mongoose';

export interface IPostBookmark extends Document {
    userId: string;
    postId: mongoose.Types.ObjectId;
    createdAt: Date;
}

const PostBookmarkSchema = new Schema<IPostBookmark>(
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
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
    },
);

PostBookmarkSchema.index({ userId: 1, postId: 1 }, { unique: true });
PostBookmarkSchema.index({ userId: 1, createdAt: -1 });

const PostBookmark = mongoose.model<IPostBookmark>('PostBookmark', PostBookmarkSchema);
export default PostBookmark;
