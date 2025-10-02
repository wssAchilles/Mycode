import 'package:cloud_firestore/cloud_firestore.dart';

/// 在线状态枚举
enum PresenceStatus {
  /// 在线
  online,
  /// 离开
  away,
  /// 忙碌
  busy,
  /// 隐身
  invisible,
  /// 离线
  offline
}

/// 在线状态数据模型类
/// 
/// 对应Firebase Realtime Database中presence节点的数据结构
/// 严格遵循项目铁律定义
class PresenceModel {
  /// 用户UID
  final String userId;
  
  /// 在线状态
  final PresenceStatus status;
  
  /// 最后活跃时间
  final Timestamp lastActiveAt;
  
  /// 正在输入的聊天室ID
  final String? typingInChatRoom;
  
  /// 构造函数
  const PresenceModel({
    required this.userId,
    required this.status,
    required this.lastActiveAt,
    this.typingInChatRoom,
  });
  
  /// 从数据库数据创建PresenceModel实例
  /// 
  /// [json] 数据库的数据
  /// [id] 用户UID
  factory PresenceModel.fromJson(Map<String, dynamic> json, String id) {
    return PresenceModel(
      userId: id,
      status: _statusFromString(json['status']),
      lastActiveAt: json['lastActiveAt'] ?? Timestamp.now(),
      typingInChatRoom: json['typingInChatRoom'],
    );
  }
  
  /// 将PresenceModel实例转换为可存储到数据库的Map
  Map<String, dynamic> toJson() {
    return {
      'userId': userId,
      'status': _statusToString(status),
      'lastActiveAt': lastActiveAt,
      'typingInChatRoom': typingInChatRoom,
    };
  }
  
  /// 创建PresenceModel的副本，可选择性地更新某些字段
  PresenceModel copyWith({
    String? userId,
    PresenceStatus? status,
    Timestamp? lastActiveAt,
    String? typingInChatRoom,
  }) {
    return PresenceModel(
      userId: userId ?? this.userId,
      status: status ?? this.status,
      lastActiveAt: lastActiveAt ?? this.lastActiveAt,
      typingInChatRoom: typingInChatRoom ?? this.typingInChatRoom,
    );
  }
  
  /// 将PresenceStatus枚举转换为字符串
  static String _statusToString(PresenceStatus status) {
    return status.toString().split('.').last;
  }
  
  /// 将字符串转换为PresenceStatus枚举
  static PresenceStatus _statusFromString(String? statusString) {
    switch (statusString) {
      case 'online':
        return PresenceStatus.online;
      case 'away':
        return PresenceStatus.away;
      case 'busy':
        return PresenceStatus.busy;
      case 'invisible':
        return PresenceStatus.invisible;
      case 'offline':
        return PresenceStatus.offline;
      default:
        return PresenceStatus.offline;
    }
  }
}
