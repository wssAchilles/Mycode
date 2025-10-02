import 'package:cloud_firestore/cloud_firestore.dart';

/// 群组数据模型类
/// 
/// 对应Firestore中groups集合的文档结构
/// 严格遵循项目铁律定义
class GroupModel {
  /// 群组唯一ID
  final String groupId;
  
  /// 群组名称
  final String groupName;
  
  /// 群组头像URL
  final String? groupIconUrl;
  
  /// 群组描述
  final String? description;
  
  /// 管理员UID列表
  final List<String> adminIds;
  
  /// 成员UID列表
  final List<String> participantIds;
  
  /// 创建时间
  final Timestamp createdAt;
  
  /// 构造函数
  const GroupModel({
    required this.groupId,
    required this.groupName,
    this.groupIconUrl,
    this.description,
    required this.adminIds,
    required this.participantIds,
    required this.createdAt,
  });
  
  /// 从Firestore文档数据创建GroupModel实例
  /// 
  /// [json] Firestore文档的数据
  /// [id] 文档ID（groupId）
  factory GroupModel.fromJson(Map<String, dynamic> json, String id) {
    return GroupModel(
      groupId: id,
      groupName: json['groupName'] ?? '',
      groupIconUrl: json['groupIconUrl'],
      description: json['description'],
      adminIds: List<String>.from(json['adminIds'] ?? []),
      participantIds: List<String>.from(json['participantIds'] ?? []),
      createdAt: json['createdAt'] ?? Timestamp.now(),
    );
  }
  
  /// 将GroupModel实例转换为可存储到Firestore的Map
  Map<String, dynamic> toJson() {
    return {
      'groupId': groupId,
      'groupName': groupName,
      'groupIconUrl': groupIconUrl,
      'description': description,
      'adminIds': adminIds,
      'participantIds': participantIds,
      'createdAt': createdAt,
    };
  }
  
  /// 创建GroupModel的副本，可选择性地更新某些字段
  GroupModel copyWith({
    String? groupId,
    String? groupName,
    String? groupIconUrl,
    String? description,
    List<String>? adminIds,
    List<String>? participantIds,
    Timestamp? createdAt,
  }) {
    return GroupModel(
      groupId: groupId ?? this.groupId,
      groupName: groupName ?? this.groupName,
      groupIconUrl: groupIconUrl ?? this.groupIconUrl,
      description: description ?? this.description,
      adminIds: adminIds ?? this.adminIds,
      participantIds: participantIds ?? this.participantIds,
      createdAt: createdAt ?? this.createdAt,
    );
  }
}
