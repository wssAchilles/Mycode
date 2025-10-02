import 'dart:convert';
import '../models/friend_model.dart';
import '../models/user_model.dart';
import 'filebase_service.dart';
import 'websocket_service.dart';

/// 好友服务类
///
/// 管理好友关系、好友请求等功能
class FriendService {
  /// Filebase服务实例
  final FilebaseService _filebaseService;
  
  /// WebSocket服务实例（可选）
  final WebSocketService? _webSocketService;
  
  /// 构造函数
  FriendService(this._filebaseService, [this._webSocketService]);
  
  /// 好友数据桶名称
  static const String _bucketName = 'userdata';
  
  /// 好友数据文件前缀
  static const String _friendsFilePrefix = 'user_friends/';
  
  /// 获取用户好友数据
  /// 
  /// [userId] - 用户ID
  Future<UserFriendsModel> getUserFriends(String userId) async {
    try {
      final filePath = '$_friendsFilePrefix$userId.json';
      final jsonData = await _filebaseService.readJson(_bucketName, filePath);
      
      if (jsonData != null) {
        return UserFriendsModel.fromJson(jsonData);
      } else {
        // 如果文件不存在，返回空数据
        final emptyData = UserFriendsModel.empty(userId);
        // 创建空文件
        await _saveUserFriends(emptyData);
        return emptyData;
      }
    } catch (e) {
      print('获取用户好友数据失败: $e');
      // 返回空数据
      return UserFriendsModel.empty(userId);
    }
  }
  
  /// 保存用户好友数据
  /// 
  /// [friendsModel] - 用户好友数据模型
  Future<bool> _saveUserFriends(UserFriendsModel friendsModel) async {
    try {
      final filePath = '$_friendsFilePrefix${friendsModel.userId}.json';
      final jsonData = friendsModel.toJson();
      
      await _filebaseService.uploadJson(_bucketName, filePath, jsonData);
      return true;
    } catch (e) {
      print('保存用户好友数据失败: $e');
      return false;
    }
  }
  
  /// 获取好友列表
  /// 
  /// [userId] - 用户ID
  Future<List<String>> getFriends(String userId) async {
    try {
      final userFriends = await getUserFriends(userId);
      return userFriends.friends;
    } catch (e) {
      print('获取好友列表失败: $e');
      return [];
    }
  }
  
  /// 发送好友请求
  /// 
  /// [senderId] - 发送者用户ID
  /// [receiverId] - 接收者用户ID
  /// [message] - 请求消息
  Future<bool> sendFriendRequest(String senderId, String receiverId, {String? message}) async {
    try {
      // 检查是否已经是好友
      final senderFriends = await getUserFriends(senderId);
      if (senderFriends.friends.contains(receiverId)) {
        print('已经是好友了');
        return false;
      }
      
      // 创建请求ID
      final timestamp = DateTime.now().millisecondsSinceEpoch.toString();
      final requestId = '${senderId}_${receiverId}_$timestamp';
      
      // 创建请求对象
      final request = FriendRequestModel(
        requestId: requestId,
        senderId: senderId,
        receiverId: receiverId,
        message: message,
        status: FriendRequestStatus.pending,
        createdAt: DateTime.now(),
        updatedAt: DateTime.now(),
      );
      
      // 更新发送者的发送请求列表
      final updatedSenderFriends = senderFriends.addSentRequest(request);
      await _saveUserFriends(updatedSenderFriends);
      
      // 更新接收者的接收请求列表
      final receiverFriends = await getUserFriends(receiverId);
      final updatedReceiverFriends = receiverFriends.addReceivedRequest(request);
      await _saveUserFriends(updatedReceiverFriends);
      
      // 通过WebSocket发送通知
      _sendFriendRequestNotification(senderId, receiverId, requestId);
      
      return true;
    } catch (e) {
      print('发送好友请求失败: $e');
      return false;
    }
  }
  
  /// 通过WebSocket发送好友请求通知
  void _sendFriendRequestNotification(String senderId, String receiverId, String requestId) {
    if (_webSocketService != null) {
      _webSocketService!.emitEvent('friend_request', {
        'senderId': senderId,
        'receiverId': receiverId,
        'requestId': requestId,
      });
    }
  }
  
  /// 接受好友请求
  /// 
  /// [requestId] - 请求ID
  /// [userId] - 当前用户ID（接收者）
  Future<bool> acceptFriendRequest(String requestId, String userId) async {
    try {
      // 获取用户好友数据
      final userFriends = await getUserFriends(userId);
      
      // 查找请求
      final requestIndex = userFriends.receivedRequests.indexWhere((req) => req.requestId == requestId);
      if (requestIndex < 0) {
        print('未找到好友请求');
        return false;
      }
      
      final request = userFriends.receivedRequests[requestIndex];
      if (request.status != FriendRequestStatus.pending) {
        print('请求已处理');
        return false;
      }
      
      // 确保当前用户是接收者
      if (request.receiverId != userId) {
        print('不是请求接收者');
        return false;
      }
      
      // 更新接收者好友数据
      final updatedUserFriends = userFriends
          .updateRequestStatus(requestId, FriendRequestStatus.accepted)
          .addFriend(request.senderId);
      await _saveUserFriends(updatedUserFriends);
      
      // 更新发送者好友数据
      final senderFriends = await getUserFriends(request.senderId);
      final updatedSenderFriends = senderFriends
          .updateRequestStatus(requestId, FriendRequestStatus.accepted)
          .addFriend(userId);
      await _saveUserFriends(updatedSenderFriends);
      
      // 发送WebSocket通知
      if (_webSocketService != null) {
        _webSocketService!.emitEvent('friend_request_accepted', {
          'requestId': requestId,
          'senderId': request.senderId,
          'receiverId': userId
        });
      }
      
      return true;
    } catch (e) {
      print('接受好友请求失败: $e');
      return false;
    }
  }
  
