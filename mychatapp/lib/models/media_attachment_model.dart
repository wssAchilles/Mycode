import 'package:cloud_firestore/cloud_firestore.dart';

/// 媒体类型枚举
enum MediaType {
  /// 图片
  image,
  /// 音频
  audio,
  /// 视频
  video,
  /// 文档
  document
}

/// 媒体状态枚举
enum MediaStatus {
  /// 上传中
  uploading,
  /// 已上传
  uploaded,
  /// 处理中
  processing,
  /// 就绪
  ready,
  /// 失败
  failed
}

/// 媒体附件数据模型类
/// 
/// 对应Firebase Storage中媒体文件的元数据结构
/// 严格遵循项目铁律定义
class MediaAttachmentModel {
  /// 附件唯一ID
  final String attachmentId;
  
  /// 媒体类型
  final MediaType mediaType;
  
  /// 附件状态
  final MediaStatus status;
  
  /// 原始文件名
  final String originalFileName;
  
  /// 在Firebase Storage中的路径
  final String storagePath;
  
  /// 可访问的下载URL
  final String? downloadUrl;
  
  /// 文件大小（字节）
  final int fileSize;
  
  /// 上传时间
  final Timestamp uploadedAt;
  
  /// 上传者UID
  final String uploadedBy;
  
  /// 缩略图URL
  final String? thumbnailUrl;
  
  /// 媒体时长（秒）
  final int? duration;
  
  /// 构造函数
  const MediaAttachmentModel({
    required this.attachmentId,
    required this.mediaType,
    required this.status,
    required this.originalFileName,
    required this.storagePath,
    this.downloadUrl,
    required this.fileSize,
    required this.uploadedAt,
    required this.uploadedBy,
    this.thumbnailUrl,
    this.duration,
  });
  
  /// 从Firestore文档数据创建MediaAttachmentModel实例
  /// 
  /// [json] Firestore文档的数据
  /// [id] 文档ID（attachmentId）
  factory MediaAttachmentModel.fromJson(Map<String, dynamic> json, String id) {
    return MediaAttachmentModel(
      attachmentId: id,
      mediaType: _mediaTypeFromString(json['mediaType']),
      status: _mediaStatusFromString(json['status']),
      originalFileName: json['originalFileName'] ?? '',
      storagePath: json['storagePath'] ?? '',
      downloadUrl: json['downloadUrl'],
      fileSize: json['fileSize'] ?? 0,
      uploadedAt: json['uploadedAt'] ?? Timestamp.now(),
      uploadedBy: json['uploadedBy'] ?? '',
      thumbnailUrl: json['thumbnailUrl'],
      duration: json['duration'],
    );
  }
  
  /// 将MediaAttachmentModel实例转换为可存储到Firestore的Map
  Map<String, dynamic> toJson() {
    return {
      'attachmentId': attachmentId,
      'mediaType': _mediaTypeToString(mediaType),
      'status': _mediaStatusToString(status),
      'originalFileName': originalFileName,
      'storagePath': storagePath,
      'downloadUrl': downloadUrl,
      'fileSize': fileSize,
      'uploadedAt': uploadedAt,
      'uploadedBy': uploadedBy,
      'thumbnailUrl': thumbnailUrl,
      'duration': duration,
    };
  }
  
  /// 创建MediaAttachmentModel的副本，可选择性地更新某些字段
  MediaAttachmentModel copyWith({
    String? attachmentId,
    MediaType? mediaType,
    MediaStatus? status,
    String? originalFileName,
    String? storagePath,
    String? downloadUrl,
    int? fileSize,
    Timestamp? uploadedAt,
    String? uploadedBy,
    String? thumbnailUrl,
    int? duration,
  }) {
    return MediaAttachmentModel(
      attachmentId: attachmentId ?? this.attachmentId,
      mediaType: mediaType ?? this.mediaType,
      status: status ?? this.status,
      originalFileName: originalFileName ?? this.originalFileName,
      storagePath: storagePath ?? this.storagePath,
      downloadUrl: downloadUrl ?? this.downloadUrl,
      fileSize: fileSize ?? this.fileSize,
      uploadedAt: uploadedAt ?? this.uploadedAt,
      uploadedBy: uploadedBy ?? this.uploadedBy,
      thumbnailUrl: thumbnailUrl ?? this.thumbnailUrl,
      duration: duration ?? this.duration,
    );
  }
  
  /// 将MediaType枚举转换为字符串
  static String _mediaTypeToString(MediaType type) {
    return type.toString().split('.').last;
  }
  
  /// 将字符串转换为MediaType枚举
  static MediaType _mediaTypeFromString(String? typeString) {
    switch (typeString) {
      case 'image':
        return MediaType.image;
      case 'audio':
        return MediaType.audio;
      case 'video':
        return MediaType.video;
      case 'document':
        return MediaType.document;
      default:
        return MediaType.image;
    }
  }
  
  /// 将MediaStatus枚举转换为字符串
  static String _mediaStatusToString(MediaStatus status) {
    return status.toString().split('.').last;
  }
  
  /// 将字符串转换为MediaStatus枚举
  static MediaStatus _mediaStatusFromString(String? statusString) {
    switch (statusString) {
      case 'uploading':
        return MediaStatus.uploading;
      case 'uploaded':
        return MediaStatus.uploaded;
      case 'processing':
        return MediaStatus.processing;
      case 'ready':
        return MediaStatus.ready;
      case 'failed':
        return MediaStatus.failed;
      default:
        return MediaStatus.uploading;
    }
  }
}
