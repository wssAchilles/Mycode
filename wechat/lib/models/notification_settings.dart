import 'dart:convert';

/// 通知设置模型
/// 
/// 用于控制各种类型的通知开关和偏好设置
class NotificationSettings {
  /// 是否启用私聊消息通知
  final bool privateMessageNotifications;
  
  /// 是否启用群聊消息通知
  final bool groupMessageNotifications;
  
  /// 是否启用好友请求通知
  final bool friendRequestNotifications;
  
  /// 是否启用群组邀请通知
  final bool groupInviteNotifications;
  
  /// 是否静音所有通知
  final bool muteAll;
  
  /// 是否在通知中显示消息预览
  final bool showMessagePreview;
  
  /// 静音的私聊用户ID列表
  final List<String> mutedUsers;
  
  /// 静音的群组ID列表
  final List<String> mutedGroups;
  
  /// 是否启用声音
  final bool soundEnabled;
  
  /// 是否启用震动
  final bool vibrationEnabled;
  
  /// 是否在前台显示通知
  final bool showInForeground;
  
  /// 构造函数
  NotificationSettings({
    this.privateMessageNotifications = true,
    this.groupMessageNotifications = true,
    this.friendRequestNotifications = true,
    this.groupInviteNotifications = true,
    this.muteAll = false,
    this.showMessagePreview = true,
    this.mutedUsers = const [],
    this.mutedGroups = const [],
    this.soundEnabled = true,
    this.vibrationEnabled = true,
    this.showInForeground = true,
  });
  
  /// 从JSON对象创建通知设置模型
  factory NotificationSettings.fromJson(Map<String, dynamic> json) {
    return NotificationSettings(
      privateMessageNotifications: json['privateMessageNotifications'] ?? true,
      groupMessageNotifications: json['groupMessageNotifications'] ?? true,
      friendRequestNotifications: json['friendRequestNotifications'] ?? true,
      groupInviteNotifications: json['groupInviteNotifications'] ?? true,
      muteAll: json['muteAll'] ?? false,
      showMessagePreview: json['showMessagePreview'] ?? true,
      mutedUsers: List<String>.from(json['mutedUsers'] ?? []),
      mutedGroups: List<String>.from(json['mutedGroups'] ?? []),
      soundEnabled: json['soundEnabled'] ?? true,
      vibrationEnabled: json['vibrationEnabled'] ?? true,
      showInForeground: json['showInForeground'] ?? true,
    );
  }
  
  /// 转换为JSON对象
  Map<String, dynamic> toJson() {
    return {
      'privateMessageNotifications': privateMessageNotifications,
      'groupMessageNotifications': groupMessageNotifications,
      'friendRequestNotifications': friendRequestNotifications,
      'groupInviteNotifications': groupInviteNotifications,
      'muteAll': muteAll,
      'showMessagePreview': showMessagePreview,
      'mutedUsers': mutedUsers,
      'mutedGroups': mutedGroups,
      'soundEnabled': soundEnabled,
      'vibrationEnabled': vibrationEnabled,
      'showInForeground': showInForeground,
    };
  }
  
  /// 从JSON字符串创建通知设置模型
  factory NotificationSettings.fromJsonString(String jsonString) {
    return NotificationSettings.fromJson(jsonDecode(jsonString));
  }
  
  /// 转换为JSON字符串
  String toJsonString() {
    return jsonEncode(toJson());
  }
  
  /// 创建默认通知设置
  static final defaultSettings = NotificationSettings();
  
  /// 复制并修改通知设置
  NotificationSettings copyWith({
    bool? privateMessageNotifications,
    bool? groupMessageNotifications,
    bool? friendRequestNotifications,
    bool? groupInviteNotifications,
    bool? muteAll,
    bool? showMessagePreview,
    List<String>? mutedUsers,
    List<String>? mutedGroups,
    bool? soundEnabled,
    bool? vibrationEnabled,
    bool? showInForeground,
  }) {
    return NotificationSettings(
      privateMessageNotifications: privateMessageNotifications ?? this.privateMessageNotifications,
      groupMessageNotifications: groupMessageNotifications ?? this.groupMessageNotifications,
      friendRequestNotifications: friendRequestNotifications ?? this.friendRequestNotifications,
      groupInviteNotifications: groupInviteNotifications ?? this.groupInviteNotifications,
      muteAll: muteAll ?? this.muteAll,
      showMessagePreview: showMessagePreview ?? this.showMessagePreview,
      mutedUsers: mutedUsers ?? this.mutedUsers,
      mutedGroups: mutedGroups ?? this.mutedGroups,
      soundEnabled: soundEnabled ?? this.soundEnabled,
      vibrationEnabled: vibrationEnabled ?? this.vibrationEnabled,
      showInForeground: showInForeground ?? this.showInForeground,
    );
  }
  
  /// 添加静音用户
  NotificationSettings muteUser(String userId) {
    if (mutedUsers.contains(userId)) return this;
    
    final List<String> updatedMutedUsers = List.from(mutedUsers)..add(userId);
    return copyWith(mutedUsers: updatedMutedUsers);
  }
  
  /// 移除静音用户
  NotificationSettings unmuteUser(String userId) {
    if (!mutedUsers.contains(userId)) return this;
    
    final List<String> updatedMutedUsers = List.from(mutedUsers)..remove(userId);
    return copyWith(mutedUsers: updatedMutedUsers);
  }
  
  /// 添加静音群组
  NotificationSettings muteGroup(String groupId) {
    if (mutedGroups.contains(groupId)) return this;
    
    final List<String> updatedMutedGroups = List.from(mutedGroups)..add(groupId);
    return copyWith(mutedGroups: updatedMutedGroups);
  }
  
  /// 移除静音群组
  NotificationSettings unmuteGroup(String groupId) {
    if (!mutedGroups.contains(groupId)) return this;
    
    final List<String> updatedMutedGroups = List.from(mutedGroups)..remove(groupId);
    return copyWith(mutedGroups: updatedMutedGroups);
  }
  
  /// 检查用户是否被静音
  bool isUserMuted(String userId) {
    return muteAll || mutedUsers.contains(userId);
  }
  
  /// 检查群组是否被静音
  bool isGroupMuted(String groupId) {
    return muteAll || mutedGroups.contains(groupId);
  }
}
