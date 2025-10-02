import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/message_model.dart';
import '../models/chat_room_model.dart';
import '../models/user_model.dart';
import '../models/media_attachment_model.dart';
import 'user_service.dart';
import 'notification_service.dart';
import 'friend_service.dart';

/// 聊天核心服务
/// 实现消息发送和接收逻辑，管理聊天室和消息的Firestore交互
class ChatService {
  static final ChatService _instance = ChatService._internal();
  factory ChatService() => _instance;
  ChatService._internal();

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final UserService _userService = UserService();
  final NotificationService _notificationService = NotificationService();
  final FriendService _friendService = FriendService();

  /// 发送消息
  /// 当两个用户首次通信时，创建聊天室；否则直接发送消息
  /// 支持文本消息、多媒体消息和回复消息
  Future<void> sendMessage({
    required String receiverId,
    required String senderId,
    String? text,
    MediaAttachmentModel? attachment,
    String? replyToMessageId,
  }) async {
    try {
      // 验证消息内容
      if ((text == null || text.trim().isEmpty) && attachment == null) {
        throw Exception('消息内容不能为空');
      }

      // 统一聊天室的创建与获取：确保聊天室存在
      final chatRoom = await getOrCreateChatRoom(
        userId1: senderId,
        userId2: receiverId,
      );
      final chatRoomId = chatRoom.chatRoomId;

      // 创建消息
      final messageId = _firestore.collection('temp').doc().id; // 生成唯一ID
      
      // 根据是否有附件确定消息类型和内容
      MessageType messageType;
      String? mediaUrl;
      String? attachmentId;
      String messageText = text ?? '';

      if (attachment != null) {
        // 多媒体消息
        attachmentId = attachment.attachmentId;
        mediaUrl = attachment.downloadUrl;
        
        // 根据附件类型设置消息类型
        switch (attachment.mediaType) {
          case MediaType.image:
            messageType = MessageType.image;
            if (messageText.isEmpty) messageText = '[图片]';
            break;
          case MediaType.audio:
            messageType = MessageType.audio;
            if (messageText.isEmpty) messageText = '[语音]';
            break;
          case MediaType.video:
            messageType = MessageType.video;
            if (messageText.isEmpty) messageText = '[视频]';
            break;
          case MediaType.document:
            messageType = MessageType.document;
            if (messageText.isEmpty) messageText = '[文档]';
            break;
        }
      } else {
        // 纯文本消息
        messageType = MessageType.text;
      }

      final message = MessageModel(
        messageId: messageId,
        senderId: senderId,
        chatRoomId: chatRoomId,
        text: messageText,
        timestamp: Timestamp.now(),
        status: MessageStatus.sent,
        messageType: messageType,
        mediaUrl: mediaUrl,
        attachmentId: attachmentId,
        replyToMessageId: replyToMessageId,
        reactions: [],
      );

      // 简化并重构批处理逻辑：聊天室已确保存在，直接进行消息写入和状态更新
      final batch = _firestore.batch();
      
      // 第一步：添加消息到聊天室的messages子集合
      final messageRef = _firestore
          .collection('chat_rooms')
          .doc(chatRoomId)
          .collection('messages')
          .doc(messageId);
      batch.set(messageRef, message.toJson());

      // 第二步：更新聊天室最后消息信息
      final chatRoomRef = _firestore.collection('chat_rooms').doc(chatRoomId);
      batch.update(chatRoomRef, {
        'lastMessage': messageText,
        'lastMessageTimestamp': message.timestamp,
        'lastMessageSenderId': senderId,
        'unreadCounts.$receiverId': FieldValue.increment(1),
      });

      // 执行批处理
      await batch.commit();
      
      // 发送推送通知给接收者
      final receiverUser = await _userService.getUserById(receiverId);
      final senderUser = await _userService.getUserById(senderId);
      
      if (receiverUser?.fcmToken != null && senderUser != null) {
        await _notificationService.sendNewMessageNotification(
          receiverFCMToken: receiverUser!.fcmToken!,
          senderName: senderUser.displayName,
          messagePreview: _getMessagePreview(messageText, messageType),
          chatRoomId: chatRoomId,
          senderId: senderId,
        );
      }
      
    } catch (e) {
      throw Exception('发送消息失败：${e.toString()}');
    }
  }

