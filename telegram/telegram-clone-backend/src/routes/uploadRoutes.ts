import express from 'express';
import { upload, handleFileUpload, handleFileDownload, handleThumbnailDownload } from '../controllers/uploadController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

// 文件上传端点
router.post('/upload', authenticateToken, upload.single('file'), handleFileUpload);

// 文件下载端点
router.get('/uploads/:filename', handleFileDownload);

// 缩略图下载端点
router.get('/uploads/thumbnails/:filename', handleThumbnailDownload);

export default router;
