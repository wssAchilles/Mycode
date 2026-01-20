import express from 'express';
import { upload, handleFileUpload, handleFileDownload, handleThumbnailDownload } from '../controllers/uploadController';
import { authenticateToken } from '../middleware/authMiddleware';
import { uploadLimiter } from '../middleware/rateLimiter';

const router = express.Router();

// 所有上传/下载相关操作都需要认证
router.use(authenticateToken);

// 文件上传端点
router.post('/upload', uploadLimiter, upload.single('file'), handleFileUpload);

// 文件下载端点
router.get('/uploads/:filename', handleFileDownload);

// 缩略图下载端点
router.get('/uploads/thumbnails/:filename', handleThumbnailDownload);

export default router;
