import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/models.dart';
import 'user_service.dart';
import 'notification_service.dart';

/// 好友系统服务类
/// 
/// 提供完整的好友管理功能，包括：
/// - 发送、接受、拒绝好友请求
/// - 删除好友关系
/// - 获取好友列表和好友请求流
/// - 原子性操作保证数据一致性
class FriendService {
  static final FriendService _instance = FriendService._internal();
  factory FriendService() => _instance;
  FriendService._internal();

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final UserService _userService = UserService();
  final NotificationService _notificationService = NotificationService();

  /// 发送好友请求
  /// 
  /// [senderId] 发送请求的用户ID
  /// [receiverId] 接收请求的用户ID
  /// 
  /// 返回请求ID，如果已存在请求则抛出异常
  Future<String> sendFriendRequest({
    required String senderId,
    required String receiverId,
  }) async {
    try {
      // 检查参数有效性
      if (senderId == receiverId) {
        throw Exception('不能向自己发送好友请求');
      }

      // 检查接收用户是否存在
      final receiverUser = await _userService.getUserById(receiverId);
      if (receiverUser == null) {
        throw Exception('用户不存在');
      }

      // 检查是否已经是好友
      final senderUser = await _userService.getUserById(senderId);
      if (senderUser != null && senderUser.friendIds.contains(receiverId)) {
        throw Exception('你们已经是好友了');
      }

      // 生成请求ID
      final requestId = FriendRequestModel.generateRequestId(senderId, receiverId);
      final requestRef = _firestore.collection('friend_requests').doc(requestId);

      // 检查是否已存在待处理的请求
      final existingRequest = await requestRef.get();
      if (existingRequest.exists) {
        final requestData = FriendRequestModel.fromJson(
          existingRequest.data() as Map<String, dynamic>,
          existingRequest.id,
        );
        if (requestData.isPending) {
          throw Exception('已存在待处理的好友请求');
        }
      }

      // 创建新的好友请求
      final friendRequest = FriendRequestModel(
        requestId: requestId,
        senderId: senderId,
        receiverId: receiverId,
        status: FriendRequestStatus.pending,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      );

      await requestRef.set(friendRequest.toJson());
      
      // 发送推送通知给接收者
      if (receiverUser.fcmToken != null) {
        await _notificationService.sendFriendRequestNotification(
          receiverFCMToken: receiverUser.fcmToken!,
          senderName: senderUser?.displayName ?? '未知用户',
          senderId: senderId,
        );
      }
      
      return requestId;
    } catch (e) {
      throw Exception('发送好友请求失败：${e.toString()}');
    }
  }

  /// 接受好友请求
  /// 
  /// [requestId] 好友请求ID
  /// [currentUserId] 当前用户ID（必须是请求的接收者）
  /// 
  /// 使用Firestore事务确保原子性操作
  Future<void> acceptFriendRequest({
    required String requestId,
    required String currentUserId,
  }) async {
    try {
      await _firestore.runTransaction((transaction) async {
        // 获取好友请求
        final requestRef = _firestore.collection('friend_requests').doc(requestId);
        final requestSnap = await transaction.get(requestRef);

        if (!requestSnap.exists) {
          throw Exception('好友请求不存在');
        }

        final friendRequest = FriendRequestModel.fromJson(
          requestSnap.data() as Map<String, dynamic>,
          requestSnap.id,
        );

        // 验证权限
        if (friendRequest.receiverId != currentUserId) {
          throw Exception('无权处理此好友请求');
        }

        if (friendRequest.status != FriendRequestStatus.pending) {
          throw Exception('请求状态不正确');
        }

        // 获取两个用户的数据
        final senderRef = _firestore.collection('users').doc(friendRequest.senderId);
        final receiverRef = _firestore.collection('users').doc(friendRequest.receiverId);

        final senderSnap = await transaction.get(senderRef);
        final receiverSnap = await transaction.get(receiverRef);

        if (!senderSnap.exists || !receiverSnap.exists) {
          throw Exception('用户数据不存在');
        }

        final senderUser = UserModel.fromJson(
          senderSnap.data() as Map<String, dynamic>,
          senderSnap.id,
        );
        final receiverUser = UserModel.fromJson(
          receiverSnap.data() as Map<String, dynamic>,
          receiverSnap.id,
        );

        // 更新好友请求状态
        transaction.update(requestRef, {
          'status': FriendRequestStatus.accepted.name,
          'updatedAt': Timestamp.now(),
        });

        // 更新发送者的好友列表
        final senderFriendIds = List<String>.from(senderUser.friendIds);
        if (!senderFriendIds.contains(receiverUser.uid)) {
          senderFriendIds.add(receiverUser.uid);
        }
        transaction.update(senderRef, {'friendIds': senderFriendIds});

        // 更新接收者的好友列表
        final receiverFriendIds = List<String>.from(receiverUser.friendIds);
        if (!receiverFriendIds.contains(senderUser.uid)) {
          receiverFriendIds.add(senderUser.uid);
        }
        transaction.update(receiverRef, {'friendIds': receiverFriendIds});
      });
    } catch (e) {
      throw Exception('接受好友请求失败：${e.toString()}');
    }
  }

