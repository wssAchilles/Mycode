/// 借阅记录数据模型
class BorrowRecord {
  final int id;
  final int bookId;
  final int? studentId; // 学生ID（如果是学生借阅）
  final String? profileId; // 老师profile ID（如果是老师借阅）
  final DateTime borrowDate; // 借阅日期
  final DateTime? dueDate; // 应还日期
  final DateTime? returnDate; // 实际归还日期
  final String borrowedByUserId; // 经办老师ID
  final DateTime? createdAt;
  final int quantity; // 本次借阅的数量
  
  // 便利字段 - 用于UI显示
  final String? bookTitle;
  final String? studentName;
  final String? teacherName; // 老师姓名（如果是老师借阅）
  final String? bookAuthor;
  final String? bookCoverImageUrl;
  final String? borrowerTeacherName; // 借阅老师姓名（通过profile_id关联）
  final String? handlerTeacherName; // 经办老师姓名（通过borrowed_by_user_id关联）

  BorrowRecord({
    required this.id,
    required this.bookId,
    this.studentId,
    this.profileId,
    required this.borrowDate,
    this.dueDate,
    this.returnDate,
    required this.borrowedByUserId,
    this.createdAt,
    this.quantity = 1, // 默认数量为1
    this.bookTitle,
    this.studentName,
    this.teacherName,
    this.bookAuthor,
    this.bookCoverImageUrl,
    this.borrowerTeacherName,
    this.handlerTeacherName,
  });

  /// 判断是否已归还
  bool get isReturned => returnDate != null;

  /// 判断是否逾期
  bool get isOverdue {
    if (isReturned || dueDate == null) return false;
    return DateTime.now().isAfter(dueDate!);
  }

  /// 计算剩余天数或逾期天数
  int get daysRemaining {
    if (isReturned || dueDate == null) return 0;
    final now = DateTime.now();
    final difference = dueDate!.difference(now).inDays;
    return difference;
  }

  /// 从JSON创建对象
  factory BorrowRecord.fromJson(Map<String, dynamic> json) {
    final studentName = json['students']?['full_name'] as String?;
    final teacherName = json['profiles']?['full_name'] as String?;
    
    // 解析新的别名字段
    final borrowerTeacherName = json['borrower_profile']?['full_name'] as String?;
    final handlerTeacherName = json['handler_profile']?['full_name'] as String?;
    
    return BorrowRecord(
      id: json['id'] as int,
      bookId: json['book_id'] as int,
      studentId: json['student_id'] as int?,
      profileId: json['profile_id'] as String?,
      borrowDate: DateTime.parse(json['borrow_date'] as String),
      dueDate: json['due_date'] != null
          ? DateTime.parse(json['due_date'] as String)
          : null,
      returnDate: json['return_date'] != null
          ? DateTime.parse(json['return_date'] as String)
          : null,
      borrowedByUserId: json['borrowed_by_user_id'] as String,
      createdAt: json['created_at'] != null
          ? DateTime.parse(json['created_at'] as String)
          : null,
      quantity: json['quantity'] as int? ?? 1,
      bookTitle: json['books']?['title'] as String?,
      studentName: studentName,
      teacherName: teacherName,
      bookAuthor: json['books']?['author'] as String?,
      bookCoverImageUrl: json['books']?['cover_image_url'] as String?,
      borrowerTeacherName: borrowerTeacherName,
      handlerTeacherName: handlerTeacherName,
    );
  }

  /// 转换为JSON
  Map<String, dynamic> toJson() {
    final Map<String, dynamic> data = {
      'id': id,
      'book_id': bookId,
      'borrow_date': borrowDate.toIso8601String(),
      'borrowed_by_user_id': borrowedByUserId,
      'quantity': quantity, // 添加数量字段
    };
    
    if (studentId != null) data['student_id'] = studentId;
    if (profileId != null) data['profile_id'] = profileId;
    if (dueDate != null) data['due_date'] = dueDate!.toIso8601String();
    if (returnDate != null) data['return_date'] = returnDate!.toIso8601String();
    if (createdAt != null) data['created_at'] = createdAt!.toIso8601String();
    
    return data;
  }

  /// 创建副本
  BorrowRecord copyWith({
    int? id,
    int? bookId,
    int? studentId,
    String? profileId,
    DateTime? borrowDate,
    DateTime? dueDate,
    DateTime? returnDate,
    String? borrowedByUserId,
    DateTime? createdAt,
    int? quantity,
  }) {
    return BorrowRecord(
      id: id ?? this.id,
      bookId: bookId ?? this.bookId,
      studentId: studentId ?? this.studentId,
      profileId: profileId ?? this.profileId,
      borrowDate: borrowDate ?? this.borrowDate,
      dueDate: dueDate ?? this.dueDate,
      returnDate: returnDate ?? this.returnDate,
      borrowedByUserId: borrowedByUserId ?? this.borrowedByUserId,
      createdAt: createdAt ?? this.createdAt,
      quantity: quantity ?? this.quantity,
    );
  }
}
