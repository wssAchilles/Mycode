import mongoose, { Document, Schema } from 'mongoose';

export interface ISpaceProfile extends Document {
  userId: string;
  /** 显示名（类似 Twitter display name），与登录用户名解耦 */
  displayName?: string | null;
  /** 个人简介 */
  bio?: string | null;
  /** 地理位置 */
  location?: string | null;
  /** 个人网站 */
  website?: string | null;
  coverUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const SpaceProfileSchema = new Schema<ISpaceProfile>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    displayName: {
      type: String,
      default: null,
      maxlength: 50,
      trim: true,
    },
    bio: {
      type: String,
      default: null,
      maxlength: 200,
      trim: true,
    },
    location: {
      type: String,
      default: null,
      maxlength: 60,
      trim: true,
    },
    website: {
      type: String,
      default: null,
      maxlength: 120,
      trim: true,
    },
    coverUrl: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'space_profiles',
  }
);

SpaceProfileSchema.index({ userId: 1 });

const SpaceProfile = mongoose.model<ISpaceProfile>('SpaceProfile', SpaceProfileSchema);

export default SpaceProfile;