  /// 获取消息预览文本
  String _getMessagePreview(String? messageText, MessageType messageType) {
    switch (messageType) {
      case MessageType.text:
        return messageText ?? '发送了一条消息';
      case MessageType.image:
        return '[图片]';
      case MessageType.video:
        return '[视频]';
      case MessageType.audio:
        return '[语音]';
      case MessageType.document:
        return '[文件]';
      case MessageType.location:
        return '[位置]';
      default:
        return '发送了一条消息';
    }
  }

  /// 获取聊天室消息流
  /// 实时监听指定聊天室messages子集合的变化，按timestamp排序
  Stream<List<MessageModel>> getMessagesStream({
    required String chatRoomId,
    int limit = 50,
  }) {
    return _firestore
        .collection('chat_rooms')
        .doc(chatRoomId)
        .collection('messages')
        .orderBy('timestamp', descending: true)
        .limit(limit)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs
          .map((doc) => MessageModel.fromJson(doc.data() as Map<String, dynamic>, doc.id))
          .toList();
    });
  }

  /// 获取用户的聊天室列表流
  Stream<List<ChatRoomModel>> getChatRoomsStream(String userId) {
    return _firestore
        .collection('chat_rooms')
        .where('participantIds', arrayContains: userId)
        .orderBy('lastMessageTimestamp', descending: true)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs
          .map((doc) => ChatRoomModel.fromJson(doc.data() as Map<String, dynamic>, doc.id))
          .toList();
    });
  }

  /// 获取或创建聊天室
  /// 🔥 新增好友验证：只有好友之间才能创建聊天室
  Future<ChatRoomModel> getOrCreateChatRoom({
    required String userId1,
    required String userId2,
  }) async {
    try {
      final chatRoomId = ChatRoomModel.generateChatRoomId(userId1, userId2);
      final chatRoomRef = _firestore.collection('chat_rooms').doc(chatRoomId);
      
      final doc = await chatRoomRef.get();
      
      if (doc.exists) {
        return ChatRoomModel.fromJson(doc.data() as Map<String, dynamic>, doc.id);
      } else {
        // 获取用户信息
        final user1 = await _userService.getUserById(userId1);
        final user2 = await _userService.getUserById(userId2);
        
        if (user1 == null || user2 == null) {
          throw Exception('用户信息获取失败');
        }

        // 🔥 关键修改：验证好友关系
        print('检查好友关系: $userId1 -> $userId2');
        if (!user1.friendIds.contains(userId2)) {
          print('用户不是好友，无法创建聊天室');
          throw Exception('只能与好友聊天，请先添加为好友');
        }

        print('好友关系验证通过，创建聊天室');
        // 创建新聊天室
        final chatRoom = ChatRoomModel(
          chatRoomId: chatRoomId,
          participantIds: [userId1, userId2],
          unreadCounts: {userId1: 0, userId2: 0},
        );

        await chatRoomRef.set(chatRoom.toJson());
        return chatRoom;
      }
    } catch (e) {
      print('获取聊天室失败: $e');
      throw Exception('获取聊天室失败：${e.toString()}');
    }
  }

  /// 标记消息为已读
  Future<void> markMessagesAsRead({
    required String chatRoomId,
    required String userId,
  }) async {
    try {
      await _firestore
          .collection('chat_rooms')
          .doc(chatRoomId)
          .update({
        'unreadCounts.$userId': 0,
      });
    } catch (e) {
      throw Exception('标记已读失败：${e.toString()}');
    }
  }

  /// 获取聊天室信息
  Future<ChatRoomModel?> getChatRoom(String chatRoomId) async {
    try {
      final doc = await _firestore
          .collection('chat_rooms')
          .doc(chatRoomId)
          .get();
          
      if (doc.exists) {
        return ChatRoomModel.fromJson(doc.data() as Map<String, dynamic>, doc.id);
      }
      return null;
    } catch (e) {
      throw Exception('获取聊天室信息失败：${e.toString()}');
    }
  }

  /// 删除消息
  Future<void> deleteMessage({
    required String chatRoomId,
    required String messageId,
  }) async {
    try {
      await _firestore
          .collection('chat_rooms')
          .doc(chatRoomId)
          .collection('messages')
          .doc(messageId)
          .delete();
    } catch (e) {
      throw Exception('删除消息失败：${e.toString()}');
    }
  }

  /// 更新消息状态
  Future<void> updateMessageStatus({
    required String chatRoomId,
    required String messageId,
    required MessageStatus status,
  }) async {
    try {
      await _firestore
          .collection('chat_rooms')
          .doc(chatRoomId)
          .collection('messages')
          .doc(messageId)
          .update({
        'status': status.name,
      });
    } catch (e) {
      throw Exception('更新消息状态失败：${e.toString()}');
    }
  }

  /// 获取未读消息总数
  Future<int> getTotalUnreadCount(String userId) async {
    try {
      final snapshot = await _firestore
          .collection('chat_rooms')
          .where('participantIds', arrayContains: userId)
          .get();

      int totalUnread = 0;
      for (final doc in snapshot.docs) {
        final chatRoom = ChatRoomModel.fromJson(doc.data() as Map<String, dynamic>, doc.id);
        totalUnread += chatRoom.getUnreadCountForUser(userId);
      }
      
      return totalUnread;
    } catch (e) {
      return 0;
    }
  }

  /// 搜索消息
  Stream<List<MessageModel>> searchMessages({
    required String chatRoomId,
    required String searchQuery,
    int limit = 20,
  }) {
    // Firestore的文本搜索能力有限，这里提供基础实现
    return _firestore
        .collection('chat_rooms')
        .doc(chatRoomId)
        .collection('messages')
        .orderBy('timestamp', descending: true)
        .limit(limit * 5) // 获取更多数据进行客户端过滤
        .snapshots()
        .map((snapshot) {
      return snapshot.docs
          .map((doc) => MessageModel.fromJson(doc.data() as Map<String, dynamic>, doc.id))
          .where((message) => 
              (message.text ?? '').toLowerCase().contains(searchQuery.toLowerCase()))
          .take(limit)
          .toList();
    });
  }

  /// 获取聊天统计信息
  Future<Map<String, dynamic>> getChatStats(String userId) async {
    try {
      final chatRoomsSnapshot = await _firestore
          .collection('chat_rooms')
          .where('participantIds', arrayContains: userId)
          .get();

      int totalChats = chatRoomsSnapshot.docs.length;
      int totalUnread = 0;
      
      for (final doc in chatRoomsSnapshot.docs) {
        final chatRoom = ChatRoomModel.fromJson(doc.data() as Map<String, dynamic>, doc.id);
        totalUnread += chatRoom.getUnreadCountForUser(userId);
      }

      return {
        'totalChats': totalChats,
        'totalUnread': totalUnread,
      };
    } catch (e) {
      return {
        'totalChats': 0,
        'totalUnread': 0,
      };
    }
  }

  /// 清除聊天记录
  Future<void> clearChatHistory(String chatRoomId) async {
    try {
      final messagesRef = _firestore
          .collection('chat_rooms')
          .doc(chatRoomId)
          .collection('messages');

      final messages = await messagesRef.get();
      
      final batch = _firestore.batch();
      for (final doc in messages.docs) {
        batch.delete(doc.reference);
      }
      
      // 更新聊天室信息
      batch.update(
        _firestore.collection('chat_rooms').doc(chatRoomId),
        {
          'lastMessage': null,
          'lastMessageTimestamp': null,
          'lastMessageSenderId': null,
        },
      );
      
      await batch.commit();
    } catch (e) {
      throw Exception('清除聊天记录失败：${e.toString()}');
    }
  }

  /// 发送回复消息
  Future<void> sendReplyMessage({
    required String receiverId,
    required String senderId,
    required String replyToMessageId,
    String? text,
    MediaAttachmentModel? attachment,
  }) async {
    try {
      // 验证回复的原消息是否存在
      final chatRoomId = ChatRoomModel.generateChatRoomId(senderId, receiverId);
      final originalMessageDoc = await _firestore
          .collection('chat_rooms')
          .doc(chatRoomId)
          .collection('messages')
          .doc(replyToMessageId)
          .get();
      
      if (!originalMessageDoc.exists) {
        throw Exception('回复的原消息不存在');
      }

      // 调用普通发送消息方法，但包含回复信息
      await sendMessage(
        receiverId: receiverId,
        senderId: senderId,
        text: text,
        attachment: attachment,
        replyToMessageId: replyToMessageId,
      );

    } catch (e) {
      throw Exception('发送回复消息失败：${e.toString()}');
    }
  }

  /// 添加表情回应
  Future<void> addReaction({
    required String chatRoomId,
    required String messageId,
    required String userId,
    required String emoji,
  }) async {
    try {
      final messageRef = _firestore
          .collection('chat_rooms')
          .doc(chatRoomId)
          .collection('messages')
          .doc(messageId);
      
      await _firestore.runTransaction((transaction) async {
        final messageDoc = await transaction.get(messageRef);
        
        if (!messageDoc.exists) {
          throw Exception('消息不存在');
        }

        final messageData = messageDoc.data()!;
        final reactions = List<Map<String, dynamic>>.from(
          messageData['reactions'] ?? []
        );

        // 查找是否已经有相同表情的回应
        final existingReactionIndex = reactions.indexWhere(
          (reaction) => reaction['emoji'] == emoji
        );

        if (existingReactionIndex != -1) {
          // 已存在该表情，检查用户是否已经回应过
          final userIds = List<String>.from(reactions[existingReactionIndex]['userIds'] ?? []);
          
          if (userIds.contains(userId)) {
            // 用户已经回应过，移除回应
            userIds.remove(userId);
            
            if (userIds.isEmpty) {
              // 没有用户回应这个表情了，移除整个表情
              reactions.removeAt(existingReactionIndex);
            } else {
              // 更新用户列表
              reactions[existingReactionIndex]['userIds'] = userIds;
              reactions[existingReactionIndex]['count'] = userIds.length;
            }
          } else {
            // 用户未回应过，添加用户
            userIds.add(userId);
            reactions[existingReactionIndex]['userIds'] = userIds;
            reactions[existingReactionIndex]['count'] = userIds.length;
          }
        } else {
          // 不存在该表情，创建新的回应
          reactions.add({
            'emoji': emoji,
            'userIds': [userId],
            'count': 1,
          });
        }

        // 更新消息的reactions字段
        transaction.update(messageRef, {
          'reactions': reactions,
        });
      });

    } catch (e) {
      throw Exception('添加表情回应失败：${e.toString()}');
    }
  }

  /// 移除表情回应
  Future<void> removeReaction({
    required String chatRoomId,
    required String messageId,
    required String userId,
    required String emoji,
  }) async {
    try {
      // 添加表情回应的逻辑已经处理了移除（toggle功能）
      await addReaction(
        chatRoomId: chatRoomId,
        messageId: messageId,
        userId: userId,
        emoji: emoji,
      );
    } catch (e) {
      throw Exception('移除表情回应失败：${e.toString()}');
    }
  }

  /// 获取消息详情（包含回复的原消息信息）
  Future<MessageModel?> getMessageWithReplyInfo({
    required String chatRoomId,
    required String messageId,
  }) async {
    try {
      final messageDoc = await _firestore
          .collection('chat_rooms')
          .doc(chatRoomId)
          .collection('messages')
          .doc(messageId)
          .get();
      
      if (!messageDoc.exists) {
        return null;
      }

      final messageData = messageDoc.data()!;
      final message = MessageModel.fromJson(messageData, messageDoc.id);

      return message;
    } catch (e) {
      throw Exception('获取消息详情失败：${e.toString()}');
    }
  }

  /// 获取回复的原消息
  Future<MessageModel?> getReplyMessage({
    required String chatRoomId,
    required String replyMessageId,
  }) async {
    try {
      return await getMessageWithReplyInfo(
        chatRoomId: chatRoomId,
        messageId: replyMessageId,
      );
    } catch (e) {
      throw Exception('获取回复消息失败：${e.toString()}');
    }
  }

  /// 根据消息ID获取单个消息
  Future<MessageModel?> getMessageById(String messageId) async {
    try {
      // 由于我们不知道具体的chatRoomId，需要搜索所有聊天室
      // 这不是最优方案，但为了兼容现有代码结构
      final chatRoomsSnapshot = await _firestore
          .collection('chat_rooms')
          .get();
      
      for (final chatRoomDocument in chatRoomsSnapshot.docs) {
        final messageDoc = await _firestore
            .collection('chat_rooms')
            .doc(chatRoomDocument.id)
            .collection('messages')
            .doc(messageId)
            .get();
        
        if (messageDoc.exists) {
          return MessageModel.fromJson(messageDoc.data()!, messageDoc.id);
        }
      }
      
      return null;
    } catch (e) {
      throw Exception('获取消息失败：${e.toString()}');
    }
  }
}
