import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import '../models/models.dart';

/// 用户状态服务
/// 负责管理用户在线状态、最后在线时间、正在输入状态等实时状态信息
class PresenceService {
  static final PresenceService _instance = PresenceService._internal();
  factory PresenceService() => _instance;
  PresenceService._internal();

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  
  // 正在输入状态缓存，避免频繁更新数据库
  final Map<String, bool> _typingStates = {};
  final Map<String, DateTime> _lastTypingUpdate = {};

  /// 更新用户在线状态
  /// [userId] 用户ID
  /// [status] 用户状态
  /// [customMessage] 自定义状态消息
  Future<void> updateUserPresence({
    required String userId,
    required PresenceStatus status,
    String? customMessage,
  }) async {
    try {
      final presenceData = {
        'userId': userId,
        'status': status.name,
        'lastActiveAt': Timestamp.now(),
      };

      // 更新用户状态集合
      await _firestore
          .collection('presence')
          .doc(userId)
          .set(presenceData, SetOptions(merge: true));

      // 同时更新用户表中的状态字段
      await _firestore
          .collection('users')
          .doc(userId)
          .update({
        'lastOnline': Timestamp.now(),
        // 根据数据模型，不需要isOnline字段
      });

    } catch (e) {
      throw Exception('更新用户状态失败：${e.toString()}');
    }
  }

  /// 设置用户为在线状态
  Future<void> setUserOnline(String userId) async {
    await updateUserPresence(userId: userId, status: PresenceStatus.online);
  }

  /// 设置用户为离线状态
  Future<void> setUserOffline(String userId) async {
    await updateUserPresence(userId: userId, status: PresenceStatus.offline);
  }

  /// 设置用户为忙碌状态
  Future<void> setUserBusy(String userId) async {
    await updateUserPresence(userId: userId, status: PresenceStatus.busy);
  }

  /// 设置用户为离开状态
  Future<void> setUserAway(String userId) async {
    await updateUserPresence(userId: userId, status: PresenceStatus.away);
  }

  /// 获取用户状态信息
  Future<PresenceModel?> getUserPresence(String userId) async {
    try {
      final doc = await _firestore.collection('presence').doc(userId).get();
      
      if (doc.exists && doc.data() != null) {
        return PresenceModel.fromJson(doc.data()! as Map<String, dynamic>, userId);
      }
      return null;
    } catch (e) {
      throw Exception('获取用户状态失败：${e.toString()}');
    }
  }

  /// 监听用户状态变化
  Stream<PresenceModel?> getUserPresenceStream(String userId) {
    return _firestore
        .collection('presence')
        .doc(userId)
        .snapshots()
        .map((doc) {
      if (doc.exists && doc.data() != null) {
        return PresenceModel.fromJson(doc.data()! as Map<String, dynamic>, userId);
      }
      return null;
    });
  }

  /// 批量获取多个用户的在线状态
  Future<Map<String, PresenceModel>> getBatchUserPresence(List<String> userIds) async {
    try {
      final result = <String, PresenceModel>{};
      
      // Firestore的'in'查询限制为10个元素，需要分批处理
      const int batchSize = 10;
      
      for (int i = 0; i < userIds.length; i += batchSize) {
        final batch = userIds.skip(i).take(batchSize).toList();
        
        final snapshot = await _firestore
            .collection('presence')
            .where('userId', whereIn: batch)
            .get();
            
        for (final doc in snapshot.docs) {
          if (doc.exists && doc.data().isNotEmpty) {
            final presence = PresenceModel.fromJson(doc.data() as Map<String, dynamic>, doc.id);
            result[doc.id] = presence;
          }
        }
      }
      
      return result;
    } catch (e) {
      throw Exception('批量获取用户状态失败：${e.toString()}');
    }
  }

  /// 监听多个用户的在线状态变化
  Stream<Map<String, PresenceModel>> getBatchUserPresenceStream(List<String> userIds) {
    if (userIds.isEmpty) {
      return Stream.value({});
    }

    // 由于Firestore的whereIn限制，这里使用简化实现
    // 实际项目中可能需要更复杂的实现来处理大量用户
    return _firestore
        .collection('presence')
        .where('userId', whereIn: userIds.take(10).toList()) // 限制前10个用户
        .snapshots()
        .map((snapshot) {
      final result = <String, PresenceModel>{};
      
      for (final doc in snapshot.docs) {
        if (doc.exists && doc.data().isNotEmpty) {
          final presence = PresenceModel.fromJson(doc.data() as Map<String, dynamic>, doc.id);
          result[doc.id] = presence;
        }
      }
      
      return result;
    });
  }

  /// 开始输入状态
  /// [chatRoomId] 聊天室ID
  /// [userId] 用户ID
  Future<void> startTyping({
    required String chatRoomId,
    required String userId,
  }) async {
    try {
      // 避免频繁更新，检查上次更新时间
      final lastUpdate = _lastTypingUpdate['${chatRoomId}_$userId'];
      final now = DateTime.now();
      
      if (lastUpdate != null && now.difference(lastUpdate).inSeconds < 2) {
        return; // 2秒内不重复更新
      }

      _typingStates['${chatRoomId}_$userId'] = true;
      _lastTypingUpdate['${chatRoomId}_$userId'] = now;

      final typingData = {
        'userId': userId,
        'chatRoomId': chatRoomId,
        'isTyping': true,
        'startTime': Timestamp.now(),
        'lastUpdate': Timestamp.now(),
      };

      await _firestore
          .collection('typing')
          .doc('${chatRoomId}_$userId')
          .set(typingData);

    } catch (e) {
      // 输入状态更新失败不应该影响用户体验，只打印错误
      print('开始输入状态更新失败：${e.toString()}');
    }
  }