  /// 拒绝好友请求
  /// 
  /// [requestId] - 请求ID
  /// [userId] - 当前用户ID（接收者）
  Future<bool> rejectFriendRequest(String requestId, String userId) async {
    try {
      // 获取用户好友数据
      final userFriends = await getUserFriends(userId);
      
      // 查找请求
      final requestIndex = userFriends.receivedRequests.indexWhere((req) => req.requestId == requestId);
      if (requestIndex < 0) {
        print('未找到好友请求');
        return false;
      }
      
      final request = userFriends.receivedRequests[requestIndex];
      if (request.status != FriendRequestStatus.pending) {
        print('请求已处理');
        return false;
      }
      
      // 确保当前用户是接收者
      if (request.receiverId != userId) {
        print('不是请求接收者');
        return false;
      }
      
      // 更新接收者好友数据
      final updatedUserFriends = userFriends
          .updateRequestStatus(requestId, FriendRequestStatus.rejected);
      await _saveUserFriends(updatedUserFriends);
      
      // 更新发送者好友数据
      final senderFriends = await getUserFriends(request.senderId);
      final updatedSenderFriends = senderFriends
          .updateRequestStatus(requestId, FriendRequestStatus.rejected);
      await _saveUserFriends(updatedSenderFriends);
      
      // 发送WebSocket通知
      if (_webSocketService != null) {
        _webSocketService!.emitEvent('friend_request_rejected', {
          'requestId': requestId,
          'senderId': request.senderId,
          'receiverId': userId
        });
      }
      
      return true;
    } catch (e) {
      print('拒绝好友请求失败: $e');
      return false;
    }
  }
  
  /// 移除好友
  /// 
  /// [userId] - 当前用户ID
  /// [friendId] - 要移除的好友ID
  Future<bool> removeFriend(String userId, String friendId) async {
    try {
      // 获取当前用户的好友数据
      final userFriends = await getUserFriends(userId);
      if (!userFriends.friends.contains(friendId)) {
        print('不是好友关系');
        return false;
      }
      
      // 更新当前用户的好友数据
      final updatedUserFriends = userFriends.removeFriend(friendId);
      await _saveUserFriends(updatedUserFriends);
      
      // 更新对方用户的好友数据
      final friendFriends = await getUserFriends(friendId);
      final updatedFriendFriends = friendFriends.removeFriend(userId);
      await _saveUserFriends(updatedFriendFriends);
      
      // 发送WebSocket通知
      if (_webSocketService != null) {
        _webSocketService!.emitEvent('friend_removed', {
          'userId': userId,
          'friendId': friendId
        });
      }
      
      return true;
    } catch (e) {
      print('移除好友失败: $e');
      return false;
    }
  }
  
  /// 获取好友请求列表
  /// 
  /// [userId] - 用户ID
  /// [received] - 是否获取收到的请求，否则获取发送的请求
  Future<List<FriendRequestModel>> getFriendRequests(String userId, {bool received = true}) async {
    try {
      final userFriends = await getUserFriends(userId);
      return received ? userFriends.receivedRequests : userFriends.sentRequests;
    } catch (e) {
      print('获取好友请求列表失败: $e');
      return [];
    }
  }
  
  /// 获取待处理（未接受/未拒绝）的好友请求
  /// 
  /// [userId] - 用户ID
  /// [received] - 是否获取收到的请求，否则获取发送的请求
  Future<List<FriendRequestModel>> getPendingFriendRequests(String userId, {bool received = true}) async {
    try {
      final requests = await getFriendRequests(userId, received: received);
      return requests.where((req) => req.status == FriendRequestStatus.pending).toList();
    } catch (e) {
      print('获取待处理好友请求列表失败: $e');
      return [];
    }
  }
  
  /// 检查两个用户是否为好友关系
  /// 
  /// [userId] - 当前用户ID
  /// [otherUserId] - 另一个用户ID
  Future<bool> areFriends(String userId, String otherUserId) async {
    try {
      final userFriends = await getUserFriends(userId);
      return userFriends.friends.contains(otherUserId);
    } catch (e) {
      print('检查好友关系失败: $e');
      return false;
    }
  }
  
  /// 刷新用户好友列表
  /// 
  /// 用于重新加载指定用户的好友数据
  /// [userId] - 要刷新的用户ID
  Future<List<String>> refreshUserFriends(String userId) async {
    try {
      // 重新从服务器获取用户的好友数据
      final userFriends = await getUserFriends(userId);
      
      // 如果 WebSocket 服务可用，则通知前端更新
      if (_webSocketService != null) {
        _webSocketService!.emitEvent('friends_updated', {
          'userId': userId,
          'timestamp': DateTime.now().toIso8601String(),
        });
      }
      
      return userFriends.friends;
    } catch (e) {
      print('刷新用户好友列表失败: $e');
      return [];
    }
  }
}
