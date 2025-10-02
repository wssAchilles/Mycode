import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import '../models/message_model.dart';
import '../models/friend_model.dart';
import '../models/group_model.dart';
import 'auth_service.dart';
import 'chat_service.dart';
import 'notification_service.dart';
import 'friend_service.dart';
import 'group_service.dart';

/// WebSocket服务
/// 
/// 负责处理实时通信，包括连接到WebSocket服务器、
/// 发送消息和接收实时消息更新
class WebSocketService with ChangeNotifier {
    // WebSocket连接
  IO.Socket? _socket;
  
    // 认证服务
    final AuthService _authService;
  
    // 聊天服务
    final ChatService _chatService;
  
    // 通知服务
    final NotificationService _notificationService;
  
    // 好友服务
  FriendService? _friendService;
  
    // 群组服务
  GroupService? _groupService;
  
    // 连接状态
  bool _isConnected = false;
  
    // 正在连接
  bool _isConnecting = false;
  
    // 连接状态
  bool get isConnected => _isConnected;
  
    // 正在连接
  bool get isConnecting => _isConnecting;
  
    // 服务器URL
    final String _serverUrl;
  
    // 重连尝试次数
  int _reconnectAttempts = 0;
  
    // 最大重连尝试次数
    final int _maxReconnectAttempts = 5;
  
    // 重连计时器
  Timer? _reconnectTimer;
  
  /// 构造函数
  WebSocketService(
    this._authService, 
    this._chatService, 
    this._notificationService,
    {required String serverUrl}
  ) : _serverUrl = serverUrl {
      // 延迟获取FriendService
      // 由于依赖关系，需要在Provider初始化完成后在正式设置
    Future.microtask(() {
      setFriendService(null);
      });
      // 监听认证服务的变化
      _authService.addListener(_handleAuthChange);
    
      // 如果用户已登录，立即连接
      if (_authService.isLoggedIn) {
      connect();
      }
    }
  
  /// 处理认证状态变化
  void _handleAuthChange() {
      if (_authService.isLoggedIn) {
        // 用户登录，连接WebSocket
        if (!_isConnected && !_isConnecting) {
        connect();
        }
      } else {
        // 用户登出，断开WebSocket
      disconnect();
      }
    }
  
  /// 连接到WebSocket服务器
  Future<void> connect() async {
      if (_isConnected || _isConnecting) return;
    
    try {
        _isConnecting = true;
      notifyListeners();
      
        final currentUser = _authService.currentUser;
        if (currentUser == null) {
          _isConnecting = false;
        notifyListeners();
          return;
        }
      
        print('正在连接到WebSocket服务器: $_serverUrl');
      
        // 创建Socket.IO连接
        _socket = IO.io(_serverUrl, <String, dynamic>{
        'transports': ['websocket'],
        'autoConnect': false,
        'reconnection': false, // 我们将手动处理重连
        });
      
        // 监听连接事件
        _socket!.onConnect((_) {
          print('WebSocket已连接');
          _isConnected = true;
          _isConnecting = false;
          _reconnectAttempts = 0;
        
          // 发送认证信息
          _authenticate();
        
        notifyListeners();
        });
      
        // 监听断开连接事件
        _socket!.onDisconnect((_) {
          print('WebSocket已断开连接');
          _isConnected = false;
        notifyListeners();
        
          // 尝试重连
          _attemptReconnect();
        });
      
        // 监听错误
        _socket!.onError((error) {
          print('WebSocket错误: $error');
          _isConnected = false;
          _isConnecting = false;
        notifyListeners();
        
          // 尝试重连
          _attemptReconnect();
        });
      
        // 监听新消息
        _socket!.on('new_message', _handleNewMessage);
      
        // 监听聊天更新
        _socket!.on('chat_updated', _handleChatUpdated);
      
        // 监听消息发送成功
        _socket!.on('message_sent', _handleMessageSent);
      
        // 监听好友请求事件
        _socket!.on('friend_request', _handleFriendRequest);
      
        // 监听好友请求响应事件
        _socket!.on('friend_request_response', _handleFriendRequestResponse);
      
        // 监听好友移除事件
        _socket!.on('friend_removed', _handleFriendRemoved);
      
        // 监听群组相关事件
        _socket!.on('group_message', _handleGroupMessage);
        _socket!.on('group_created', _handleGroupCreated);
        _socket!.on('group_updated', _handleGroupUpdated);
        _socket!.on('group_member_added', _handleGroupMemberAdded);
        _socket!.on('group_member_removed', _handleGroupMemberRemoved);
        _socket!.on('added_to_group', _handleAddedToGroup);
        _socket!.on('removed_from_group', _handleRemovedFromGroup);
        _socket!.on('group_dissolved', _handleGroupDissolved);
      
        // 监听错误消息
        _socket!.on('error', (data) {
          print('服务器错误: ${data['message']}');
        });
      
        // 设置连接超时
        Timer(Duration(seconds: 5), () {
          if (_isConnecting && !_isConnected) {
            print('WebSocket连接超时');
            _isConnecting = false;
            notifyListeners();
            
            // 尝试重连
            _attemptReconnect();
          }
        });
        
        // 连接到服务器
        _socket!.connect();
      
      } catch (e) {
        print('WebSocket连接错误: $e');
        _isConnected = false;
        _isConnecting = false;
        notifyListeners();
      
        // 尝试重连
        _attemptReconnect();
      }
    }
  
