/// 用户资料数据模型 - 与Supabase数据库的profiles表对应
class Profile {
  final String id; // UUID类型，来自auth.users.id
  final String? fullName; // 用户全名
  final String role; // 用户角色：teacher 或 admin
  final DateTime? updatedAt; // 最后更新时间

  Profile({
    required this.id,
    this.fullName,
    this.role = 'teacher', // 默认为普通老师
    this.updatedAt,
  });

  /// 从JSON创建Profile对象
  factory Profile.fromJson(Map<String, dynamic> json) {
    return Profile(
      id: json['id'] as String,
      fullName: json['full_name'] as String?,
      role: json['role'] as String? ?? 'teacher', // 默认为teacher
      updatedAt: json['updated_at'] != null
          ? DateTime.parse(json['updated_at'] as String)
          : null,
    );
  }

  /// 转换为JSON
  Map<String, dynamic> toJson() {
    final Map<String, dynamic> data = {
      'id': id,
      'role': role,
    };
    
    if (fullName != null) data['full_name'] = fullName;
    if (updatedAt != null) data['updated_at'] = updatedAt!.toIso8601String();
    
    return data;
  }

  /// 创建副本
  Profile copyWith({
    String? id,
    String? fullName,
    String? role,
    DateTime? updatedAt,
  }) {
    return Profile(
      id: id ?? this.id,
      fullName: fullName ?? this.fullName,
      role: role ?? this.role,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
  
  /// 判断是否为管理员
  bool get isAdmin => role == 'admin';
  
  /// 判断是否为普通老师
  bool get isTeacher => role == 'teacher';
}
