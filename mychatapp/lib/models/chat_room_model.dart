import 'package:cloud_firestore/cloud_firestore.dart';

/// 聊天室数据模型类
/// 
/// 对应Firestore中chat_rooms集合的文档结构
/// 严格遵循项目铁律定义
class ChatRoomModel {
  /// 聊天室唯一ID
  final String chatRoomId;
  
  /// 参与者UID列表
  final List<String> participantIds;
  
  /// 最后一条消息摘要
  final String? lastMessage;
  
  /// 最后一条消息时间戳
  final Timestamp? lastMessageTimestamp;
  
  /// 最后一条消息发送者UID
  final String? lastMessageSenderId;
  
  /// 每个参与者的未读消息数
  final Map<String, int> unreadCounts;
  
  /// 构造函数
  const ChatRoomModel({
    required this.chatRoomId,
    required this.participantIds,
    this.lastMessage,
    this.lastMessageTimestamp,
    this.lastMessageSenderId,
    required this.unreadCounts,
  });
  
  /// 从Firestore文档数据创建ChatRoomModel实例
  /// 
  /// [json] Firestore文档的数据
  /// [id] 文档ID（chatRoomId）
  factory ChatRoomModel.fromJson(Map<String, dynamic> json, String id) {
    return ChatRoomModel(
      chatRoomId: id,
      participantIds: List<String>.from(json['participantIds'] ?? []),
      lastMessage: json['lastMessage'],
      lastMessageTimestamp: json['lastMessageTimestamp'],
      lastMessageSenderId: json['lastMessageSenderId'],
      unreadCounts: Map<String, int>.from(json['unreadCounts'] ?? {}),
    );
  }
  
  /// 将ChatRoomModel实例转换为可存储到Firestore的Map
  Map<String, dynamic> toJson() {
    return {
      'chatRoomId': chatRoomId,
      'participantIds': participantIds,
      'lastMessage': lastMessage,
      'lastMessageTimestamp': lastMessageTimestamp,
      'lastMessageSenderId': lastMessageSenderId,
      'unreadCounts': unreadCounts,
    };
  }
  
  /// 创建ChatRoomModel的副本，可选择性地更新某些字段
  /// 
  /// 主要用于更新最后消息和未读计数
  ChatRoomModel copyWith({
    String? chatRoomId,
    List<String>? participantIds,
    String? lastMessage,
    Timestamp? lastMessageTimestamp,
    String? lastMessageSenderId,
    Map<String, int>? unreadCounts,
  }) {
    return ChatRoomModel(
      chatRoomId: chatRoomId ?? this.chatRoomId,
      participantIds: participantIds ?? this.participantIds,
      lastMessage: lastMessage ?? this.lastMessage,
      lastMessageTimestamp: lastMessageTimestamp ?? this.lastMessageTimestamp,
      lastMessageSenderId: lastMessageSenderId ?? this.lastMessageSenderId,
      unreadCounts: unreadCounts ?? this.unreadCounts,
    );
  }
  
  /// 根据两个用户的UID生成聊天室ID（按字母顺序排序）
  /// 
  /// 这确保了相同两个用户的聊天室ID始终一致
  static String generateChatRoomId(String uid1, String uid2) {
    final List<String> uids = [uid1, uid2]..sort();
    return uids.join('_');
  }
  
  /// 获取对方的UID（在一对一聊天中）
  /// 
  /// [currentUserId] 当前用户的UID
  /// 返回对方用户的UID，如果不是一对一聊天则返回null
  String? getOtherParticipantId(String currentUserId) {
    if (participantIds.length != 2) return null;
    return participantIds.firstWhere(
      (id) => id != currentUserId,
      orElse: () => '',
    );
  }
  
  /// 获取指定用户的未读消息数
  /// 
  /// [userId] 用户UID
  /// 返回该用户的未读消息数
  int getUnreadCountForUser(String userId) {
    return unreadCounts[userId] ?? 0;
  }
  
  /// 检查聊天室是否包含指定用户
  /// 
  /// [userId] 用户UID
  bool containsUser(String userId) {
    return participantIds.contains(userId);
  }
  
  /// 判断是否为一对一聊天室
  bool get isOneOnOneChat {
    return participantIds.length == 2;
  }
  
  /// 判断是否为群聊
  bool get isGroupChat {
    return participantIds.length > 2;
  }
  
  /// 获取参与者总数
  int get participantCount {
    return participantIds.length;
  }
  
  /// 获取所有用户的总未读消息数
  int get totalUnreadCount {
    return unreadCounts.values.fold(0, (sum, count) => sum + count);
  }
  
  /// 获取格式化的最后消息时间
  String? get formattedLastMessageTime {
    if (lastMessageTimestamp == null) return null;
    
    final DateTime messageDate = lastMessageTimestamp!.toDate();
    final DateTime now = DateTime.now();
    final Duration difference = now.difference(messageDate);
    
    if (difference.inDays > 0) {
      if (difference.inDays == 1) {
        return '昨天';
      } else if (difference.inDays < 7) {
        const List<String> weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
        return weekdays[messageDate.weekday - 1];
      } else {
        return '${messageDate.month}/${messageDate.day}';
      }
    } else if (difference.inHours > 0) {
      return '${messageDate.hour.toString().padLeft(2, '0')}:${messageDate.minute.toString().padLeft(2, '0')}';
    } else if (difference.inMinutes > 0) {
      return '${difference.inMinutes}分钟前';
    } else {
      return '刚刚';
    }
  }
  
  /// 获取聊天室显示名称
  /// 
  /// [otherUserDisplayName] 对方用户的显示名称（用于一对一聊天）
  /// [groupName] 群聊名称（用于群聊）
  String getDisplayName({
    String? otherUserDisplayName,
    String? groupName,
  }) {
    if (isOneOnOneChat) {
      return otherUserDisplayName ?? '未知用户';
    } else {
      return groupName ?? '群聊 (${participantIds.length}人)';
    }
  }
  
  @override
  String toString() {
    return 'ChatRoomModel(chatRoomId: $chatRoomId, participants: ${participantIds.length}, lastMessage: ${lastMessage?.length != null && lastMessage!.length > 20 ? lastMessage!.substring(0, 20) + '...' : lastMessage ?? ''})';
  }
  
  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is ChatRoomModel && other.chatRoomId == chatRoomId;
  }
  
  @override
  int get hashCode => chatRoomId.hashCode;
}
