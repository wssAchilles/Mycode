import 'package:cloud_firestore/cloud_firestore.dart';

/// 好友请求状态枚举
enum FriendRequestStatus {
  /// 待处理
  pending,
  /// 已接受
  accepted,
  /// 已拒绝
  declined,
}

/// 好友请求数据模型类
/// 
/// 对应Firestore中friend_requests集合的文档结构
/// 管理用户之间的好友请求状态和流程
class FriendRequestModel {
  /// 请求唯一ID
  final String requestId;
  
  /// 发送请求的用户UID
  final String senderId;
  
  /// 接收请求的用户UID
  final String receiverId;
  
  /// 请求状态
  final FriendRequestStatus status;
  
  /// 请求创建时间
  final Timestamp createdAt;
  
  /// 请求最后更新时间
  final Timestamp updatedAt;
  
  /// 构造函数
  const FriendRequestModel({
    required this.requestId,
    required this.senderId,
    required this.receiverId,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
  });
  
  /// 从Firestore文档数据创建FriendRequestModel实例
  /// 
  /// [json] Firestore文档的数据
  /// [id] 文档ID（即请求ID）
  factory FriendRequestModel.fromJson(Map<String, dynamic> json, String id) {
    return FriendRequestModel(
      requestId: id,
      senderId: json['senderId'] ?? '',
      receiverId: json['receiverId'] ?? '',
      status: _parseStatus(json['status']),
      createdAt: json['createdAt'] ?? Timestamp.now(),
      updatedAt: json['updatedAt'] ?? Timestamp.now(),
    );
  }
  
  /// 将FriendRequestModel实例转换为可存储到Firestore的Map
  Map<String, dynamic> toJson() {
    return {
      'senderId': senderId,
      'receiverId': receiverId,
      'status': status.name,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
    };
  }
  
  /// 创建FriendRequestModel的副本，可选择性地更新某些字段
  FriendRequestModel copyWith({
    String? requestId,
    String? senderId,
    String? receiverId,
    FriendRequestStatus? status,
    Timestamp? createdAt,
    Timestamp? updatedAt,
  }) {
    return FriendRequestModel(
      requestId: requestId ?? this.requestId,
      senderId: senderId ?? this.senderId,
      receiverId: receiverId ?? this.receiverId,
      status: status ?? this.status,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
  
  /// 解析字符串状态为枚举
  static FriendRequestStatus _parseStatus(dynamic status) {
    if (status == null) return FriendRequestStatus.pending;
    
    switch (status.toString()) {
      case 'pending':
        return FriendRequestStatus.pending;
      case 'accepted':
        return FriendRequestStatus.accepted;
      case 'declined':
        return FriendRequestStatus.declined;
      default:
        return FriendRequestStatus.pending;
    }
  }
  
  /// 生成好友请求ID
  /// 
  /// 基于发送者和接收者UID生成唯一请求ID
  /// 确保同一对用户之间只能有一个活跃请求
  static String generateRequestId(String senderId, String receiverId) {
    final ids = [senderId, receiverId]..sort();
    return '${ids[0]}_${ids[1]}';
  }
  
  /// 判断请求是否为待处理状态
  bool get isPending => status == FriendRequestStatus.pending;
  
  /// 判断请求是否已接受
  bool get isAccepted => status == FriendRequestStatus.accepted;
  
  /// 判断请求是否已拒绝
  bool get isDeclined => status == FriendRequestStatus.declined;
  
  @override
  String toString() {
    return 'FriendRequestModel(requestId: $requestId, senderId: $senderId, receiverId: $receiverId, status: $status)';
  }
  
  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is FriendRequestModel && other.requestId == requestId;
  }
  
  @override
  int get hashCode => requestId.hashCode;
}
