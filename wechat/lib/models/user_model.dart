import 'package:flutter/foundation.dart';

/// 用户数据模型
/// 
/// 表示应用程序中的用户，包含用户的基本信息
class UserModel {
  /// 用户唯一标识符
  final String userId;
  
  /// 用户名/昵称
  final String username;
  
  /// 密码哈希值（注意：不是明文密码）
  final String passwordHash;
  
  /// 用户头像在 IPFS 上的内容标识符 (CID)
  /// 可以为 null，表示用户尚未设置头像
  final String? avatarIpfsCid;
  
  /// 用户创建时间
  final DateTime createdAt;
  
  /// 构造函数
  UserModel({
    required this.userId,
    required this.username,
    required this.passwordHash,
    this.avatarIpfsCid,
    required this.createdAt,
  });
  
  /// 从 JSON 创建用户模型实例
  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      userId: json['userId'] as String,
      username: json['username'] as String,
      passwordHash: json['passwordHash'] as String,
      avatarIpfsCid: json['avatarIpfsCid'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }
  
  /// 将用户模型转换为 JSON Map
  Map<String, dynamic> toJson() {
    return {
      'userId': userId,
      'username': username,
      'passwordHash': passwordHash,
      'avatarIpfsCid': avatarIpfsCid,
      'createdAt': createdAt.toIso8601String(),
    };
  }
  
  /// 创建带有更新属性的新 UserModel 实例
  UserModel copyWith({
    String? username,
    String? passwordHash,
    String? avatarIpfsCid,
    DateTime? createdAt,
  }) {
    return UserModel(
      userId: this.userId,
      username: username ?? this.username,
      passwordHash: passwordHash ?? this.passwordHash,
      avatarIpfsCid: avatarIpfsCid ?? this.avatarIpfsCid,
      createdAt: createdAt ?? this.createdAt,
    );
  }
  
  @override
  String toString() {
    return 'UserModel(userId: $userId, username: $username, avatarIpfsCid: $avatarIpfsCid)';
  }
  
  /// 获取用户头像的 IPFS 网关 URL
  /// 
  /// 如果 avatarIpfsCid 为空，则返回 null
  String? get avatarUrl {
    if (avatarIpfsCid == null || avatarIpfsCid!.isEmpty) {
      return null;
    }
    return 'https://ipfs.filebase.io/ipfs/$avatarIpfsCid';
  }
}
