/// 群组角色枚举
enum GroupRole {
  /// 群主
  owner,
  /// 管理员
  admin,
  /// 普通成员
  member,
}

/// 群组成员模型
class GroupMember {
  /// 用户ID
  final String userId;
  /// 角色
  final GroupRole role;
  /// 加入时间
  final DateTime joinedAt;

  const GroupMember({
    required this.userId,
    required this.role,
    required this.joinedAt,
  });

  /// 从JSON创建实例
  factory GroupMember.fromJson(Map<String, dynamic> json) {
    return GroupMember(
      userId: json['userId'],
      role: GroupRole.values.firstWhere(
        (e) => e.toString().split('.').last == json['role'],
        orElse: () => GroupRole.member,
      ),
      joinedAt: DateTime.parse(json['joinedAt']),
    );
  }

  /// 转换为JSON
  Map<String, dynamic> toJson() {
    return {
      'userId': userId,
      'role': role.toString().split('.').last,
      'joinedAt': joinedAt.toIso8601String(),
    };
  }

  /// 复制并更新
  GroupMember copyWith({
    String? userId,
    GroupRole? role,
    DateTime? joinedAt,
  }) {
    return GroupMember(
      userId: userId ?? this.userId,
      role: role ?? this.role,
      joinedAt: joinedAt ?? this.joinedAt,
    );
  }
}
