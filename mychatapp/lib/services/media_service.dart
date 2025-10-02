import 'dart:io';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as path;
import '../models/media_attachment_model.dart';
import 'auth_service.dart';

/// 媒体服务类
/// 
/// 负责处理多媒体文件的选择、上传和管理
/// 严格遵循MediaAttachmentModel数据结构
class MediaService {
  static final MediaService _instance = MediaService._internal();
  factory MediaService() => _instance;
  MediaService._internal();

  final FirebaseStorage _storage = FirebaseStorage.instance;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final ImagePicker _imagePicker = ImagePicker();
  final AuthService _authService = AuthService();

  /// 选择并上传图片文件
  /// 
  /// [source] 图片来源（相机或相册）
  /// 返回上传成功的MediaAttachmentModel
  Future<MediaAttachmentModel?> pickAndUploadImage({
    required ImageSource source,
  }) async {
    try {
      // 选择图片
      final XFile? pickedFile = await _imagePicker.pickImage(
        source: source,
        maxWidth: 1920,
        maxHeight: 1920,
        imageQuality: 80,
      );
      
      if (pickedFile == null) return null;
      
      final File file = File(pickedFile.path);
      
      // 上传文件
      return await uploadFile(
        file: file,
        mediaType: MediaType.image,
      );
    } catch (e) {
      throw Exception('选择图片失败：${e.toString()}');
    }
  }

  /// 录制并上传语音文件
  /// 
  /// 返回上传成功的MediaAttachmentModel
  Future<MediaAttachmentModel?> recordAndUploadAudio() async {
    try {
      // TODO: 实现语音录制功能
      // 这里需要添加 flutter_sound 或类似的语音录制插件
      throw UnimplementedError('语音录制功能待实现');
    } catch (e) {
      throw Exception('录制语音失败：${e.toString()}');
    }
  }


  /// 核心文件上传方法
  /// 
  /// [file] 要上传的文件
  /// [mediaType] 媒体类型
  /// 返回包含完整元数据的MediaAttachmentModel
  Future<MediaAttachmentModel> uploadFile({
    required File file,
    required MediaType mediaType,
  }) async {
    final currentUser = _authService.currentUser;
    if (currentUser == null) {
      throw Exception('用户未登录');
    }

    try {
      // 生成附件ID
      final attachmentId = _firestore.collection('temp').doc().id;
      
      // 获取文件信息
      final fileName = path.basename(file.path);
      final fileExtension = path.extension(file.path).toLowerCase();
      final fileSize = await file.length();
      
      // 构建存储路径
      final storagePath = _buildStoragePath(
        userId: currentUser.uid,
        attachmentId: attachmentId,
        fileName: fileName,
        mediaType: mediaType,
      );
      
      // 创建初始的MediaAttachmentModel（上传中状态）
      final uploadingAttachment = MediaAttachmentModel(
        attachmentId: attachmentId,
        mediaType: mediaType,
        status: MediaStatus.uploading,
        originalFileName: fileName,
        storagePath: storagePath,
        fileSize: fileSize,
        uploadedAt: Timestamp.now(),
        uploadedBy: currentUser.uid,
      );
      
      // 上传文件到Firebase Storage
      final storageRef = _storage.ref().child(storagePath);
      final uploadTask = storageRef.putFile(file);
      
      // 监听上传进度
      uploadTask.snapshotEvents.listen((TaskSnapshot snapshot) {
        final progress = snapshot.bytesTransferred / snapshot.totalBytes;
        // TODO: 可以通过Stream向UI层发送进度更新
        print('上传进度: ${(progress * 100).toStringAsFixed(2)}%');
      });
      
      // 等待上传完成
      final snapshot = await uploadTask;
      final downloadUrl = await snapshot.ref.getDownloadURL();
      
      // 创建最终的MediaAttachmentModel（上传成功状态）
      final completedAttachment = uploadingAttachment.copyWith(
        status: MediaStatus.uploaded,
        downloadUrl: downloadUrl,
      );
      
      // 将MediaAttachmentModel保存到Firestore（可选，用于管理和统计）
      await _saveAttachmentMetadata(completedAttachment);
      
      return completedAttachment;
      
    } catch (e) {
      throw Exception('文件上传失败：${e.toString()}');
    }
  }

  /// 构建Firebase Storage路径
  /// 
  /// 路径格式: /media/{userId}/{mediaType}/{attachmentId}/{fileName}
  String _buildStoragePath({
    required String userId,
    required String attachmentId,
    required String fileName,
    MediaType? mediaType,
  }) {
    final typeFolder = _getMediaTypeFolder(mediaType);
    return 'media/$userId/$typeFolder/$attachmentId/$fileName';
  }

