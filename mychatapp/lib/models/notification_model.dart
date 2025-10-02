import 'package:cloud_firestore/cloud_firestore.dart';

/// 通知类型枚举
enum NotificationType {
  /// 新消息
  newMessage,
  /// 群组邀请
  groupInvitation,
  /// 好友请求
  friendRequest,
  /// 系统
  system,
  /// 活动
  activity
}

/// 通知数据模型类
/// 
/// 对应Firestore中notifications集合的文档结构
/// 严格遵循项目铁律定义
class NotificationModel {
  /// 通知唯一ID
  final String notificationId;
  
  /// 接收者UID
  final String recipientId;
  
  /// 通知标题
  final String title;
  
  /// 通知内容
  final String body;
  
  /// 通知类型
  final NotificationType type;
  
  /// 创建时间
  final Timestamp createdAt;
  
  /// 是否已读
  final bool isRead;
  
  /// 附加数据，如chatRoomId
  final Map<String, dynamic>? data;
  
  /// 构造函数
  const NotificationModel({
    required this.notificationId,
    required this.recipientId,
    required this.title,
    required this.body,
    required this.type,
    required this.createdAt,
    this.isRead = false,
    this.data,
  });
  
  /// 从Firestore文档数据创建NotificationModel实例
  /// 
  /// [json] Firestore文档的数据
  /// [id] 文档ID（notificationId）
  factory NotificationModel.fromJson(Map<String, dynamic> json, String id) {
    return NotificationModel(
      notificationId: id,
      recipientId: json['recipientId'] ?? '',
      title: json['title'] ?? '',
      body: json['body'] ?? '',
      type: _notificationTypeFromString(json['type']),
      createdAt: json['createdAt'] ?? Timestamp.now(),
      isRead: json['isRead'] ?? false,
      data: json['data'] != null 
          ? Map<String, dynamic>.from(json['data'])
          : null,
    );
  }
  
  /// 将NotificationModel实例转换为可存储到Firestore的Map
  Map<String, dynamic> toJson() {
    return {
      'notificationId': notificationId,
      'recipientId': recipientId,
      'title': title,
      'body': body,
      'type': _notificationTypeToString(type),
      'createdAt': createdAt,
      'isRead': isRead,
      'data': data,
    };
  }
  
  /// 创建NotificationModel的副本，可选择性地更新某些字段
  NotificationModel copyWith({
    String? notificationId,
    String? recipientId,
    String? title,
    String? body,
    NotificationType? type,
    Timestamp? createdAt,
    bool? isRead,
    Map<String, dynamic>? data,
  }) {
    return NotificationModel(
      notificationId: notificationId ?? this.notificationId,
      recipientId: recipientId ?? this.recipientId,
      title: title ?? this.title,
      body: body ?? this.body,
      type: type ?? this.type,
      createdAt: createdAt ?? this.createdAt,
      isRead: isRead ?? this.isRead,
      data: data ?? this.data,
    );
  }
  
  /// 将NotificationType枚举转换为字符串
  static String _notificationTypeToString(NotificationType type) {
    return type.toString().split('.').last;
  }
  
  /// 将字符串转换为NotificationType枚举
  static NotificationType _notificationTypeFromString(String? typeString) {
    switch (typeString) {
      case 'newMessage':
        return NotificationType.newMessage;
      case 'groupInvitation':
        return NotificationType.groupInvitation;
      case 'friendRequest':
        return NotificationType.friendRequest;
      case 'system':
        return NotificationType.system;
      case 'activity':
        return NotificationType.activity;
      default:
        return NotificationType.system;
    }
  }
}