  /// 断开与WebSocket服务器的连接
  void disconnect() {
      if (_socket != null) {
        _socket!.disconnect();
        _socket = null;
      }
    
      _isConnected = false;
      _isConnecting = false;
    
      // 取消重连计时器
      _reconnectTimer?.cancel();
      _reconnectTimer = null;
      _reconnectAttempts = 0;
    
    notifyListeners();
      print('已断开WebSocket连接');
    }
  
  /// 尝试重连
  void _attemptReconnect() {
      // 取消现有重连计时器
      _reconnectTimer?.cancel();
    
      // 如果超过最大重连次数，停止尝试
      if (_reconnectAttempts >= _maxReconnectAttempts) {
        print('已达到最大重连尝试次数');
        return;
      }
    
      // 计算重连延迟（指数退避算法）
      final delay = Duration(milliseconds: (1000 * (1 << _reconnectAttempts)));
      _reconnectAttempts++;
    
      print('将在${delay.inSeconds}秒后尝试重连（第$_reconnectAttempts次）');
    
      _reconnectTimer = Timer(delay, () {
        if (!_isConnected && !_isConnecting && _authService.isLoggedIn) {
          print('尝试重新连接到WebSocket服务器...');
        connect();
        }
      });
    }
  
  /// 发送认证信息
  void _authenticate() {
      final currentUser = _authService.currentUser;
      if (currentUser != null && _socket != null && _isConnected) {
        _socket!.emit('authenticate', {
        'userId': currentUser.userId,
        });
        print('已发送WebSocket认证信息');
      }
    }
  
  /// 处理新消息
  void _handleNewMessage(dynamic data) {
    try {
        final senderId = data['senderId'];
        final messagePreview = data['messagePreview'] ?? data['content'] ?? '';
        final timestamp = data['timestamp'];
        final conversationType = data['conversationType'] ?? ConversationType.direct;
      
        print('收到来自 $senderId 的新消息: $messagePreview');
      
        // 刷新聊天列表和对应的聊天详情
        _chatService.refreshChatList();
      
        // 如果是私聊消息且提供了特定的聊天ID，刷新对应的聊天
        if (conversationType == ConversationType.direct && senderId != null) {
          _chatService.refreshChatHistory(senderId);
        }
      
        final senderName = data['senderName'];
      
        // 显示通知
        if (conversationType == ConversationType.direct) {
          _notificationService.showMessageNotification(
          senderId: senderId,
          messagePreview: messagePreview,
        );
        } else {
          // 对于群聊消息，显示特殊通知
          final groupId = data['receiverId'];
          final groupName = data['groupName'] ?? '群组消息';
        
          _notificationService.showGroupMessageNotification(
          groupId: groupId,
          groupName: groupName,
          senderId: senderId,
          senderName: senderName ?? '群成员',
          messagePreview: messagePreview,
        );
        }
      
      } catch (e) {
        print('处理新消息错误: $e');
      }
    }
  
