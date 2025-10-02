import 'package:cloud_firestore/cloud_firestore.dart';

/// 消息状态枚举
enum MessageStatus {
  /// 发送中
  sending,
  /// 已发送
  sent,
  /// 已送达
  delivered,
  /// 已读
  read,
  /// 发送失败
  failed
}

/// 消息类型枚举
enum MessageType {
  /// 文本消息
  text,
  /// 图片消息
  image,
  /// 语音消息
  audio,
  /// 视频消息
  video,
  /// 文档消息
  document,
  /// 位置消息
  location
}

/// 消息数据模型类
/// 
/// 对应聊天室中 messages 子集合文档的结构
/// 严格遵循项目铁律定义
class MessageModel {
  /// 消息唯一ID
  final String messageId;
  
  /// 发送者UID
  final String senderId;
  
  /// 所属聊天室ID
  final String chatRoomId;
  
  /// 文本内容
  final String? text;
  
  /// 消息发送时间戳
  final Timestamp timestamp;
  
  /// 消息状态
  final MessageStatus status;
  
  /// 消息类型
  final MessageType messageType;
  
  /// 媒体文件URL (用于简单场景)
  final String? mediaUrl;
  
  /// 关联的MediaAttachmentModel的ID (用于复杂场景)
  final String? attachmentId;
  
  /// 回复的消息ID
  final String? replyToMessageId;
  
  /// 表情回应
  final List<Map<String, dynamic>> reactions;
  
  /// 构造函数
  const MessageModel({
    required this.messageId,
    required this.senderId,
    required this.chatRoomId,
    this.text,
    required this.timestamp,
    required this.status,
    required this.messageType,
    this.mediaUrl,
    this.attachmentId,
    this.replyToMessageId,
    this.reactions = const [],
  });
  
  /// 从Firestore文档数据创建MessageModel实例
  factory MessageModel.fromJson(Map<String, dynamic> json, String id) {
    return MessageModel(
      messageId: id,
      senderId: json['senderId'] ?? '',
      chatRoomId: json['chatRoomId'] ?? '',
      text: json['text'],
      timestamp: json['timestamp'] ?? Timestamp.now(),
      status: _messageStatusFromString(json['status']),
      messageType: _messageTypeFromString(json['messageType']),
      mediaUrl: json['mediaUrl'],
      attachmentId: json['attachmentId'],
      replyToMessageId: json['replyToMessageId'],
      reactions: json['reactions'] != null
          ? List<Map<String, dynamic>>.from(json['reactions'])
          : [],
    );
  }
  
  /// 将MessageModel实例转换为可存储到Firestore的Map
  Map<String, dynamic> toJson() {
    return {
      'messageId': messageId,
      'senderId': senderId,
      'chatRoomId': chatRoomId,
      'text': text,
      'timestamp': timestamp,
      'status': _messageStatusToString(status),
      'messageType': _messageTypeToString(messageType),
      'mediaUrl': mediaUrl,
      'attachmentId': attachmentId,
      'replyToMessageId': replyToMessageId,
      'reactions': reactions,
    };
  }
  
  /// 创建MessageModel的副本，可选择性地更新某些字段
  MessageModel copyWith({
    String? messageId,
    String? senderId,
    String? chatRoomId,
    String? text,
    Timestamp? timestamp,
    MessageStatus? status,
    MessageType? messageType,
    String? mediaUrl,
    String? attachmentId,
    String? replyToMessageId,
    List<Map<String, dynamic>>? reactions,
  }) {
    return MessageModel(
      messageId: messageId ?? this.messageId,
      senderId: senderId ?? this.senderId,
      chatRoomId: chatRoomId ?? this.chatRoomId,
      text: text ?? this.text,
      timestamp: timestamp ?? this.timestamp,
      status: status ?? this.status,
      messageType: messageType ?? this.messageType,
      mediaUrl: mediaUrl ?? this.mediaUrl,
      attachmentId: attachmentId ?? this.attachmentId,
      replyToMessageId: replyToMessageId ?? this.replyToMessageId,
      reactions: reactions ?? this.reactions,
    );
  }
  
  /// 将MessageStatus枚举转换为字符串
  static String _messageStatusToString(MessageStatus status) {
    return status.toString().split('.').last;
  }
  
  /// 将字符串转换为MessageStatus枚举
  static MessageStatus _messageStatusFromString(String? statusString) {
    switch (statusString) {
      case 'sending':
        return MessageStatus.sending;
      case 'sent':
        return MessageStatus.sent;
      case 'delivered':
        return MessageStatus.delivered;
      case 'read':
        return MessageStatus.read;
      case 'failed':
        return MessageStatus.failed;
      default:
        return MessageStatus.sent;
    }
  }
  
  /// 将MessageType枚举转换为字符串
  static String _messageTypeToString(MessageType type) {
    return type.toString().split('.').last;
  }
  
  /// 将字符串转换为MessageType枚举
  static MessageType _messageTypeFromString(String? typeString) {
    switch (typeString) {
      case 'text':
        return MessageType.text;
      case 'image':
        return MessageType.image;
      case 'audio':
        return MessageType.audio;
      case 'video':
        return MessageType.video;
      case 'document':
        return MessageType.document;
      case 'location':
        return MessageType.location;
      default:
        return MessageType.text;
    }
  }
  
  /// 格式化时间显示
  /// 
  /// 返回用户友好的时间格式
  String get formattedTime {
    final DateTime dateTime = timestamp.toDate();
    final DateTime now = DateTime.now();
    final Duration difference = now.difference(dateTime);
    
    if (difference.inDays > 0) {
      return '${difference.inDays}天前';
    } else if (difference.inHours > 0) {
      return '${difference.inHours}小时前';
    } else if (difference.inMinutes > 0) {
      return '${difference.inMinutes}分钟前';
    } else {
      return '刚刚';
    }
  }
  
  /// 获取状态显示文本
  String get statusText {
    switch (status) {
      case MessageStatus.sending:
        return '发送中';
      case MessageStatus.sent:
        return '已发送';
      case MessageStatus.delivered:
        return '已送达';
      case MessageStatus.read:
        return '已读';
      case MessageStatus.failed:
        return '发送失败';
    }
  }
  
  /// 获取消息内容摘要（用于通知显示）
  String get contentSummary {
    switch (messageType) {
      case MessageType.text:
        return text ?? '';
      case MessageType.image:
        return '[图片]';
      case MessageType.audio:
        return '[语音]';
      case MessageType.video:
        return '[视频]';
      case MessageType.document:
        return '[文档]';
      case MessageType.location:
        return '[位置]';
    }
  }
  
  /// 判断是否为多媒体消息
  bool get isMediaMessage {
    return messageType != MessageType.text;
  }
  
  /// 判断是否为回复消息
  bool get isReplyMessage {
    return replyToMessageId != null && replyToMessageId!.isNotEmpty;
  }
  
  /// 获取表情回应总数
  int get totalReactions {
    return reactions.fold<int>(0, (sum, reaction) {
      final count = reaction['count'] as int? ?? 0;
      return sum + count;
    });
  }
  
  @override
  String toString() {
    return 'MessageModel(messageId: $messageId, senderId: $senderId, type: $messageType, content: ${contentSummary.length > 10 ? contentSummary.substring(0, 10) + '...' : contentSummary})';
  }
  
  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is MessageModel && other.messageId == messageId;
  }
  
  @override
  int get hashCode => messageId.hashCode;
}
