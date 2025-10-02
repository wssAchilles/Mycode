import 'dart:convert';

/// 群组数据模型
/// 
/// 代表一个聊天群组，包含群组信息、成员列表及相关元数据
class GroupModel {
  // 群组唯一ID
  final String groupId;
  
  // 群组名称
  String groupName;
  
  // 群组头像IPFS CID
  String? groupAvatarIpfsCid;
  
  // 群组成员列表 (userId 列表)
  List<String> members;
  
  // 群主ID
  final String ownerId;
  
  // 群组管理员列表
  List<String> admins;
  
  // 群组创建时间
  final DateTime createdAt;
  
  // 群组最后更新时间
  DateTime updatedAt;
  
  // 群组介绍
  String? description;
  
  // 构造函数
  GroupModel({
    required this.groupId,
    required this.groupName,
    this.groupAvatarIpfsCid,
    required this.members,
    required this.ownerId,
    List<String>? admins,
    required this.createdAt,
    DateTime? updatedAt,
    this.description,
  }) : 
    this.admins = admins ?? [ownerId],
    this.updatedAt = updatedAt ?? createdAt;
    
  /// 获取群组头像 URL
  String? get avatarUrl {
    if (groupAvatarIpfsCid == null) return null;
    // 返回IPFS网关URL
    return 'https://ipfs.filebase.io/ipfs/$groupAvatarIpfsCid';
  }
  
  /// 获取群组管理员ID列表 (兼容性getter)
  List<String> get adminIds => admins;
  
  /// 从JSON构造群组模型
  factory GroupModel.fromJson(Map<String, dynamic> json) {
    return GroupModel(
      groupId: json['groupId'] as String,
      groupName: json['groupName'] as String,
      groupAvatarIpfsCid: json['groupAvatarIpfsCid'] as String?,
      members: List<String>.from(json['members'] ?? []),
      ownerId: json['ownerId'] as String,
      admins: json['admins'] != null ? List<String>.from(json['admins']) : null,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: json['updatedAt'] != null 
        ? DateTime.parse(json['updatedAt'] as String)
        : null,
      description: json['description'] as String?,
    );
  }
  
  /// 转换为JSON
  Map<String, dynamic> toJson() {
    return {
      'groupId': groupId,
      'groupName': groupName,
      'groupAvatarIpfsCid': groupAvatarIpfsCid,
      'members': members,
      'ownerId': ownerId,
      'admins': admins,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
      'description': description,
    };
  }
  
  /// 添加成员到群组
  void addMember(String userId) {
    if (!members.contains(userId)) {
      members.add(userId);
      updatedAt = DateTime.now();
    }
  }
  
  /// 从群组移除成员
  bool removeMember(String userId) {
    if (userId == ownerId) {
      // 群主不能被移除
      return false;
    }
    
    final removed = members.remove(userId);
    if (removed) {
      // 如果是管理员，从管理员列表中移除
      admins.remove(userId);
      updatedAt = DateTime.now();
    }
    return removed;
  }
  
  /// 添加管理员
  bool addAdmin(String userId) {
    if (members.contains(userId) && !admins.contains(userId)) {
      admins.add(userId);
      updatedAt = DateTime.now();
      return true;
    }
    return false;
  }
  
  /// 移除管理员
  bool removeAdmin(String userId) {
    if (userId == ownerId) {
      // 群主不能被移除管理员权限
      return false;
    }
    
    final removed = admins.remove(userId);
    if (removed) {
      updatedAt = DateTime.now();
    }
    return removed;
  }
  
  /// 更新群组信息
  void updateInfo({String? name, String? avatar, String? desc}) {
    if (name != null) {
      groupName = name;
    }
    
    if (avatar != null) {
      groupAvatarIpfsCid = avatar;
    }
    
    if (desc != null) {
      description = desc;
    }
    
    updatedAt = DateTime.now();
  }
  
  /// 检查用户是否是群主
  bool isOwner(String userId) {
    return ownerId == userId;
  }
  
  /// 检查用户是否是管理员
  bool isAdmin(String userId) {
    return admins.contains(userId);
  }
  
  /// 检查用户是否是群成员
  bool isMember(String userId) {
    return members.contains(userId);
  }
  
  /// 获取成员数量
  int get memberCount => members.length;
  
  /// 从JSON字符串解析群组
  static GroupModel fromJsonString(String jsonString) {
    final Map<String, dynamic> json = jsonDecode(jsonString);
    return GroupModel.fromJson(json);
  }
  
  /// 转换为JSON字符串
  String toJsonString() {
    return jsonEncode(toJson());
  }
  
  /// 创建一个新的GroupModel实例，但可以修改特定字段
  GroupModel copyWith({
    String? groupName,
    String? groupAvatarIpfsCid,
    List<String>? members,
    List<String>? admins,
    DateTime? updatedAt,
    String? description,
  }) {
    return GroupModel(
      groupId: this.groupId, // ID不可变
      ownerId: this.ownerId, // 群主不可变
      createdAt: this.createdAt, // 创建时间不可变
      groupName: groupName ?? this.groupName,
      groupAvatarIpfsCid: groupAvatarIpfsCid ?? this.groupAvatarIpfsCid,
      members: members ?? List<String>.from(this.members),
      admins: admins ?? List<String>.from(this.admins),
      updatedAt: updatedAt ?? DateTime.now(),
      description: description ?? this.description,
    );
  }
}