  /// 获取媒体类型对应的文件夹名称
  String _getMediaTypeFolder(MediaType? mediaType) {
    switch (mediaType) {
      case MediaType.image:
        return 'images';
      case MediaType.audio:
        return 'audio';
      case MediaType.video:
        return 'videos';
      case MediaType.document:
        return 'documents';
      default:
        return 'files';
    }
  }

  /// 保存附件元数据到Firestore
  /// 
  /// 用于管理和统计所有上传的媒体文件
  Future<void> _saveAttachmentMetadata(MediaAttachmentModel attachment) async {
    try {
      await _firestore
          .collection('media_attachments')
          .doc(attachment.attachmentId)
          .set(attachment.toJson());
    } catch (e) {
      // 元数据保存失败不应该影响主要功能
      print('保存附件元数据失败：${e.toString()}');
    }
  }

  /// 删除媒体文件
  /// 
  /// [attachmentId] 附件ID
  Future<void> deleteMediaFile(String attachmentId) async {
    try {
      // 从Firestore获取附件信息
      final doc = await _firestore
          .collection('media_attachments')
          .doc(attachmentId)
          .get();
          
      if (!doc.exists) return;
      
      final attachment = MediaAttachmentModel.fromJson(
        doc.data() as Map<String, dynamic>, 
        doc.id,
      );
      
      // 从Firebase Storage删除文件
      if (attachment.storagePath != null) {
        await _storage.ref().child(attachment.storagePath!).delete();
      }
      
      // 从Firestore删除元数据
      await _firestore
          .collection('media_attachments')
          .doc(attachmentId)
          .delete();
          
    } catch (e) {
      throw Exception('删除媒体文件失败：${e.toString()}');
    }
  }

  /// 获取媒体文件信息
  /// 
  /// [attachmentId] 附件ID
  Future<MediaAttachmentModel?> getMediaAttachment(String attachmentId) async {
    try {
      final doc = await _firestore
          .collection('media_attachments')
          .doc(attachmentId)
          .get();
          
      if (doc.exists) {
        return MediaAttachmentModel.fromJson(
          doc.data() as Map<String, dynamic>, 
          doc.id,
        );
      }
      return null;
    } catch (e) {
      throw Exception('获取媒体文件信息失败：${e.toString()}');
    }
  }

  /// 获取用户上传的所有媒体文件流
  /// 
  /// [userId] 用户ID
  Stream<List<MediaAttachmentModel>> getUserMediaStream(String userId) {
    return _firestore
        .collection('media_attachments')
        .where('uploadedBy', isEqualTo: userId)
        .orderBy('uploadedAt', descending: true)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs
          .map((doc) => MediaAttachmentModel.fromJson(
              doc.data() as Map<String, dynamic>, 
              doc.id,
            ))
          .toList();
    });
  }

  /// 压缩图片（可选功能）
  /// 
  /// [file] 原图片文件
  /// [quality] 压缩质量 (0-100)
  Future<File?> compressImage(File file, {int quality = 80}) async {
    try {
      // TODO: 可以使用 flutter_image_compress 插件实现图片压缩
      // 这里返回原文件作为占位实现
      return file;
    } catch (e) {
      throw Exception('图片压缩失败：${e.toString()}');
    }
  }

  /// 生成缩略图
  /// 
  /// [file] 原图片文件
  Future<File?> generateThumbnail(File file) async {
    try {
      // TODO: 可以实现缩略图生成逻辑
      // 这里返回null作为占位实现
      return null;
    } catch (e) {
      throw Exception('生成缩略图失败：${e.toString()}');
    }
  }

  /// 获取支持的图片格式
  static List<String> get supportedImageFormats => [
    '.jpg', '.jpeg', '.png', '.gif', '.webp'
  ];

  /// 获取支持的音频格式
  static List<String> get supportedAudioFormats => [
    '.mp3', '.aac', '.wav', '.m4a'
  ];

  /// 验证文件格式
  /// 
  /// [filePath] 文件路径
  /// [mediaType] 媒体类型
  bool validateFileFormat(String filePath, MediaType mediaType) {
    final extension = path.extension(filePath).toLowerCase();
    
    switch (mediaType) {
      case MediaType.image:
        return supportedImageFormats.contains(extension);
      case MediaType.audio:
        return supportedAudioFormats.contains(extension);
      case MediaType.video:
        // TODO: 添加视频格式支持
        return false;
      case MediaType.document:
        // TODO: 添加文档格式支持
        return false;
    }
  }

  /// 格式化文件大小显示
  /// 
  /// [bytes] 文件大小（字节）
  static String formatFileSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
  }
}
