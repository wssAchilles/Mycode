import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import iconv from 'iconv-lite';
import { Op } from 'sequelize';
import Post from '../models/Post';
import SpaceProfile from '../models/SpaceProfile';
import NewsArticle from '../models/NewsArticle';
import User from '../models/User';
import SpaceUpload from '../models/SpaceUpload';
import Group, { GroupType } from '../models/Group';

// 路径安全解析，防止目录穿越
const safeResolve = (base: string, target: string): string | null => {
  const resolvedPath = path.resolve(base, target);
  if (!resolvedPath.startsWith(path.resolve(base))) {
    return null;
  }
  return resolvedPath;
};

const LOG_UPLOAD_DEBUG = (process.env.NODE_ENV || 'development') === 'development';

// 文件类型映射
const FILE_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  video: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv'],
  audio: ['audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a'],
  document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
};

const ALLOWED_EXT = [
  '.jpeg', '.jpg', '.png', '.gif', '.webp',
  '.mp4', '.avi', '.mov', '.wmv',
  '.mp3', '.wav', '.ogg', '.m4a',
  '.pdf', '.doc', '.docx', '.txt', '.zip', '.rar'
];

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
    if (LOG_UPLOAD_DEBUG) {
      console.log('\n=== 文件名编码修复分析 ===');
      console.log(`🔍 原始文件名: "${filename}"`);
      console.log(`🔍 字符长度: ${filename.length}`);
      console.log(`🔍 字节数组: [${Array.from(Buffer.from(filename, 'utf8')).join(', ')}]`);
      console.log(`🔍 十六进制: ${Buffer.from(filename, 'utf8').toString('hex')}`);
    }
    
    // 检测是否包含乱码特征（比如 \x 序列）
    const hasGarbledChars = /[\x80-\xFF]/u.test(filename) || filename.includes('\\x');
    if (LOG_UPLOAD_DEBUG) {
      console.log(`🔍 是否包含乱码特征: ${hasGarbledChars}`);
    }
    
    if (!hasGarbledChars) {
      if (LOG_UPLOAD_DEBUG) {
        console.log('✅ 文件名看起来正常，不需要修复');
      }
      return filename;
    }
    
    // 方法1: 尝试从latin1解码到UTF-8
    if (LOG_UPLOAD_DEBUG) console.log('\n🔧 尝试方法1: latin1 -> utf8');
    try {
      const latin1Buffer = Buffer.from(filename, 'latin1');
      const utf8Decoded = latin1Buffer.toString('utf8');
      if (LOG_UPLOAD_DEBUG) console.log(`  结果: "${utf8Decoded}"`);
      
      // 检查是否是有效的中文
      if (utf8Decoded && /[\u4e00-\u9fff]/.test(utf8Decoded)) {
        if (LOG_UPLOAD_DEBUG) console.log('✅ 方法1成功: 检测到中文字符');
        return utf8Decoded;
      }
    } catch (e) {
      if (LOG_UPLOAD_DEBUG) console.log(`  失败: ${e}`);
    }
    
    // 方法2: 使用iconv-lite处理
    if (LOG_UPLOAD_DEBUG) console.log('\n🔧 尝试方法2: iconv-lite 解码');
    try {
      const buffer = Buffer.from(filename, 'latin1');
      const decodedName = iconv.decode(buffer, 'utf8');
      if (LOG_UPLOAD_DEBUG) console.log(`  结果: "${decodedName}"`);
      
      if (decodedName && decodedName.length > 0 && /[\u4e00-\u9fff]/.test(decodedName)) {
        if (LOG_UPLOAD_DEBUG) console.log('✅ 方法2成功: iconv-lite 解码成功');
        return decodedName;
      }
    } catch (e) {
      if (LOG_UPLOAD_DEBUG) console.log(`  失败: ${e}`);
    }
    
    // 方法3: URL解码尝试
    if (LOG_UPLOAD_DEBUG) console.log('\n🔧 尝试方法3: URL 解码');
    try {
      const urlDecoded = decodeURIComponent(filename.replace(/[\x80-\xFF]/gu, (match) => {
        return '%' + match.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
      }));
      if (LOG_UPLOAD_DEBUG) console.log(`  结果: "${urlDecoded}"`);
      
      if (urlDecoded && urlDecoded !== filename && /[\u4e00-\u9fff]/.test(urlDecoded)) {
        if (LOG_UPLOAD_DEBUG) console.log('✅ 方法3成功: URL 解码成功');
        return urlDecoded;
      }
    } catch (e) {
      if (LOG_UPLOAD_DEBUG) console.log(`  失败: ${e}`);
    }
    
    if (LOG_UPLOAD_DEBUG) console.log('⚠️ 所有解码尝试都失败，保持原文件名');
    return filename;
  } catch (error) {
    console.error('❌ 文件名编码修复失败:', error);
    return filename;
  }
};

