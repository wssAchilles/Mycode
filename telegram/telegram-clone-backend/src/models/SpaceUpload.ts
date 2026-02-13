import mongoose from 'mongoose';

/**
 * SpaceUpload
 * Durable fallback storage for Space uploads (avatar/cover/post media) when
 * object storage isn't configured or fails.
 *
 * Note: Keep documents small (<16MB). This is intended for images/thumbnails.
 */
const SpaceUploadSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true, unique: true, index: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'space_uploads',
  }
);

export default mongoose.models.SpaceUpload ||
  mongoose.model('SpaceUpload', SpaceUploadSchema);

