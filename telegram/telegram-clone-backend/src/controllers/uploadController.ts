import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import iconv from 'iconv-lite';

// 文件类型映射
const FILE_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  video: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv'],
  audio: ['audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a'],
  document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
};

// 获取文件类型
const getFileType = (mimeType: string): string => {
  if (FILE_TYPES.image.includes(mimeType)) return 'image';
  if (FILE_TYPES.video.includes(mimeType)) return 'video';
  if (FILE_TYPES.audio.includes(mimeType)) return 'audio';
  if (FILE_TYPES.document.includes(mimeType)) return 'document';
  return 'file';
};

// 修复文件名编码问题
const fixFilenameEncoding = (filename: string): string => {
  try {
    console.log('\n=== 文件名编码修复分析 ===');
    console.log(`🔍 原始文件名: "${filename}"`);
    console.log(`🔍 字符长度: ${filename.length}`);
    console.log(`🔍 字节数组: [${Array.from(Buffer.from(filename, 'utf8')).join(', ')}]`);
    console.log(`🔍 十六进制: ${Buffer.from(filename, 'utf8').toString('hex')}`);
    
    // 检测是否包含乱码特征（比如 \x 序列）
    const hasGarbledChars = /[\x80-\xFF]/u.test(filename) || filename.includes('\\x');
    console.log(`🔍 是否包含乱码特征: ${hasGarbledChars}`);
    
    if (!hasGarbledChars) {
      console.log('✅ 文件名看起来正常，不需要修复');
      return filename;
    }
    
    // 方法1: 尝试从latin1解码到UTF-8
    console.log('\n🔧 尝试方法1: latin1 -> utf8');
    try {
      const latin1Buffer = Buffer.from(filename, 'latin1');
      const utf8Decoded = latin1Buffer.toString('utf8');
      console.log(`  结果: "${utf8Decoded}"`);
      
      // 检查是否是有效的中文
      if (utf8Decoded && /[\u4e00-\u9fff]/.test(utf8Decoded)) {
        console.log('✅ 方法1成功: 检测到中文字符');
        return utf8Decoded;
      }
    } catch (e) {
      console.log(`  失败: ${e}`);
    }
    
    // 方法2: 使用iconv-lite处理
    console.log('\n🔧 尝试方法2: iconv-lite 解码');
    try {
      const buffer = Buffer.from(filename, 'latin1');
      const decodedName = iconv.decode(buffer, 'utf8');
      console.log(`  结果: "${decodedName}"`);
      
      if (decodedName && decodedName.length > 0 && /[\u4e00-\u9fff]/.test(decodedName)) {
        console.log('✅ 方法2成功: iconv-lite 解码成功');
        return decodedName;
      }
    } catch (e) {
      console.log(`  失败: ${e}`);
    }
    
    // 方法3: URL解码尝试
    console.log('\n🔧 尝试方法3: URL 解码');
    try {
      const urlDecoded = decodeURIComponent(filename.replace(/[\x80-\xFF]/gu, (match) => {
        return '%' + match.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
      }));
      console.log(`  结果: "${urlDecoded}"`);
      
      if (urlDecoded && urlDecoded !== filename && /[\u4e00-\u9fff]/.test(urlDecoded)) {
        console.log('✅ 方法3成功: URL 解码成功');
        return urlDecoded;
      }
    } catch (e) {
      console.log(`  失败: ${e}`);
    }
    
    console.log('⚠️ 所有解码尝试都失败，保持原文件名');
    return filename;
  } catch (error) {
    console.error('❌ 文件名编码修复失败:', error);
    return filename;
  }
};

// 确保上传目录存在
const ensureUploadDirs = () => {
  const uploadDir = path.join(__dirname, '../../uploads');
  const thumbDir = path.join(uploadDir, 'thumbnails');
  
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  
  if (!fs.existsSync(thumbDir)) {
    fs.mkdirSync(thumbDir, { recursive: true });
  }
  
  return { uploadDir, thumbDir };
};

// 配置 multer 存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { uploadDir } = ensureUploadDirs();
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    console.log('\n=== MULTER STORAGE 文件名处理 ===');
    console.log('📋 file.originalname 在storage中:', JSON.stringify(file.originalname));
    console.log('📋 字节级分析:', Array.from(Buffer.from(file.originalname, 'utf8')));
    
    // 生成唯一文件名
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    console.log('📋 生成的存储文件名:', uniqueName);
    cb(null, uniqueName);
  }
});