type UploadScope = 'default' | 'space';

export const SPACE_PUBLIC_UPLOAD_BASE = '/api/public/space/uploads';
export const NEWS_PUBLIC_UPLOAD_BASE = '/api/public/news/uploads';

const SPACE_S3_BUCKET = process.env.SPACE_S3_BUCKET || '';
const SPACE_S3_REGION = process.env.SPACE_S3_REGION || process.env.NEWS_S3_REGION || 'auto';
const SPACE_S3_ENDPOINT = process.env.SPACE_S3_ENDPOINT || process.env.NEWS_S3_ENDPOINT || '';
const SPACE_S3_FORCE_PATH_STYLE = (process.env.SPACE_S3_FORCE_PATH_STYLE || process.env.NEWS_S3_FORCE_PATH_STYLE || 'false').toLowerCase() === 'true';
const SPACE_S3_ACCESS_KEY_ID = process.env.SPACE_S3_ACCESS_KEY_ID || process.env.NEWS_S3_ACCESS_KEY_ID || '';
const SPACE_S3_SECRET_ACCESS_KEY = process.env.SPACE_S3_SECRET_ACCESS_KEY || process.env.NEWS_S3_SECRET_ACCESS_KEY || '';
const SPACE_S3_PUBLIC_BASE_URL_RAW = process.env.SPACE_S3_PUBLIC_BASE_URL || '';
const SPACE_S3_PUBLIC_BASE_URL =
  SPACE_S3_PUBLIC_BASE_URL_RAW ||
  (SPACE_S3_ENDPOINT && SPACE_S3_BUCKET
    ? `${SPACE_S3_ENDPOINT.replace(/\/+$/, '')}/${SPACE_S3_BUCKET}`
    : '');

const hasSpaceS3 = !!(SPACE_S3_BUCKET && SPACE_S3_ACCESS_KEY_ID && SPACE_S3_SECRET_ACCESS_KEY);
const spaceS3Client = hasSpaceS3
  ? new S3Client({
      region: SPACE_S3_REGION,
      endpoint: SPACE_S3_ENDPOINT || undefined,
      forcePathStyle: SPACE_S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: SPACE_S3_ACCESS_KEY_ID,
        secretAccessKey: SPACE_S3_SECRET_ACCESS_KEY,
      },
    })
  : null;

