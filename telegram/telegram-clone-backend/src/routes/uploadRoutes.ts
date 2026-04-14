import express from 'express';
import {
  upload,
  handleFileUpload,
  handleFileDownload,
  handleThumbnailDownload,
  handlePublicSpaceDownload,
  handlePublicSpaceThumbnailDownload,
  handlePublicNewsDownload,
} from '../controllers/uploadController';
import { authenticateToken } from '../middleware/authMiddleware';
import { uploadLimiter } from '../middleware/rateLimiter';

const router = express.Router();

// 公共 Space 媒体访问（无需认证）
router.get('/public/space/uploads/thumbnails/:filename', handlePublicSpaceThumbnailDownload);
router.get('/public/space/uploads/:filename', handlePublicSpaceDownload);
// 公共 News 图片访问（无需认证）
router.get('/public/news/uploads/:filename', handlePublicNewsDownload);

// 文件上传端点
router.post('/upload', authenticateToken, uploadLimiter, upload.single('file'), handleFileUpload);

// 文件下载端点
router.get('/uploads/:filename', authenticateToken, handleFileDownload);

// 缩略图下载端点
router.get('/uploads/thumbnails/:filename', authenticateToken, handleThumbnailDownload);

export default router;
