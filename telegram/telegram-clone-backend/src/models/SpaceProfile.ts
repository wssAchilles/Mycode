import mongoose, { Document, Schema } from 'mongoose';

export interface ISpaceProfile extends Document {
  userId: string;
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