const toSpacePublicUrl = (key: string) => {
  const cleanedKey = key.replace(/^\/+/, '');
  if (hasSpaceS3 && SPACE_S3_PUBLIC_BASE_URL) {
    const base = SPACE_S3_PUBLIC_BASE_URL.replace(/\/+$/, '');
    if (base.includes('/space/uploads') && cleanedKey.startsWith('space/uploads/')) {
      const trimmed = cleanedKey.replace(/^space\/uploads\//, '');
      return `${base}/${trimmed}`;
    }
    return `${base}/${cleanedKey}`;
  }
  const cleaned = cleanedKey.replace(/^space\/uploads\//, '');
  if (cleaned.startsWith('thumbnails/')) {
    return `${SPACE_PUBLIC_UPLOAD_BASE}/${cleaned}`;
  }
  return `${SPACE_PUBLIC_UPLOAD_BASE}/${cleaned}`;
};

const uploadSpaceObject = async (key: string, body: Buffer, contentType: string) => {
  if (!spaceS3Client) return;
  await spaceS3Client.send(
    new PutObjectCommand({
      Bucket: SPACE_S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
};

// 确保上传目录存在
const ensureUploadDirs = (scope: UploadScope = 'default') => {
  const root = scope === 'space'
    ? path.join(__dirname, '../../uploads/space')
    : path.join(__dirname, '../../uploads');
  const uploadDir = root;
  const thumbDir = path.join(root, 'thumbnails');
  
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  
  if (!fs.existsSync(thumbDir)) {
    fs.mkdirSync(thumbDir, { recursive: true });
  }
  
  return { uploadDir, thumbDir };
};

// 配置 multer 存储
const createStorage = (scope: UploadScope) => multer.diskStorage({
  destination: (req, file, cb) => {
    const { uploadDir } = ensureUploadDirs(scope);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    if (LOG_UPLOAD_DEBUG) {
      console.log('\n=== MULTER STORAGE 文件名处理 ===');
      console.log('📋 file.originalname 在storage中:', JSON.stringify(file.originalname));
      console.log('📋 字节级分析:', Array.from(Buffer.from(file.originalname, 'utf8')));
    }
    
    // 生成唯一文件名
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    if (LOG_UPLOAD_DEBUG) console.log('📋 生成的存储文件名:', uniqueName);
    cb(null, uniqueName);
  }
});

// 文件过滤器
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // 检查文件大小 (20MB)
  const maxSize = 20 * 1024 * 1024;
  const ext = path.extname(file.originalname || '').toLowerCase();
  
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
  
  const looksSafeName = file.originalname && !file.originalname.includes('..');
  const mimeAllowed = allowedTypes.includes(file.mimetype);
  const extAllowed = ALLOWED_EXT.includes(ext);

  if (!looksSafeName) {
    return cb(new Error('文件名包含非法路径片段'));
  }

  if (!mimeAllowed || !extAllowed) {
    return cb(new Error(`不支持的文件类型: ${file.mimetype || 'unknown'}`));
  }

  if (file.size > maxSize) {
    return cb(new Error('文件过大'));
  }

  cb(null, true);
};

// 配置 multer
export const upload = multer({
  storage: createStorage('default'),
  fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB
  }
});

export const spaceUpload = multer({
  storage: createStorage('space'),
  fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB
  }
});

// 生成缩略图（仅对图片）
export const generateThumbnail = async (
  filePath: string,
  fileName: string,
  scope: UploadScope = 'default'
): Promise<string | null> => {
  try {
    const { thumbDir } = ensureUploadDirs(scope);
    const thumbName = `thumb_${fileName}`;
    const thumbPath = path.join(thumbDir, thumbName);

    const thumbBuffer = await sharp(filePath)
      .resize(320, 320, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: 82 })
      .toBuffer();

    if (scope === 'space' && hasSpaceS3) {
      try {
        await uploadSpaceObject(`space/uploads/thumbnails/${thumbName}`, thumbBuffer, 'image/jpeg');
        return toSpacePublicUrl(`space/uploads/thumbnails/${thumbName}`);
      } catch (error) {
        // Best-effort: fallback to local thumbnails if cloud thumbnail upload fails.
        console.error('⚠️ Space S3 缩略图上传失败，回退本地缩略图:', error);
      }
    }

    // Durable fallback: persist thumbnail bytes to Mongo (best-effort).
    if (scope === 'space') {
      await persistSpaceUploadToMongo({
        filename: thumbName,
        contentType: 'image/jpeg',
        data: thumbBuffer,
      });
    }

    await fs.promises.writeFile(thumbPath, thumbBuffer);

    if (scope === 'space') {
      return `${SPACE_PUBLIC_UPLOAD_BASE}/thumbnails/${thumbName}`;
    }
    return `/api/uploads/thumbnails/${thumbName}`;
  } catch (error) {
    console.error('生成缩略图失败:', error);
    return null;
  }
};

export const saveSpaceUpload = async (file: Express.Multer.File): Promise<{ url: string; thumbnailUrl?: string }> => {
  const mimetype = file.mimetype || 'application/octet-stream';
  const isImage = mimetype.startsWith('image/');
  const key = `space/uploads/${file.filename}`;

  // Durable fallback for Render: persist images to Mongo so avatar/cover/media survive restarts,
  // especially when object storage is misconfigured.
  const shouldMongoPersist = isImage;

  if (hasSpaceS3 && spaceS3Client) {
    try {
      const buffer = await fs.promises.readFile(file.path);
      await uploadSpaceObject(key, buffer, mimetype);
      if (shouldMongoPersist) {
        await persistSpaceUploadToMongo({
          filename: file.filename,
          contentType: mimetype,
          data: buffer,
        });
      }
      const thumbnailUrl = isImage
        ? await generateThumbnail(file.path, file.filename, 'space')
        : undefined;
      return { url: toSpacePublicUrl(key), thumbnailUrl: thumbnailUrl || undefined };
    } catch (error) {
      // 工业级降级：云存储失败时回退本地存储，避免用户封面/媒体上传直接失败
      console.error('⚠️ Space S3 上传失败，回退本地存储:', error);
      if (shouldMongoPersist) {
        try {
          const buffer = await fs.promises.readFile(file.path);
          await persistSpaceUploadToMongo({
            filename: file.filename,
            contentType: mimetype,
            data: buffer,
          });
        } catch (mongoErr) {
          console.warn('⚠️ SpaceUpload Mongo fallback persist failed after S3 error:', mongoErr);
        }
      }
    }
  }

  // No S3 configured: still persist to Mongo in production so uploads are durable.
  if (shouldMongoPersist && (process.env.NODE_ENV || 'development') === 'production') {
    try {
      const buffer = await fs.promises.readFile(file.path);
      await persistSpaceUploadToMongo({
        filename: file.filename,
        contentType: mimetype,
        data: buffer,
      });
    } catch (mongoErr) {
      console.warn('⚠️ SpaceUpload Mongo fallback persist failed (no S3):', mongoErr);
    }
  }

  const thumbnailUrl = isImage
    ? await generateThumbnail(file.path, file.filename, 'space')
    : undefined;
  return { url: `${SPACE_PUBLIC_UPLOAD_BASE}/${file.filename}`, thumbnailUrl: thumbnailUrl || undefined };
};

// 文件上传处理器
export const handleFileUpload = async (req: Request, res: Response) => {
  try {
    if (LOG_UPLOAD_DEBUG) {
      console.log('\n=== MULTER 文件上传调试 ===');
      console.log('📎 请求头 Content-Type:', req.headers['content-type']);
    }
    
    if (!req.file) {
      if (LOG_UPLOAD_DEBUG) console.log('❌ 没有接收到文件');
      return res.status(400).json({
        success: false,
        message: '没有选择文件'
      });
    }
    
    if (LOG_UPLOAD_DEBUG) {
      console.log('📎 原始 req.file 对象:');
      console.log(JSON.stringify(req.file, null, 2));
    }
    
    const { originalname, filename, mimetype, size, path: filePath } = req.file;
    const fileType = getFileType(mimetype);
    
    // 修复文件名编码问题
    const fixedFileName = fixFilenameEncoding(originalname);
    
    if (LOG_UPLOAD_DEBUG) {
      console.log(`📎 文件上传信息:`);
      console.log(`  - 原始文件名: "${originalname}"`);
      console.log(`  - 修复后文件名: "${fixedFileName}"`);
      console.log(`  - 文件类型: ${fileType}`);
      console.log(`  - 文件大小: ${size} bytes`);
    }
    
    // 生成文件URL
    const fileUrl = `/api/uploads/${filename}`;
    
    // 如果是图片，生成缩略图
    let thumbnailUrl = null;
    if (fileType === 'image') {
      thumbnailUrl = await generateThumbnail(filePath, filename, 'default');
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
    
    if (LOG_UPLOAD_DEBUG) console.log('📁 文件上传成功:', fileInfo.data);
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

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SPACE_UPLOAD_MONGO_FALLBACK_ENABLED =
  String(process.env.SPACE_UPLOAD_MONGO_FALLBACK_ENABLED ?? 'true').toLowerCase() === 'true';
// Keep well below Mongo 16MB document limit.
const SPACE_UPLOAD_MONGO_MAX_BYTES =
  parseInt(String(process.env.SPACE_UPLOAD_MONGO_MAX_BYTES ?? String(8 * 1024 * 1024)), 10) || 8 * 1024 * 1024;

const persistSpaceUploadToMongo = async (args: {
  filename: string;
  contentType: string;
  data: Buffer;
}): Promise<void> => {
  if (!SPACE_UPLOAD_MONGO_FALLBACK_ENABLED) return;
  if (!args.filename || !args.data?.length) return;
  if (args.data.length > SPACE_UPLOAD_MONGO_MAX_BYTES) return;

  try {
    await SpaceUpload.findOneAndUpdate(
      { filename: args.filename },
      {
        filename: args.filename,
        contentType: args.contentType || 'application/octet-stream',
        size: args.data.length,
        data: args.data,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    // Best-effort: this is a fallback durability path.
    console.warn('⚠️ SpaceUpload Mongo fallback persist failed:', error);
  }
};

const isSpacePublicAsset = async (filename: string): Promise<boolean> => {
  const escaped = escapeRegExp(filename);
  // Allow query strings (some clients may store signed/public URLs with ?v=...).
  const regex = new RegExp(`${escaped}(\\?.*)?$`);

  const postMatch = await Post.exists({
    deletedAt: null,
    $or: [
      { 'media.url': { $regex: regex } },
      { 'media.thumbnailUrl': { $regex: regex } },
    ],
  });

  if (postMatch) return true;

  const profileMatch = await SpaceProfile.exists({ coverUrl: { $regex: regex } });
  if (profileMatch) return true;

  // User avatarUrl lives in PostgreSQL; include it so avatar uploads are publicly retrievable.
  try {
    const likePattern = `%${filename}%`;
    const userMatch = await User.findOne({
      where: {
        avatarUrl: { [Op.like]: likePattern },
      },
      attributes: ['id'],
    });
    if (userMatch) return true;
  } catch (error) {
    console.warn('⚠️ Space 公共文件校验(User.avatarUrl)失败:', error);
  }

  try {
    const likePattern = `%${filename}%`;
    const groupMatch = await Group.findOne({
      where: {
        type: GroupType.PUBLIC,
        isActive: true,
        avatarUrl: { [Op.like]: likePattern },
      },
      attributes: ['id'],
    });
    if (groupMatch) return true;
  } catch (error) {
    console.warn('⚠️ Space 公共文件校验(Group.avatarUrl)失败:', error);
  }

  return false;
};

const isNewsPublicAsset = async (filename: string): Promise<boolean> => {
  try {
    const likePattern = `%${filename}`;
    const match = await NewsArticle.findOne({
      where: {
        coverImageUrl: { [Op.like]: likePattern },
        deletedAt: null,
        isActive: true,
      },
      attributes: ['id'],
    });
    return !!match;
  } catch (error) {
    console.warn('⚠️ News 公共文件校验失败:', error);
    return false;
  }
};

const resolveExistingFile = (paths: string[]): string | null => {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
};

// When using `.lean()`, Mongoose returns Buffer fields as BSON Binary.
// Convert it to a Node Buffer so we can `res.send()` it.
const coerceMongoBinaryToBuffer = (value: any): Buffer | null => {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value?.buffer && Buffer.isBuffer(value.buffer)) return value.buffer;
  if (typeof value?.value === 'function') {
    try {
      const v = value.value(true);
      if (Buffer.isBuffer(v)) return v;
    } catch {
      // ignore
    }
  }
  return null;
};

// 公共 Space 媒体下载处理器
export const handlePublicSpaceDownload = async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const isAllowed = await isSpacePublicAsset(filename);
    if (!isAllowed) {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      });
    }

    const spaceRoot = path.join(__dirname, '../../uploads/space');
    const defaultRoot = path.join(__dirname, '../../uploads');

    const spacePath = safeResolve(spaceRoot, path.basename(filename));
    const defaultPath = safeResolve(defaultRoot, path.basename(filename));
    const existing = resolveExistingFile([spacePath || '', defaultPath || '']);

    if (!existing) {
      // Durable fallback: serve from Mongo if present (covers Render restarts even when S3 is broken).
      try {
        const doc = (await SpaceUpload.findOne({ filename: path.basename(filename) }).lean()) as any;
        const buf = coerceMongoBinaryToBuffer(doc?.data);
        if (buf) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.setHeader('Content-Type', doc.contentType || 'application/octet-stream');
          return res.status(200).send(buf);
        }
      } catch (mongoErr) {
        console.warn('⚠️ Space 公共文件 Mongo fallback 读取失败:', mongoErr);
      }

      if (hasSpaceS3 && SPACE_S3_PUBLIC_BASE_URL) {
        return res.redirect(toSpacePublicUrl(`space/uploads/${filename}`));
      }
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      });
    }

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(existing);
  } catch (error) {
    console.error('❌ Space 公共文件下载失败:', error);
    res.status(500).json({
      success: false,
      message: '文件下载失败'
    });
  }
};