  /// 处理群组消息
  void _handleGroupMessage(dynamic data) {
    try {
        final groupId = data['receiverId'] ?? data['groupId'];
        final senderId = data['senderId'];
        final senderName = data['senderName'] ?? '群成员';
        final messagePreview = data['content'] ?? '';
        final groupName = data['groupName'] ?? '群组';
      
        print('收到群聊消息: $groupName ($groupId) 来自 $senderName: $messagePreview');
      
        // 刷新聊天列表
        _chatService.refreshChatList();
      
        // 刷新群组历史消息
        if (_chatService.refreshGroupChatHistory != null && groupId != null) {
          _chatService.refreshGroupChatHistory!(groupId);
        }
      
        // 显示通知
        _notificationService.showGroupMessageNotification(
        groupId: groupId,
        groupName: groupName,
        senderId: senderId,
        senderName: senderName,
        messagePreview: messagePreview,
      );
      
      } catch (e) {
        print('处理群组消息错误: $e');
      }
    }
  
  /// 处理聊天更新
  void _handleChatUpdated(dynamic data) {
    try {
        final chatId = data['chatId'];
        final lastMessage = data['lastMessage'];
      
        print('聊天$chatId已更新');
      
        // 刷新聊天列表
        _chatService.refreshChatList();
      
        // 如果提供了特定的聊天ID，分析出相关的用户ID并刷新对应的聊天
        if (chatId != null && chatId is String) {
          final userIds = chatId.split('_');
          if (userIds.length == 2) {
            final currentUserId = _authService.currentUser?.userId;
            final otherUserId = userIds[0] == currentUserId ? userIds[1] : userIds[0];
            _chatService.refreshChatHistory(otherUserId);
          }
        }
      
      } catch (e) {
        print('处理聊天更新错误: $e');
      }
    }
  
  /// 处理消息发送成功
  void _handleMessageSent(dynamic data) {
    try {
        final messageId = data['messageId'];
      
        print('消息$messageId发送成功');
      
        // 更新消息状态
        _chatService.updateMessageStatus(messageId, 'delivered');
      
      } catch (e) {
        print('处理消息发送成功错误: $e');
      }
    }
  
  /// 发送消息
  void sendMessage(MessageModel message) {
      if (_socket != null && _isConnected) {
      try {
          _socket!.emit('send_message', message.toJson());
        
          // 更新消息状态为正在发送
          _chatService.updateMessageStatus(message.messageId, 'sending');
        
          print('消息已发送: ${message.messageId}');
        } catch (e) {
          print('发送消息错误: $e');
        
          // 更新消息状态为发送失败
          _chatService.updateMessageStatus(message.messageId, 'failed');
        }
      }
    }
  
  /// 发送群组消息
  void sendGroupMessage(MessageModel message) {
      if (_socket != null && _isConnected) {
      try {
          _socket!.emit('send_group_message', message.toJson());
        
          // 更新消息状态为正在发送
          _chatService.updateMessageStatus(message.messageId, 'sending');
        
          print('群组消息已发送: ${message.messageId}');
        } catch (e) {
          print('发送群组消息错误: $e');
        
          // 更新消息状态为发送失败
          _chatService.updateMessageStatus(message.messageId, 'failed');
        }
      }
    }
  /// 处理好友请求
  void _handleFriendRequest(dynamic data) {
    try {
      final requestId = data['requestId'];
      final senderId = data['senderId'];
      final senderName = data['senderName'] ?? '';
      final message = data['message'];
    
      print('收到来自 $senderId ($senderName) 的好友请求');
    
      // 如果 FriendService 不可用，尝试重新获取
      if (_friendService == null) {
      setFriendService(null);
      }
    
      // 刷新好友请求数据
      final currentUserId = _authService.currentUser?.userId;
      if (currentUserId != null && _friendService != null) {
        _friendService!.refreshUserFriends(currentUserId);
      }
    
      // 显示通知
      _notificationService.showFriendRequestNotification(
      senderId: senderId,
      username: senderName,
      message: message,
    );
    
    } catch (e) {
      print('处理好友请求错误: $e');
    }
}

