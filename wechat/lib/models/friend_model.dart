import 'dart:convert';
import 'user_model.dart';


/// 好友请求状态枚举
enum FriendRequestStatus {
  /// 等待接受
  pending,
  
  /// 已接受
  accepted,
  
  /// 已拒绝
  rejected
}

/// 好友请求模型
class FriendRequestModel {
  /// 请求ID，格式为: {senderId}_{receiverId}_{timestamp}
  final String requestId;
  
  /// 发送者用户ID
  final String senderId;
  
  /// 接收者用户ID
  final String receiverId;
  
  /// 请求消息
  final String? message;
  
  /// 请求状态
  final FriendRequestStatus status;
  
  /// 请求创建时间
  final DateTime createdAt;
  
  /// 请求更新时间
  final DateTime updatedAt;
  
  FriendRequestModel({
    required this.requestId,
    required this.senderId,
    required this.receiverId,
    this.message,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
  });
  
  /// 从JSON对象创建好友请求模型
  factory FriendRequestModel.fromJson(Map<String, dynamic> json) {
    return FriendRequestModel(
      requestId: json['requestId'],
      senderId: json['senderId'],
      receiverId: json['receiverId'],
      message: json['message'],
      status: FriendRequestStatus.values.byName(json['status']),
      createdAt: DateTime.parse(json['createdAt']),
      updatedAt: DateTime.parse(json['updatedAt']),
    );
  }
  
  /// 转换为JSON对象
  Map<String, dynamic> toJson() {
    return {
      'requestId': requestId,
      'senderId': senderId,
      'receiverId': receiverId,
      'message': message,
      'status': status.name,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
    };
  }
}

/// 单个好友模型
/// 
/// 用于展示一个好友的基本信息
class FriendModel {
  /// 好友ID
  final String userId;
  
  /// 好友用户名
  final String username;
  
  /// 好友头像URL
  final String? avatarUrl;
  
  /// 好友备注名
  final String? remark;
  
  /// 构造函数
  FriendModel({
    required this.userId,
    required this.username,
    this.avatarUrl,
    this.remark,
  });
  
  /// 从UserModel创建好友模型
  factory FriendModel.fromUserModel(UserModel user) {
    return FriendModel(
      userId: user.userId,
      username: user.username,
      avatarUrl: user.avatarUrl,
      remark: null,
    );
  }
  
  /// 从JSON对象创建好友模型
  factory FriendModel.fromJson(Map<String, dynamic> json) {
    return FriendModel(
      userId: json['userId'],
      username: json['username'],
      avatarUrl: json['avatarUrl'],
      remark: json['remark'],
    );
  }
  
  /// 转换为JSON对象
  Map<String, dynamic> toJson() {
    return {
      'userId': userId,
      'username': username,
      'avatarUrl': avatarUrl,
      'remark': remark,
    };
  }
}

/// 用户好友数据模型
/// 
/// 包含用户的好友列表和好友请求
class UserFriendsModel {
  /// 用户ID
  final String userId;
  
  /// 好友ID列表
  final List<String> friends;
  
  /// 收到的好友请求
  final List<FriendRequestModel> receivedRequests;
  
  /// 发送的好友请求
  final List<FriendRequestModel> sentRequests;
  
  UserFriendsModel({
    required this.userId,
    required this.friends,
    required this.receivedRequests,
    required this.sentRequests,
  });
  
  /// 从JSON对象创建用户好友模型
  factory UserFriendsModel.fromJson(Map<String, dynamic> json) {
    return UserFriendsModel(
      userId: json['userId'],
      friends: List<String>.from(json['friends'] ?? []),
      receivedRequests: (json['receivedRequests'] as List?)
          ?.map((request) => FriendRequestModel.fromJson(request))
          .toList() ?? [],
      sentRequests: (json['sentRequests'] as List?)
          ?.map((request) => FriendRequestModel.fromJson(request))
          .toList() ?? [],
    );
  }
  
  /// 转换为JSON对象
  Map<String, dynamic> toJson() {
    return {
      'userId': userId,
      'friends': friends,
      'receivedRequests': receivedRequests.map((request) => request.toJson()).toList(),
      'sentRequests': sentRequests.map((request) => request.toJson()).toList(),
    };
  }
  
  /// 创建空的用户好友数据
  factory UserFriendsModel.empty(String userId) {
    return UserFriendsModel(
      userId: userId,
      friends: [],
      receivedRequests: [],
      sentRequests: [],
    );
  }
  
  /// 添加好友到列表
  UserFriendsModel addFriend(String friendId) {
    if (!friends.contains(friendId)) {
      final updatedFriends = List<String>.from(friends)..add(friendId);
      return UserFriendsModel(
        userId: userId,
        friends: updatedFriends,
        receivedRequests: receivedRequests,
        sentRequests: sentRequests,
      );
    }
    return this;
  }
  
  /// 移除好友
  UserFriendsModel removeFriend(String friendId) {
    final updatedFriends = List<String>.from(friends)..remove(friendId);
    return UserFriendsModel(
      userId: userId,
      friends: updatedFriends,
      receivedRequests: receivedRequests,
      sentRequests: sentRequests,
    );
  }
  
  /// 添加收到的好友请求
  UserFriendsModel addReceivedRequest(FriendRequestModel request) {
    final updatedRequests = List<FriendRequestModel>.from(receivedRequests);
    
    // 检查是否已经存在相同ID的请求
    final existingIndex = updatedRequests.indexWhere((r) => r.requestId == request.requestId);
    if (existingIndex >= 0) {
      updatedRequests[existingIndex] = request;
    } else {
      updatedRequests.add(request);
    }
    
    return UserFriendsModel(
      userId: userId,
      friends: friends,
      receivedRequests: updatedRequests,
      sentRequests: sentRequests,
    );
  }
  
  /// 添加发送的好友请求
  UserFriendsModel addSentRequest(FriendRequestModel request) {
    final updatedRequests = List<FriendRequestModel>.from(sentRequests);
    
    // 检查是否已经存在相同ID的请求
    final existingIndex = updatedRequests.indexWhere((r) => r.requestId == request.requestId);
    if (existingIndex >= 0) {
      updatedRequests[existingIndex] = request;
    } else {
      updatedRequests.add(request);
    }
    
    return UserFriendsModel(
      userId: userId,
      friends: friends,
      receivedRequests: receivedRequests,
      sentRequests: updatedRequests,
    );
  }
  
  /// 更新好友请求状态
  UserFriendsModel updateRequestStatus(String requestId, FriendRequestStatus status) {
    // 更新收到的请求
    final updatedReceivedRequests = receivedRequests.map((request) {
      if (request.requestId == requestId) {
        return FriendRequestModel(
          requestId: request.requestId,
          senderId: request.senderId,
          receiverId: request.receiverId,
          message: request.message,
          status: status,
          createdAt: request.createdAt,
          updatedAt: DateTime.now(),
        );
      }
      return request;
    }).toList();
    
    // 更新发送的请求
    final updatedSentRequests = sentRequests.map((request) {
      if (request.requestId == requestId) {
        return FriendRequestModel(
          requestId: request.requestId,
          senderId: request.senderId,
          receiverId: request.receiverId,
          message: request.message,
          status: status,
          createdAt: request.createdAt,
          updatedAt: DateTime.now(),
        );
      }
      return request;
    }).toList();
    
    return UserFriendsModel(
      userId: userId,
      friends: friends,
      receivedRequests: updatedReceivedRequests,
      sentRequests: updatedSentRequests,
    );
  }
}
