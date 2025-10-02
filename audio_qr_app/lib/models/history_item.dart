/// 历史记录数据模型
class HistoryItem {
  final String id;
  final String fileName;
  final String filePath;
  final String fileExtension;
  final int fileSize;
  final String downloadUrl;
  final String qrData;
  final DateTime createdAt;
  final bool isFavorite;
  
  const HistoryItem({
    required this.id,
    required this.fileName,
    required this.filePath,
    required this.fileExtension,
    required this.fileSize,
    required this.downloadUrl,
    required this.qrData,
    required this.createdAt,
    this.isFavorite = false,
  });
  
  /// 从Map创建HistoryItem
  factory HistoryItem.fromMap(Map<String, dynamic> map) {
    return HistoryItem(
      id: map['id'] ?? '',
      fileName: map['fileName'] ?? '',
      filePath: map['filePath'] ?? '',
      fileExtension: map['fileExtension'] ?? '',
      fileSize: map['fileSize'] ?? 0,
      downloadUrl: map['downloadUrl'] ?? '',
      qrData: map['qrData'] ?? '',
      createdAt: _parseDateTime(map['createdAt']),
      isFavorite: map['isFavorite'] ?? false,
    );
  }
  
  /// 安全解析DateTime
  static DateTime _parseDateTime(dynamic dateTimeStr) {
    try {
      if (dateTimeStr == null) return DateTime.now();
      if (dateTimeStr is String && dateTimeStr.isNotEmpty) {
        return DateTime.parse(dateTimeStr);
      }
      return DateTime.now();
    } catch (e) {
      // 解析失败时返回当前时间
      return DateTime.now();
    }
  }
  
  /// 转换为Map
  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'fileName': fileName,
      'filePath': filePath,
      'fileExtension': fileExtension,
      'fileSize': fileSize,
      'downloadUrl': downloadUrl,
      'qrData': qrData,
      'createdAt': createdAt.toIso8601String(),
      'isFavorite': isFavorite,
    };
  }
  
  /// 复制并修改字段
  HistoryItem copyWith({
    String? id,
    String? fileName,
    String? filePath,
    String? fileExtension,
    int? fileSize,
    String? downloadUrl,
    String? qrData,
    DateTime? createdAt,
    bool? isFavorite,
  }) {
    return HistoryItem(
      id: id ?? this.id,
      fileName: fileName ?? this.fileName,
      filePath: filePath ?? this.filePath,
      fileExtension: fileExtension ?? this.fileExtension,
      fileSize: fileSize ?? this.fileSize,
      downloadUrl: downloadUrl ?? this.downloadUrl,
      qrData: qrData ?? this.qrData,
      createdAt: createdAt ?? this.createdAt,
      isFavorite: isFavorite ?? this.isFavorite,
    );
  }
  
  /// 格式化文件大小
  String get formattedFileSize {
    const units = ['B', 'KB', 'MB', 'GB'];
    double size = fileSize.toDouble();
    int unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return '${size.toStringAsFixed(size < 10 && unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}';
  }
  
  /// 格式化创建时间
  String get formattedCreatedAt {
    final now = DateTime.now();
    final difference = now.difference(createdAt);
    
    if (difference.inMinutes < 1) {
      return '刚刚';
    } else if (difference.inHours < 1) {
      return '${difference.inMinutes}分钟前';
    } else if (difference.inDays < 1) {
      return '${difference.inHours}小时前';
    } else if (difference.inDays < 7) {
      return '${difference.inDays}天前';
    } else {
      return '${createdAt.year}年${createdAt.month}月${createdAt.day}日';
    }
  }
  
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is HistoryItem &&
          runtimeType == other.runtimeType &&
          id == other.id;
          
  @override
  int get hashCode => id.hashCode;
  
  @override
  String toString() {
    return 'HistoryItem(id: $id, fileName: $fileName, createdAt: $createdAt)';
  }
}