  /// 处理好友请求响应
    void _handleFriendRequestResponse(dynamic data) {
  try {
      final requestId = data['requestId'];
      final responderId = data['responderId'];
      final responderName = data['responderName'] ?? '';
      final accepted = data['accepted'] ?? false;
    
      print('好友请求响应: $responderId ($responderName) ${accepted ? '接受' : '拒绝'}了请求');
    
      // 刷新好友数据
      final currentUserId = _authService.currentUser?.userId;
      if (currentUserId != null && _friendService != null) {
        _friendService!.refreshUserFriends(currentUserId);
      }
    
      // 如果被接受，显示通知
      if (accepted) {
        _notificationService.showSystemNotification(
        title: '好友请求已接受',
        body: '$responderName 接受了您的好友请求',
      );
      }
    
    } catch (e) {
      print('处理好友请求响应错误: $e');
    }
}

  /// 处理好友移除
    void _handleFriendRemoved(dynamic data) {
  try {
      final removerId = data['removerId'];
      final removedId = data['removedId'];
    
      print('好友移除: $removerId 移除了 $removedId');
    
      // 刷新好友数据
      final currentUserId = _authService.currentUser?.userId;
      if (currentUserId != null && _friendService != null) {
        _friendService!.refreshUserFriends(currentUserId);
      }
    
    } catch (e) {
      print('处理好友移除错误: $e');
    }
}

  /// 设置FriendService
    void setFriendService(FriendService? friendService) {
    _friendService = friendService ?? _findFriendService();
}

  /// 设置GroupService
    void setGroupService(GroupService? groupService) {
    _groupService = groupService ?? _findGroupService();
}

  /// 从上下文中查找FriendService
    FriendService? _findFriendService() {
    // 这里只是一个占位符，实际运行时会不断尝试
    // 直到Provider.of<FriendService>()(在UI中)或findInheritedWidgetOfExactType生效
    return null;
}

  /// 从上下文中查找GroupService
    GroupService? _findGroupService() {
    // 同样是占位符
    return null;
}

  /// 处理群组创建事件
    void _handleGroupCreated(dynamic data) {
  try {
      final groupId = data['groupId'];
      final groupName = data['groupName'];
      final ownerId = data['ownerId'];
      final ownerName = data['ownerName'];
    
      print('收到群组创建通知: $groupName 由 $ownerName 创建');
    
      // 如果 GroupService 不可用，尝试重新获取
      if (_groupService == null) {
      setGroupService(null);
      }
    
      // 刷新用户群组数据
      final currentUserId = _authService.currentUser?.userId;
      if (currentUserId != null && _groupService != null) {
        _groupService!.refreshUserGroups(currentUserId);
      }
    
      // 显示通知
      _notificationService.showSystemNotification(
      title: '新群组通知',
      body: '您已被添加到群组 "$groupName"',
    );
    
    } catch (e) {
      print('处理群组创建事件错误: $e');
    }
}

  /// 处理群组更新事件
    void _handleGroupUpdated(dynamic data) {
  try {
      final groupId = data['groupId'];
      final groupName = data['groupName'];
      final updaterId = data['updaterId'];
      final updaterName = data['updaterName'];
    
      print('收到群组更新通知: $groupName 被 $updaterName 更新');
    
      // 刷新用户群组数据
      final currentUserId = _authService.currentUser?.userId;
      if (currentUserId != null && _groupService != null) {
        _groupService!.refreshUserGroups(currentUserId);
      }
    
    } catch (e) {
      print('处理群组更新事件错误: $e');
    }
}