  /// 拒绝好友请求
  /// 
  /// [requestId] 好友请求ID
  /// [currentUserId] 当前用户ID（必须是请求的接收者）
  Future<void> declineFriendRequest({
    required String requestId,
    required String currentUserId,
  }) async {
    try {
      final requestRef = _firestore.collection('friend_requests').doc(requestId);
      final requestSnap = await requestRef.get();

      if (!requestSnap.exists) {
        throw Exception('好友请求不存在');
      }

      final friendRequest = FriendRequestModel.fromJson(
        requestSnap.data() as Map<String, dynamic>,
        requestSnap.id,
      );

      // 验证权限
      if (friendRequest.receiverId != currentUserId) {
        throw Exception('无权处理此好友请求');
      }

      if (friendRequest.status != FriendRequestStatus.pending) {
        throw Exception('请求状态不正确');
      }

      // 更新请求状态
      await requestRef.update({
        'status': FriendRequestStatus.declined.name,
        'updatedAt': Timestamp.now(),
      });
    } catch (e) {
      throw Exception('拒绝好友请求失败：${e.toString()}');
    }
  }

  /// 删除好友关系
  /// 
  /// [currentUserId] 当前用户ID
  /// [friendId] 要删除的好友ID
  /// 
  /// 使用Firestore事务确保双方好友列表同步更新
  Future<void> removeFriend({
    required String currentUserId,
    required String friendId,
  }) async {
    try {
      await _firestore.runTransaction((transaction) async {
        // 获取两个用户的数据
        final currentUserRef = _firestore.collection('users').doc(currentUserId);
        final friendRef = _firestore.collection('users').doc(friendId);

        final currentUserSnap = await transaction.get(currentUserRef);
        final friendSnap = await transaction.get(friendRef);

        if (!currentUserSnap.exists || !friendSnap.exists) {
          throw Exception('用户数据不存在');
        }

        final currentUser = UserModel.fromJson(
          currentUserSnap.data() as Map<String, dynamic>,
          currentUserSnap.id,
        );
        final friend = UserModel.fromJson(
          friendSnap.data() as Map<String, dynamic>,
          friendSnap.id,
        );

        // 从当前用户的好友列表中移除
        final currentUserFriendIds = List<String>.from(currentUser.friendIds);
        currentUserFriendIds.remove(friendId);
        transaction.update(currentUserRef, {'friendIds': currentUserFriendIds});

        // 从好友的好友列表中移除
        final friendFriendIds = List<String>.from(friend.friendIds);
        friendFriendIds.remove(currentUserId);
        transaction.update(friendRef, {'friendIds': friendFriendIds});
      });
    } catch (e) {
      throw Exception('删除好友失败：${e.toString()}');
    }
  }

  /// 获取好友列表流
  /// 
  /// [userId] 用户ID
  /// 
  /// 返回该用户所有好友的实时流
  Stream<List<UserModel>> getFriendsStream(String userId) {
    return _firestore
        .collection('users')
        .doc(userId)
        .snapshots()
        .asyncMap((userSnap) async {
      if (!userSnap.exists) return <UserModel>[];

      final user = UserModel.fromJson(
        userSnap.data() as Map<String, dynamic>,
        userSnap.id,
      );

      if (user.friendIds.isEmpty) return <UserModel>[];

      // 批量获取好友信息
      final friendsQuery = await _firestore
          .collection('users')
          .where(FieldPath.documentId, whereIn: user.friendIds)
          .get();

      return friendsQuery.docs
          .map((doc) => UserModel.fromJson(doc.data(), doc.id))
          .toList();
    });
  }

  /// 获取收到的好友请求流
  /// 
  /// [userId] 用户ID
  /// 
  /// 返回该用户收到的所有待处理好友请求
  Stream<List<FriendRequestModel>> getReceivedRequestsStream(String userId) {
    return _firestore
        .collection('friend_requests')
        .where('receiverId', isEqualTo: userId)
        .where('status', isEqualTo: FriendRequestStatus.pending.name)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snapshot) => snapshot.docs
            .map((doc) => FriendRequestModel.fromJson(doc.data(), doc.id))
            .toList());
  }

  /// 获取发送的好友请求流
  /// 
  /// [userId] 用户ID
  /// 
  /// 返回该用户发送的所有好友请求
  Stream<List<FriendRequestModel>> getSentRequestsStream(String userId) {
    return _firestore
        .collection('friend_requests')
        .where('senderId', isEqualTo: userId)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snapshot) => snapshot.docs
            .map((doc) => FriendRequestModel.fromJson(doc.data(), doc.id))
            .toList());
  }

  /// 检查两个用户是否为好友
  /// 
  /// [userId1] 用户1的ID
  /// [userId2] 用户2的ID
  /// 
  /// 返回是否为好友关系
  Future<bool> areFriends(String userId1, String userId2) async {
    try {
      final user1Doc = await _firestore.collection('users').doc(userId1).get();
      if (!user1Doc.exists) return false;

      final user1 = UserModel.fromJson(
        user1Doc.data() as Map<String, dynamic>,
        user1Doc.id,
      );

      return user1.friendIds.contains(userId2);
    } catch (e) {
      return false;
    }
  }

  /// 获取好友请求详情（包含发送者信息）
  /// 
  /// [requestId] 请求ID
  /// 
  /// 返回请求详情和发送者用户信息
  Future<Map<String, dynamic>?> getRequestWithSenderInfo(String requestId) async {
    try {
      final requestDoc = await _firestore.collection('friend_requests').doc(requestId).get();
      if (!requestDoc.exists) return null;

      final request = FriendRequestModel.fromJson(
        requestDoc.data() as Map<String, dynamic>,
        requestDoc.id,
      );

      final senderUser = await _userService.getUserById(request.senderId);
      if (senderUser == null) return null;

      return {
        'request': request,
        'sender': senderUser,
      };
    } catch (e) {
      return null;
    }
  }
}
