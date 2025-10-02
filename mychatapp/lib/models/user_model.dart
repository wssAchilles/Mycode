import 'package:cloud_firestore/cloud_firestore.dart';

/// 用户数据模型类
/// 
/// 对应Firestore中users集合的文档结构
/// 严格遵循项目铁律定义：{uid, email, displayName, photoUrl, createdAt, fcmToken}
class UserModel {
  /// 用户唯一ID
  final String uid;
  
  /// 用户注册邮箱
  final String email;
  
  /// 用户显示昵称
  final String displayName;
  
  /// 用户头像URL
  final String? photoUrl;
  
  /// 用户创建时间
  final Timestamp createdAt;
  
  /// FCM设备令牌
  final String? fcmToken;
  
  /// 好友列表 - 存储该用户所有好友的UID
  final List<String> friendIds;
  
  /// 构造函数
  const UserModel({
    required this.uid,
    required this.email,
    required this.displayName,
    this.photoUrl,
    required this.createdAt,
    this.fcmToken,
    this.friendIds = const [],
  });
  
  /// 从Firestore文档数据创建UserModel实例
  /// 
  /// [json] Firestore文档的数据
  /// [id] 文档ID（即用户UID）
  factory UserModel.fromJson(Map<String, dynamic> json, String id) {
    return UserModel(
      uid: id,
      email: json['email'] ?? '',
      displayName: json['displayName'] ?? '',
      photoUrl: json['photoUrl'],
      createdAt: json['createdAt'] ?? Timestamp.now(),
      fcmToken: json['fcmToken'],
      friendIds: List<String>.from(json['friendIds'] ?? []),
    );
  }
  
  /// 将UserModel实例转换为可存储到Firestore的Map
  Map<String, dynamic> toJson() {
    return {
      'uid': uid,
      'email': email,
      'displayName': displayName,
      'photoUrl': photoUrl,
      'createdAt': createdAt,
      'fcmToken': fcmToken,
      'friendIds': friendIds,
    };
  }
  
  /// 创建UserModel的副本，可选择性地更新某些字段
  UserModel copyWith({
    String? uid,
    String? email,
    String? displayName,
    String? photoUrl,
    Timestamp? createdAt,
    String? fcmToken,
    List<String>? friendIds,
  }) {
    return UserModel(
      uid: uid ?? this.uid,
      email: email ?? this.email,
      displayName: displayName ?? this.displayName,
      photoUrl: photoUrl ?? this.photoUrl,
      createdAt: createdAt ?? this.createdAt,
      fcmToken: fcmToken ?? this.fcmToken,
      friendIds: friendIds ?? this.friendIds,
    );
  }
  
  @override
  String toString() {
    return 'UserModel(uid: $uid, email: $email, displayName: $displayName)';
  }
  
  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is UserModel && other.uid == uid;
  }
  
  @override
  int get hashCode => uid.hashCode;
}
