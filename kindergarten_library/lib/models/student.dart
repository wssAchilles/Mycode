/// 学生数据模型
class Student {
  final int? id;
  final String fullName; // 学生姓名
  final String? className; // 班级名称，如"大班A"、"中班B"等
  final DateTime? createdAt;

  Student({
    this.id,
    required this.fullName,
    this.className,
    this.createdAt,
  });

  /// 从JSON创建Student对象
  factory Student.fromJson(Map<String, dynamic> json) {
    return Student(
      id: json['id'] as int?,
      fullName: json['full_name'] as String,
      className: json['class_name'] as String?,
      createdAt: json['created_at'] != null
          ? DateTime.parse(json['created_at'] as String)
          : null,
    );
  }

  /// 转换为JSON
  Map<String, dynamic> toJson() {
    final Map<String, dynamic> data = {
      'full_name': fullName,
    };
    
    if (id != null) data['id'] = id;
    if (className != null) data['class_name'] = className;
    if (createdAt != null) data['created_at'] = createdAt!.toIso8601String();
    
    return data;
  }

  /// 创建副本
  Student copyWith({
    int? id,
    String? fullName,
    String? className,
    DateTime? createdAt,
  }) {
    return Student(
      id: id ?? this.id,
      fullName: fullName ?? this.fullName,
      className: className ?? this.className,
      createdAt: createdAt ?? this.createdAt,
    );
  }
}
