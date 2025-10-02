/// 图书数据模型 - 与Supabase数据库的books表对应
class Book {
  final int? id;
  final String title;
  final String? author;
  final String? location;
  final String? coverImageUrl;
  final int totalQuantity;     // 总数量
  final int availableQuantity;  // 可借数量
  final int? categoryId;       // 分类ID
  final String? categoryName;  // 分类名称（用于UI显示）
  final String? lastUpdatedBy;
  final DateTime? createdAt;

  Book({
    this.id,
    required this.title,
    this.author,
    this.location,
    this.coverImageUrl,
    this.totalQuantity = 1,
    this.availableQuantity = 1,
    this.categoryId,
    this.categoryName,
    this.lastUpdatedBy,
    this.createdAt,
  });

  /// 从数据库JSON转换为Book对象
  factory Book.fromJson(Map<String, dynamic> json) {
    // 处理关联查询的分类信息
    String? categoryName;
    if (json['categories'] != null) {
      final category = json['categories'] as Map<String, dynamic>;
      categoryName = category['name'] as String?;
    }
    
    return Book(
      id: json['id'] as int?,
      title: json['title'] as String,
      author: json['author'] as String?,
      location: json['location'] as String?,
      coverImageUrl: json['cover_image_url'] as String?,
      totalQuantity: json['total_quantity'] as int? ?? 1,
      availableQuantity: json['available_quantity'] as int? ?? 1,
      categoryId: json['category_id'] as int?,
      categoryName: categoryName,
      lastUpdatedBy: json['last_updated_by'] as String?,
      createdAt: json['created_at'] != null 
          ? DateTime.parse(json['created_at'] as String)
          : null,
    );
  }

  /// 转换为JSON格式用于数据库操作
  Map<String, dynamic> toJson() {
    final Map<String, dynamic> data = {
      'title': title,
      'author': author,
      'location': location,
      'total_quantity': totalQuantity,
      'available_quantity': availableQuantity,
      'category_id': categoryId,
    };
    
    // 只在更新时包含id
    if (id != null) {
      data['id'] = id;
    }
    
    if (coverImageUrl != null) {
      data['cover_image_url'] = coverImageUrl;
    }
    
    if (lastUpdatedBy != null) {
      data['last_updated_by'] = lastUpdatedBy;
    }
    
    return data;
  }

  /// 复制并修改部分字段
  Book copyWith({
    int? id,
    String? title,
    String? author,
    String? location,
    String? coverImageUrl,
    int? totalQuantity,
    int? availableQuantity,
    int? categoryId,
    String? categoryName,
    String? lastUpdatedBy,
    DateTime? createdAt,
  }) {
    return Book(
      id: id ?? this.id,
      title: title ?? this.title,
      author: author ?? this.author,
      location: location ?? this.location,
      coverImageUrl: coverImageUrl ?? this.coverImageUrl,
      totalQuantity: totalQuantity ?? this.totalQuantity,
      availableQuantity: availableQuantity ?? this.availableQuantity,
      categoryId: categoryId ?? this.categoryId,
      categoryName: categoryName ?? this.categoryName,
      lastUpdatedBy: lastUpdatedBy ?? this.lastUpdatedBy,
      createdAt: createdAt ?? this.createdAt,
    );
  }

  /// 判断图书是否可借
  bool get isAvailable => availableQuantity > 0;
  
  /// 获取图书状态字符串
  String get statusText {
    if (availableQuantity > 0) {
      return '可借';
    } else {
      return '全部借出';
    }
  }
  
  /// 获取库存信息字符串
  String get stockInfo => '库存: $availableQuantity / $totalQuantity';
}
