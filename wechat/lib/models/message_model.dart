import 'package:flutter/foundation.dart';

/// 消息类型枚举
class MessageType {
  /// 文本消息
  static const String text = 'text';
  
  /// 图片消息
  static const String image = 'image';
  
  /// 表情包消息
  static const String emoji = 'emoji';
}

/// 会话类型枚举
class ConversationType {
  /// 私聊
  static const String direct = 'direct';
  
  /// 群聊
  static const String group = 'group';
}

/// 消息状态枚举
class MessageStatus {
  /// 正在发送中
  static const String sending = 'sending';
  
  /// 已发送，但可能未送达
  static const String sent = 'sent';
  
  /// 已送达给接收方
  static const String delivered = 'delivered';
  
  /// 接收方已阅读
  static const String read = 'read';
  
  /// 发送失败
  static const String failed = 'failed';
}

/// 聊天消息模型
///
/// 表示应用程序中的单条聊天消息，支持私聊和群聊
class MessageModel {
  /// 消息的唯一标识符
  final String messageId;
  
  /// 发送方的用户ID
  final String senderId;
  
  /// 接收方的ID
  /// 对于私聊，这是接收用户的ID
  /// 对于群聊，这是群组的ID
  final String receiverId;
  
  /// 会话类型
  /// 可以是 'direct'（私聊）或 'group'（群聊）
  /// 请使用 [ConversationType] 类中的常量
  final String conversationType;
  
  /// 消息发送的时间戳
  final DateTime timestamp;
  
  /// 消息类型
  /// 可以是 'text'（文本消息）或 'image'（图片消息）等
  /// 请使用 [MessageType] 类中的常量
  final String messageType;
  
  /// 消息的具体内容
  /// 对于文本消息，这是文本字符串
  /// 对于图片消息，这是图片在 Filebase 的 IPFS CID
  final String content;
  
  /// 消息状态
  /// 可以是 'sent', 'delivered', 'read' 或 'failed'
  /// 请使用 [MessageStatus] 类中的常量
  final String status;
  
  /// 发送者名称（可选，群聊中显示）
  final String? senderName;
  
  /// 构造函数
  MessageModel({
    required this.messageId,
    required this.senderId,
    required this.receiverId,
    this.conversationType = ConversationType.direct,
    required this.timestamp,
    required this.messageType,
    required this.content,
    this.status = MessageStatus.sent,
    this.senderName,
  });
  
  /// 从 JSON 创建消息模型实例
  factory MessageModel.fromJson(Map<String, dynamic> json) {
    return MessageModel(
      messageId: json['messageId'] as String,
      senderId: json['senderId'] as String,
      receiverId: json['receiverId'] as String,
      conversationType: json['conversationType'] as String? ?? ConversationType.direct,
      timestamp: DateTime.parse(json['timestamp'] as String),
      messageType: json['messageType'] as String,
      content: json['content'] as String,
      status: json['status'] as String? ?? MessageStatus.sent,
      senderName: json['senderName'] as String?,
    );
  }
  
  /// 将消息模型转换为 JSON Map
  Map<String, dynamic> toJson() {
    return {
      'messageId': messageId,
      'senderId': senderId,
      'receiverId': receiverId,
      'conversationType': conversationType,
      'timestamp': timestamp.toIso8601String(),
      'messageType': messageType,
      'content': content,
      'status': status,
      if (senderName != null) 'senderName': senderName,
    };
  }
  
  /// 创建带有更新属性的新 MessageModel 实例
  MessageModel copyWith({
    String? messageId,
    String? senderId,
    String? receiverId,
    String? conversationType,
    DateTime? timestamp,
    String? messageType,
    String? content,
    String? status,
    String? senderName,
  }) {
    return MessageModel(
      messageId: messageId ?? this.messageId,
      senderId: senderId ?? this.senderId,
      receiverId: receiverId ?? this.receiverId,
      conversationType: conversationType ?? this.conversationType,
      timestamp: timestamp ?? this.timestamp,
      messageType: messageType ?? this.messageType,
      content: content ?? this.content,
      status: status ?? this.status,
      senderName: senderName ?? this.senderName,
    );
  }
  
  /// 判断消息是否为文本消息
  bool get isTextMessage => messageType == MessageType.text;
  
  /// 判断消息是否为图片消息
  bool get isImageMessage => messageType == MessageType.image;
  
  /// 判断消息是否为表情包消息
  bool get isEmojiMessage => messageType == MessageType.emoji;
  
  /// 获取图片的 IPFS 网关 URL
  /// 如果消息类型不是图片，则返回 null
  String? get imageUrl {
    if (isImageMessage) {
      return 'https://ipfs.filebase.io/ipfs/$content';
    }
    return null;
  }
  
  /// 获取表情包ID或URL
  /// 对于表情包消息，content存储表情包ID或完整URL
  String? get emojiSource {
    if (isEmojiMessage) {
      return content;
    }
    return null;
  }
  
  /// 根据提供的用户ID判断是否为发送的消息（而非接收的消息）
  bool isSentByUser(String userId) => senderId == userId;
  
  @override
  String toString() {
    return 'MessageModel(messageId: $messageId, senderId: $senderId, receiverId: $receiverId, '
           'conversationType: $conversationType, timestamp: $timestamp, messageType: $messageType, status: $status)';
  }
  
  /// 判断消息是否为群聊消息
  bool get isGroupMessage => conversationType == ConversationType.group;
  
  /// 判断消息是否为私聊消息
  bool get isDirectMessage => conversationType == ConversationType.direct;
  
  /// 获取显示名称（群聊中使用）
  String get displayName => senderName ?? '未知用户';
  
  /// 获取包含年月日的格式化日期字符串
  String get formattedDate {
    return '${timestamp.year}-${timestamp.month.toString().padLeft(2, '0')}-${timestamp.day.toString().padLeft(2, '0')}';
  }
  
  /// 获取包含小时分钟的格式化时间字符串
  String get formattedTime {
    return '${timestamp.hour.toString().padLeft(2, '0')}:${timestamp.minute.toString().padLeft(2, '0')}';
  }
}