// 公共 News 图片下载处理器
export const handlePublicNewsDownload = async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const isAllowed = await isNewsPublicAsset(filename);
    if (!isAllowed) {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      });
    }

    const newsRoot = path.join(__dirname, '../../uploads/news-images');
    const newsPath = safeResolve(newsRoot, path.basename(filename));
    const existing = resolveExistingFile([newsPath || '']);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      });
    }

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(existing);
  } catch (error) {
    console.error('❌ News 公共文件下载失败:', error);
    res.status(500).json({
      success: false,
      message: '文件下载失败'
    });
  }
};

// 公共 Space 缩略图下载处理器
export const handlePublicSpaceThumbnailDownload = async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const isAllowed = await isSpacePublicAsset(filename);
    if (!isAllowed) {
      return res.status(404).json({
        success: false,
        message: '缩略图不存在'
      });
    }

    const spaceRoot = path.join(__dirname, '../../uploads/space/thumbnails');
    const defaultRoot = path.join(__dirname, '../../uploads/thumbnails');

    const spacePath = safeResolve(spaceRoot, path.basename(filename));
    const defaultPath = safeResolve(defaultRoot, path.basename(filename));
    const existing = resolveExistingFile([spacePath || '', defaultPath || '']);

    if (!existing) {
      // Durable fallback: serve thumbnail from Mongo if present.
      try {
        const doc = (await SpaceUpload.findOne({ filename: path.basename(filename) }).lean()) as any;
        const buf = coerceMongoBinaryToBuffer(doc?.data);
        if (buf) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.setHeader('Content-Type', doc.contentType || 'application/octet-stream');
          return res.status(200).send(buf);
        }
      } catch (mongoErr) {
        console.warn('⚠️ Space 缩略图 Mongo fallback 读取失败:', mongoErr);
      }

      if (hasSpaceS3 && SPACE_S3_PUBLIC_BASE_URL) {
        return res.redirect(toSpacePublicUrl(`space/uploads/thumbnails/${filename}`));
      }
      return res.status(404).json({
        success: false,
        message: '缩略图不存在'
      });
    }

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(existing);
  } catch (error) {
    console.error('❌ Space 公共缩略图下载失败:', error);
    res.status(500).json({
      success: false,
      message: '缩略图下载失败'
    });
  }
};

// 文件下载处理器
export const handleFileDownload = async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const uploadsRoot = path.join(__dirname, '../../uploads');
    const safePath = safeResolve(uploadsRoot, path.basename(filename));

    if (!safePath || !fs.existsSync(safePath)) {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      });
    }
    
    res.sendFile(safePath);
    
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
    const thumbRoot = path.join(__dirname, '../../uploads/thumbnails');
    const safePath = safeResolve(thumbRoot, path.basename(filename));

    if (!safePath || !fs.existsSync(safePath)) {
      return res.status(404).json({
        success: false,
        message: '缩略图不存在'
      });
    }
    
    res.sendFile(safePath);
    
  } catch (error) {
    console.error('❌ 缩略图下载失败:', error);
    res.status(500).json({
      success: false,
      message: '缩略图下载失败'
    });
  }
};
