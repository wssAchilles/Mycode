import 'dart:convert';

/// 表情包模型类
class EmojiModel {
  final String id;          // 唯一标识符
  final String? assetPath;  // 本地资源路径 (如果是本地表情)
  final String? remoteUrl;  // 远程URL (如果是远程表情)
  final String name;        // 表情名称
  final String category;    // 分类 (例如"基础", "动物", "食物"等)
  final bool isLocal;       // 是否为本地表情
  
  const EmojiModel({
    required this.id,
    this.assetPath,
    this.remoteUrl,
    required this.name,
    required this.category,
    required this.isLocal,
  });
  
  // 获取表情显示URL/路径
  String get displaySource => isLocal ? assetPath! : remoteUrl!;
  
  // 从JSON构造
  factory EmojiModel.fromJson(Map<String, dynamic> json) {
    return EmojiModel(
      id: json['id'],
      assetPath: json['assetPath'],
      remoteUrl: json['remoteUrl'],
      name: json['name'],
      category: json['category'] ?? '基础',
      isLocal: json['isLocal'] ?? false,
    );
  }
  
  // 转为JSON
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'assetPath': assetPath,
      'remoteUrl': remoteUrl,
      'name': name,
      'category': category,
      'isLocal': isLocal,
    };
  }
  
  // 从JSON字符串构造
  static EmojiModel fromJsonString(String jsonString) {
    final Map<String, dynamic> json = jsonDecode(jsonString);
    return EmojiModel.fromJson(json);
  }
  
  // 转为JSON字符串
  String toJsonString() {
    return jsonEncode(toJson());
  }
} 