// 文件过滤器
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // 检查文件大小 (20MB)
  const maxSize = 20 * 1024 * 1024;
  
  // 允许的文件类型
  const allowedTypes = [
    ...FILE_TYPES.image,
    ...FILE_TYPES.video,
    ...FILE_TYPES.audio,
    ...FILE_TYPES.document,
    'text/plain',
    'application/zip',
    'application/x-rar-compressed'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的文件类型: ${file.mimetype}`));
  }
};

// 配置 multer
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB
  }
});

// 生成缩略图（仅对图片）
const generateThumbnail = async (filePath: string, fileName: string): Promise<string | null> => {
  try {
    const { thumbDir } = ensureUploadDirs();
    const thumbName = `thumb_${fileName}`;
    const thumbPath = path.join(thumbDir, thumbName);
    
    await sharp(filePath)
      .resize(200, 200, { 
        fit: 'cover',
        position: 'center'
      })
      .toFile(thumbPath);
      
    return `/api/uploads/thumbnails/${thumbName}`;
  } catch (error) {
    console.error('生成缩略图失败:', error);
    return null;
  }
};

// 文件上传处理器
export const handleFileUpload = async (req: Request, res: Response) => {
  try {
    console.log('\n=== MULTER 文件上传调试 ===');
    console.log('📎 请求头 Content-Type:', req.headers['content-type']);
    console.log('📎 请求头完整信息:', JSON.stringify(req.headers, null, 2));
    
    if (!req.file) {
      console.log('❌ 没有接收到文件');
      return res.status(400).json({
        success: false,
        message: '没有选择文件'
      });
    }
    
    console.log('📎 原始 req.file 对象:');
    console.log(JSON.stringify(req.file, null, 2));
    
    console.log('📎 文件名字节分析:');
    console.log('  - req.file.originalname 原始值:', JSON.stringify(req.file.originalname));
    console.log('  - 字符长度:', req.file.originalname.length);
    console.log('  - 字节数组:', Array.from(Buffer.from(req.file.originalname, 'utf8')));
    console.log('  - 十六进制表示:', Buffer.from(req.file.originalname, 'utf8').toString('hex'));
    
    // 尝试不同的编码解释
    console.log('📎 不同编码解释尝试:');
    try {
      const asLatin1 = Buffer.from(req.file.originalname, 'latin1');
      console.log('  - 作latin1解释:', asLatin1.toString('utf8'));
    } catch (e: any) {
      console.log('  - latin1解释失败:', e.message);
    }
    
    try {
      const asBuffer = Buffer.from(req.file.originalname, 'binary');
      console.log('  - 作binary解释:', asBuffer.toString('utf8'));
    } catch (e: any) {
      console.log('  - binary解释失败:', e.message);
    }
    
    const { originalname, filename, mimetype, size, path: filePath } = req.file;
    const fileType = getFileType(mimetype);
    
    // 修复文件名编码问题
    const fixedFileName = fixFilenameEncoding(originalname);
    
    console.log(`📎 文件上传信息:`);
    console.log(`  - 原始文件名: "${originalname}"`);
    console.log(`  - 修复后文件名: "${fixedFileName}"`);
    console.log(`  - 文件类型: ${fileType}`);
    console.log(`  - 文件大小: ${size} bytes`);
    
    // 生成文件URL
    const fileUrl = `/api/uploads/${filename}`;
    
    // 如果是图片，生成缩略图
    let thumbnailUrl = null;
    if (fileType === 'image') {
      thumbnailUrl = await generateThumbnail(filePath, filename);
    }
    
    // 返回文件信息
    const fileInfo = {
      success: true,
      data: {
        fileName: fixedFileName, // 使用修复后的文件名
        fileUrl,
        fileSize: size,
        mimeType: mimetype,
        fileType,
        thumbnailUrl
      }
    };
    
    console.log('📁 文件上传成功:', fileInfo.data);
    res.json(fileInfo);
    
  } catch (error) {
    console.error('❌ 文件上传失败:', error);
    res.status(500).json({
      success: false,
      message: '文件上传失败',
      error: error instanceof Error ? error.message : '未知错误'
    });
  }
};

// 文件下载处理器
export const handleFileDownload = async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, '../../uploads', filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      });
    }
    
    res.sendFile(filePath);
    
  } catch (error) {
    console.error('❌ 文件下载失败:', error);
    res.status(500).json({
      success: false,
      message: '文件下载失败'
    });
  }
};

// 缩略图下载处理器
export const handleThumbnailDownload = async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const thumbPath = path.join(__dirname, '../../uploads/thumbnails', filename);
    
    if (!fs.existsSync(thumbPath)) {
      return res.status(404).json({
        success: false,
        message: '缩略图不存在'
      });
    }
    
    res.sendFile(thumbPath);
    
  } catch (error) {
    console.error('❌ 缩略图下载失败:', error);
    res.status(500).json({
      success: false,
      message: '缩略图下载失败'
    });
  }
};