  /// 停止输入状态
  /// [chatRoomId] 聊天室ID
  /// [userId] 用户ID
  Future<void> stopTyping({
    required String chatRoomId,
    required String userId,
  }) async {
    try {
      _typingStates.remove('${chatRoomId}_$userId');
      _lastTypingUpdate.remove('${chatRoomId}_$userId');

      await _firestore
          .collection('typing')
          .doc('${chatRoomId}_$userId')
          .delete();

    } catch (e) {
      print('停止输入状态更新失败：${e.toString()}');
    }
  }

  /// 获取聊天室中正在输入的用户列表
  Stream<List<String>> getTypingUsersStream(String chatRoomId) {
    return _firestore
        .collection('typing')
        .where('chatRoomId', isEqualTo: chatRoomId)
        .where('isTyping', isEqualTo: true)
        .snapshots()
        .map((snapshot) {
      final now = Timestamp.now();
      final validUserIds = <String>[];

      for (final doc in snapshot.docs) {
        final data = doc.data();
        final lastUpdate = data['lastUpdate'] as Timestamp?;
        
        // 如果最后更新时间超过10秒，认为用户已停止输入
        if (lastUpdate != null && 
            now.seconds - lastUpdate.seconds < 10) {
          validUserIds.add(data['userId'] as String);
        }
      }

      return validUserIds;
    });
  }

  /// 清理过期的输入状态（定期调用）
  Future<void> cleanupExpiredTypingStates() async {
    try {
      final cutoffTime = Timestamp.fromDate(
        DateTime.now().subtract(const Duration(seconds: 10))
      );

      final expiredDocs = await _firestore
          .collection('typing')
          .where('lastUpdate', isLessThan: cutoffTime)
          .get();

      final batch = _firestore.batch();
      for (final doc in expiredDocs.docs) {
        batch.delete(doc.reference);
      }

      if (expiredDocs.docs.isNotEmpty) {
        await batch.commit();
      }

    } catch (e) {
      print('清理过期输入状态失败：${e.toString()}');
    }
  }

  /// 监听用户连接状态（用于自动设置在线/离线）
  void startPresenceListening(String userId) {
    // 设置用户为在线
    setUserOnline(userId);

    // 在应用进入后台时设置为离线
    // 注意：这需要与应用生命周期管理结合使用
  }

  /// 停止状态监听
  void stopPresenceListening(String userId) {
    // 设置用户为离线
    setUserOffline(userId);
    
    // 清理该用户的输入状态
    _typingStates.removeWhere((key, value) => key.endsWith('_$userId'));
    _lastTypingUpdate.removeWhere((key, value) => key.endsWith('_$userId'));
  }

  /// 获取格式化的在线状态文本
  String getStatusText(PresenceModel? presence) {
    if (presence == null) {
      return '离线';
    }

    switch (presence.status) {
      case PresenceStatus.online:
        return '在线';
      case PresenceStatus.away:
        return '离开';
      case PresenceStatus.busy:
        return '忙碌';
      case PresenceStatus.offline:
        final timeDifference = DateTime.now().difference(presence.lastActiveAt.toDate());
        if (timeDifference.inMinutes < 1) {
          return '刚刚在线';
        } else if (timeDifference.inHours < 1) {
          return '${timeDifference.inMinutes}分钟前在线';
        } else if (timeDifference.inDays < 1) {
          return '${timeDifference.inHours}小时前在线';
        } else {
          return '${timeDifference.inDays}天前在线';
        }
      case PresenceStatus.invisible:
        return '隐身';
    }
  }

  /// 获取状态指示器颜色
  Color getStatusColor(PresenceModel? presence) {
    if (presence == null) {
      return Colors.grey;
    }

    switch (presence.status) {
      case PresenceStatus.online:
        return Colors.green;
      case PresenceStatus.busy:
        return Colors.red;
      case PresenceStatus.away:
        return Colors.orange;
      case PresenceStatus.offline:
        return Colors.grey;
      case PresenceStatus.invisible:
        return Colors.grey;
    }
  }

  /// 检查用户是否在线
  bool isUserOnline(PresenceModel? presence) {
    return presence?.status == PresenceStatus.online;
  }

  /// 检查用户是否可以聊天（在线或忙碌）
  bool isUserAvailableForChat(PresenceModel? presence) {
    return presence?.status == PresenceStatus.online || 
           presence?.status == PresenceStatus.busy;
  }

  /// 格式化正在输入的用户列表文本
  String formatTypingUsersText(List<String> typingUserIds, Map<String, String> userNames) {
    if (typingUserIds.isEmpty) {
      return '';
    }

    final typingNames = typingUserIds
        .map((userId) => userNames[userId] ?? '某用户')
        .toList();

    if (typingNames.length == 1) {
      return '${typingNames[0]} 正在输入...';
    } else if (typingNames.length == 2) {
      return '${typingNames[0]} 和 ${typingNames[1]} 正在输入...';
    } else if (typingNames.length == 3) {
      return '${typingNames[0]}、${typingNames[1]} 和 ${typingNames[2]} 正在输入...';
    } else {
      return '${typingNames[0]}、${typingNames[1]} 等 ${typingNames.length} 人正在输入...';
    }
  }
}