  /// 处理群成员添加事件
    void _handleGroupMemberAdded(dynamic data) {
  try {
      final groupId = data['groupId'];
      final groupName = data['groupName'];
      final newMemberId = data['newMemberId'];
      final addedBy = data['addedByName'];
    
      print('收到群成员添加通知: $groupName 有新成员加入');
    
      // 刷新群组数据
      final currentUserId = _authService.currentUser?.userId;
      if (currentUserId != null && _groupService != null) {
        _groupService!.refreshUserGroups(currentUserId);
      }
    
    } catch (e) {
      print('处理群成员添加事件错误: $e');
    }
}

  /// 处理群成员移除事件
    void _handleGroupMemberRemoved(dynamic data) {
  try {
      final groupId = data['groupId'];
      final groupName = data['groupName'];
      final removedMemberId = data['removedMemberId'];
      final removedBy = data['removedByName'];
      final isSelf = data['isSelf'] ?? false;
    
      print('收到群成员移除通知: 成员从 $groupName 离开');
    
      // 刷新群组数据
      final currentUserId = _authService.currentUser?.userId;
      if (currentUserId != null && _groupService != null) {
        _groupService!.refreshUserGroups(currentUserId);
      }
    
    } catch (e) {
      print('处理群成员移除事件错误: $e');
    }
}

  /// 处理被添加到群组事件
    void _handleAddedToGroup(dynamic data) {
  try {
      final groupId = data['groupId'];
      final groupName = data['groupName'];
      final addedBy = data['addedByName'];
    
      print('被添加到群组: $groupName 由 $addedBy 邀请');
    
      // 刷新用户群组数据
      final currentUserId = _authService.currentUser?.userId;
      if (currentUserId != null && _groupService != null) {
        _groupService!.refreshUserGroups(currentUserId);
      }
    
      // 显示通知
      _notificationService.showSystemNotification(
      title: '新群组通知',
      body: '您已被 $addedBy 添加到群组 "$groupName"',
    );
    
    } catch (e) {
      print('处理被添加到群组事件错误: $e');
    }
}

  /// 处理从群组移除事件
    void _handleRemovedFromGroup(dynamic data) {
  try {
      final groupId = data['groupId'];
      final groupName = data['groupName'];
      final removedBy = data['removedByName'];
    
      print('被从群组移除: 从 $groupName 由 $removedBy 移除');
    
      // 刷新用户群组数据
      final currentUserId = _authService.currentUser?.userId;
      if (currentUserId != null && _groupService != null) {
        _groupService!.refreshUserGroups(currentUserId);
      }
    
      // 显示通知
      _notificationService.showSystemNotification(
      title: '群组移除通知',
      body: '您已被 $removedBy 从群组 "$groupName" 中移除',
    );
    
    } catch (e) {
      print('处理从群组移除事件错误: $e');
    }
}

  /// 处理群组解散事件
    void _handleGroupDissolved(dynamic data) {
  try {
      final groupId = data['groupId'];
      final groupName = data['groupName'];
      final dissolvedBy = data['dissolvedByName'];
    
      print('群组已解散: $groupName 由 $dissolvedBy 解散');
    
      // 刷新用户群组数据
      final currentUserId = _authService.currentUser?.userId;
      if (currentUserId != null && _groupService != null) {
        _groupService!.refreshUserGroups(currentUserId);
      }
    
      // 显示通知
      _notificationService.showSystemNotification(
      title: '群组解散通知',
      body: '群组 "$groupName" 已由群主 $dissolvedBy 解散',
    );
    
    } catch (e) {
      print('处理群组解散事件错误: $e');
    }
}

  /// 发送自定义事件
    void emitEvent(String eventName, dynamic data, {String? targetUserId}) {
    if (!_isConnected || _socket == null) {
      print('WebSocket未连接，无法发送事件');
      return;
    }
  
    final payload = {
    ...data,
      if (targetUserId != null) 'targetUserId': targetUserId,
    };
  
    _socket!.emit(eventName, payload);
}

  @override
  void dispose() {
      _authService.removeListener(_handleAuthChange);
    disconnect();
    super.dispose();
    }
}
