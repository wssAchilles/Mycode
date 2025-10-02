import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as path;

import '../config/filebase_config.dart';
import '../models/message_model.dart';
import '../models/user_model.dart';
import '../models/group_model.dart';
import 'auth_service.dart';
import 'filebase_service.dart';
import 'websocket_service.dart';
import 'group_service.dart';

/// 聊天服务
/// 
/// 负责处理与聊天消息相关的业务逻辑，包括发送、接收和管理消息
class ChatService with ChangeNotifier {
  /// 群聊消息缓存
  /// 键为群组ID，值为消息列表
  final Map<String, List<MessageModel>> _groupMessagesCache = {};
  
  /// 群聊消息最后更新时间
  /// 键为群组ID，值为最后更新时间
  final Map<String, DateTime> _groupLastUpdateTimes = {};
  
  /// 群聊历史刷新回调，由 GroupChatDetailScreen 设置
  Function? onGroupChatHistoryRefresh;
  
  /// 设置群聊历史刷新回调
  set groupChatHistoryCallback(Function? callback) {
    onGroupChatHistoryRefresh = callback;
  }
  /// Filebase 服务实例
  final FilebaseService _filebaseService;
  
  /// 认证服务实例
  final AuthService? _authService;
  
  /// WebSocket 服务实例
  WebSocketService? _websocketService;
  
  /// 聊天消息缓存
  /// 键为 "userId1_userId2"，值为消息列表
  final Map<String, List<MessageModel>> _messagesCache = {};
  
  /// 上次消息更新时间
  /// 键为 "userId1_userId2"，值为最后更新时间
  final Map<String, DateTime> _lastUpdateTimes = {};
  
  /// 构造函数
  ChatService(this._filebaseService, [this._authService]);
  
  /// 设置 WebSocket 服务
  void setWebSocketService(WebSocketService websocketService) {
    _websocketService = websocketService;
  }
  
  /// 初始化聊天服务
  /// 确保必要的目录结构存在
  Future<void> initializeChatService(String userId) async {
    print('初始化聊天服务，用户ID: $userId');
    
    try {
      // 检查 chats/ 目录是否存在，如果不存在则创建一个空的占位文件
      final chatFiles = await _filebaseService.listObjects(
        FilebaseConfig.chatMessagesBucket,
        prefix: 'chats/',
      );
      
      if (chatFiles.isEmpty) {
        print('聊天目录为空，创建占位文件');
        
        // 创建一个空的占位文件，确保 chats/ 目录存在
        final placeholderJson = {
          'created': DateTime.now().toIso8601String(),
          'description': 'Directory placeholder',
          'userId': userId
        };
        
        await _filebaseService.uploadJson(
          FilebaseConfig.chatMessagesBucket,
          'chats/.placeholder.json',
          placeholderJson,
        );
        
        print('成功创建聊天目录占位文件');
      } else {
        print('聊天目录已存在，包含 ${chatFiles.length} 个文件');
      }
    } catch (e) {
      print('初始化聊天服务失败: $e');
      // 失败不阻止应用继续运行
    }
  }
  
  @override
  void dispose() {
    _messagesCache.clear();
    _lastUpdateTimes.clear();
    _groupMessagesCache.clear();
    _groupLastUpdateTimes.clear();
    super.dispose();
  }
  
  /// 生成聊天记录文件名
  /// 
  /// 始终按字母顺序排序两个用户ID，确保唯一性
  /// 例如，无论是 alice_bob 还是 bob_alice，最终都会生成 alice_bob
  String _getChatFileName(String userId1, String userId2) {
    // 按字母顺序排序两个用户ID
    final sortedUserIds = [userId1, userId2]..sort();
    return '${sortedUserIds[0]}_${sortedUserIds[1]}.json';
  }
  
  /// 生成聊天对象键
  /// 
  /// 用于在 Filebase 存储聊天消息
  String _getChatObjectKey(String userId1, String userId2) {
    return 'chats/${_getChatFileName(userId1, userId2)}';
  }
  
  /// 生成群组聊天对象键
  /// 
  /// 用于在 Filebase 存储群组聊天消息
  String _getGroupChatObjectKey(String groupId) {
    return 'chats/group_${groupId}.json';
  }
  
  /// 获取缓存键
  String _getCacheKey(String userId1, String userId2) {
    return _getChatFileName(userId1, userId2).replaceAll('.json', '');
  }
  
  /// 发送文本消息
  /// 
  /// [senderId] - 发送方的用户ID
  /// [receiverId] - 接收方的用户ID
  /// [content] - 文本内容
  Future<MessageModel?> sendTextMessage({
    required String senderId,
    required String receiverId,
    required String content,
  }) async {
    try {
      // 创建消息ID（时间戳_发送者ID的前8位）
      final timestamp = DateTime.now();
      final messageId = '${timestamp.millisecondsSinceEpoch}_${senderId.substring(0, min(8, senderId.length))}';
      
      // 创建消息模型
      final message = MessageModel(
        messageId: messageId,
        senderId: senderId,
        receiverId: receiverId,
        timestamp: timestamp,
        messageType: MessageType.text,
        content: content,
        status: MessageStatus.sent,
      );
      
      // 保存消息到 Filebase
      await _saveMessage(message);
      
      return message;
    } catch (e) {
      print('发送文本消息失败: $e');
      return null;
    }
  }
  
  /// 发送图片消息
  /// 
  /// [senderId] - 发送方的用户ID
  /// [receiverId] - 接收方的用户ID
  /// [imageFilePath] - 图片文件本地路径
  Future<MessageModel?> sendImageMessage({
    required String senderId,
    required String receiverId,
    required String imageFilePath,
  }) async {
    try {
      print('准备发送图片: $imageFilePath');
      
      // 获取文件扩展名
      final extension = path.extension(imageFilePath).toLowerCase();
      print('图片扩展名: $extension');
      
      // 扩展支持的格式
      final validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
      
      // 如果文件没有扩展名但是路径存在，也允许发送
      final fileExists = await File(imageFilePath).exists();
      if (extension.isEmpty && fileExists) {
        print('图片没有扩展名，但文件存在，允许发送');
      } else if (!validExtensions.contains(extension)) {
        print('不支持的图片格式: $extension');
        return null;
      }
      
      // 创建图片在 Filebase 中的对象键
      final timestamp = DateTime.now();
      final fileName = 'images/${senderId}_${timestamp.millisecondsSinceEpoch}${extension.isNotEmpty ? extension : '.jpg'}';
      
      print('准备上传图片到Filebase: $fileName');
      
      // 上传图片到 mediafiles 存储桶
      final uploadResult = await _filebaseService.uploadFile(
        FilebaseConfig.mediaFilesBucket,
        fileName,
        imageFilePath,
      );
      
      print('图片上传结果: $uploadResult');
      
      // 获取图片的 IPFS CID
      final ipfsCid = await _filebaseService.getIpfsCid(
        FilebaseConfig.mediaFilesBucket,
        fileName,
      );
      
      if (ipfsCid == null) {
        print('无法获取图片的 IPFS CID');
        return null;
      }
      
      print('获取到图片IPFS CID: $ipfsCid');
      
      // 创建消息ID
      final messageId = '${timestamp.millisecondsSinceEpoch}_${senderId.substring(0, min(8, senderId.length))}';
      
      // 创建消息模型
      final message = MessageModel(
        messageId: messageId,
        senderId: senderId,
        receiverId: receiverId,
        timestamp: timestamp,
        messageType: MessageType.image,
        content: ipfsCid, // 存储 IPFS CID 作为内容
        status: MessageStatus.sent,
      );
      
      // 保存消息到 Filebase
      await _saveMessage(message);
      
      return message;
    } catch (e) {
      print('发送图片消息失败: $e');
      return null;
    }
  }
  
  /// 发送表情包消息
  /// 
  /// [senderId] - 发送方的用户ID
  /// [receiverId] - 接收方的用户ID
  /// [emojiId] - 表情包的ID
  Future<MessageModel?> sendEmojiMessage({
    required String senderId,
    required String receiverId,
    required String emojiId,
  }) async {
    try {
      // 创建消息ID
      final timestamp = DateTime.now();
      final messageId = '${timestamp.millisecondsSinceEpoch}_${senderId.substring(0, min(8, senderId.length))}';
      
      // 创建消息模型
      final message = MessageModel(
        messageId: messageId,
        senderId: senderId,
        receiverId: receiverId,
        timestamp: timestamp,
        messageType: MessageType.emoji,
        content: emojiId, // 存储表情包ID作为内容
        status: MessageStatus.sent,
      );
      
      // 保存消息到 Filebase
      await _saveMessage(message);
      
      return message;
    } catch (e) {
      print('发送表情包消息失败: $e');
      return null;
    }
  }
  
  /// 保存消息到 Filebase
  /// 
  /// 将消息添加到聊天记录文件中
  Future<void> _saveMessage(MessageModel message) async {
    try {
      final senderId = message.senderId;
      final receiverId = message.receiverId;
      
      // 获取对象键
      final objectKey = _getChatObjectKey(senderId, receiverId);
      
      // 获取缓存键
      final cacheKey = _getCacheKey(senderId, receiverId);
      
      // 检查缓存中是否有消息
      if (_messagesCache.containsKey(cacheKey)) {
        // 添加新消息到缓存
        _messagesCache[cacheKey]!.add(message);
      } else {
        // 创建新的缓存条目
        _messagesCache[cacheKey] = [message];
      }
      
      // 尝试获取现有聊天记录
      final existingChat = await _filebaseService.getJson(
        FilebaseConfig.chatMessagesBucket,
        objectKey,
      );
      
      List<Map<String, dynamic>> messagesJson = [];
      
      if (existingChat != null) {
        // 如果存在聊天记录，提取消息列表
        messagesJson = List<Map<String, dynamic>>.from(existingChat['messages'] ?? []);
      }
      
      // 添加新消息到消息列表
      messagesJson.add(message.toJson());
      
      // 构建聊天记录 JSON
      final chatJson = {
        'participants': [senderId, receiverId],
        'lastUpdated': DateTime.now().toIso8601String(),
        'messages': messagesJson,
      };
      
      // 上传到 Filebase
      await _filebaseService.uploadJson(
        FilebaseConfig.chatMessagesBucket,
        objectKey,
        chatJson,
      );
      
      // 更新最后更新时间
      _lastUpdateTimes[cacheKey] = DateTime.now();
      
      // 通知监听者
      notifyListeners();
      
      // 通过WebSocket通知接收者有新消息
      if (_websocketService != null) {
        // 消息已保存到Filebase，通过WebSocket通知接收者
        _websocketService!.sendMessage(message);
      }
    } catch (e) {
      print('保存消息失败: $e');
      throw e;
    }
  }
  
  /// 加载聊天消息历史
  /// 
  /// [currentUserId] - 当前用户ID
  /// [otherUserId] - 对方用户ID
  /// [limit] - 加载消息数量限制，如果为 null 则加载全部
  /// [beforeTimestamp] - 加载此时间戳之前的消息，用于分页，如果为 null 则加载最新消息
  Future<List<MessageModel>> loadMessages({
    required String currentUserId,
    required String otherUserId,
    int? limit,
    DateTime? beforeTimestamp,
  }) async {
    try {
      // 获取聊天记录文件对象键
      final objectKey = _getChatObjectKey(currentUserId, otherUserId);
      final cacheKey = _getCacheKey(currentUserId, otherUserId);
      
      // 尝试从 Filebase 获取聊天记录
      final chatJson = await _filebaseService.downloadJson(
        FilebaseConfig.chatMessagesBucket,
        objectKey,
      );
      
      // 如果文件不存在，返回空列表
      if (chatJson == null || chatJson['messages'] == null) {
        _messagesCache[cacheKey] = [];
        _lastUpdateTimes[cacheKey] = DateTime.now();
        return [];
      }
      
      // 解析消息
      final List<dynamic> messagesJson = chatJson['messages'];
      List<MessageModel> messages = messagesJson
          .map((msg) => MessageModel.fromJson(msg))
          .toList();
      
      // 按时间戳升序排序
      messages.sort((a, b) => a.timestamp.compareTo(b.timestamp));
      
      // 应用时间戳过滤
      if (beforeTimestamp != null) {
        messages = messages
            .where((msg) => msg.timestamp.isBefore(beforeTimestamp))
            .toList();
      }
      
      // 应用数量限制
      if (limit != null && messages.length > limit) {
        messages = messages.sublist(messages.length - limit);
      }
      
      // 更新本地缓存
      _messagesCache[cacheKey] = messages;
      _lastUpdateTimes[cacheKey] = DateTime.now();
      
      return messages;
    } catch (e) {
      print('加载消息历史失败: $e');
      return [];
    }
  }
  
  /// 刷新聊天历史
  /// 
  /// [userId] - 与当前用户聊天的另一个用户ID
  /// 
  /// 用于从 Filebase 重新加载聊天历史，当收到 WebSocket 通知时调用
  Future<void> refreshChatHistory(String userId) async {
    try {
      final currentUser = _authService?.currentUser;
      if (currentUser == null) return;
      
      final currentUserId = currentUser.userId;
      
      // 获取对象键
      final objectKey = _getChatObjectKey(currentUserId, userId);
      
      // 获取缓存键
      final cacheKey = _getCacheKey(currentUserId, userId);
      
      // 获取聊天记录
      final chatJson = await _filebaseService.getJson(
        FilebaseConfig.chatMessagesBucket,
        objectKey,
      );
      
      if (chatJson == null) return;
      
      // 解析聊天记录的最后更新时间
      final chatLastUpdated = DateTime.tryParse(chatJson['lastUpdated'] ?? '') ?? DateTime(1970);
      
      // 解析消息列表
      final messagesJson = List<Map<String, dynamic>>.from(chatJson['messages'] ?? []);
      
      // 转换为消息模型列表
      final messages = messagesJson.map((json) => MessageModel.fromJson(json)).toList();
      
      // 更新缓存
      _messagesCache[cacheKey] = messages;
      
      // 更新最后更新时间
      _lastUpdateTimes[cacheKey] = chatLastUpdated;
      
      // 通知监听者
      notifyListeners();
      
      print('已刷新与用户 $userId 的聊天历史');
    } catch (e) {
      print('刷新聊天历史失败: $e');
    }
  }
  
  /// 刷新聊天列表
  /// 
  /// 重新加载当前用户的所有聊天列表，当收到新消息通知时调用
  Future<void> refreshChatList() async {
    try {
      final currentUser = _authService?.currentUser;
      if (currentUser == null) return;
      
      // 重新获取聊天列表
      await getChatList(currentUser.userId);
      
      // 通知监听者 (getChatList 中已经调用 notifyListeners)
      
      print('已刷新聊天列表');
    } catch (e) {
      print('刷新聊天列表失败: $e');
    }
  }
  
  /// 更新消息状态
  /// 
  /// [messageId] - 消息ID
  /// [status] - 新的消息状态，使用 MessageStatus 类中的常量
  Future<void> updateMessageStatus(String messageId, String status) async {
    try {
      // 在所有缓存中查找消息
      for (final cacheKey in _messagesCache.keys) {
        final messages = _messagesCache[cacheKey]!;
        
        // 查找消息
        final index = messages.indexWhere((msg) => msg.messageId == messageId);
        if (index >= 0) {
          // 获取消息
          final message = messages[index];
          
          // 如果状态相同，跳过
          if (message.status == status) continue;
          
          // 更新消息状态
          messages[index] = message.copyWith(status: status);
          
          // 解析用户ID
          final userIds = cacheKey.split('_');
          if (userIds.length == 2) {
            // 获取对象键
            final objectKey = _getChatObjectKey(userIds[0], userIds[1]);
            
            // 保存回 Filebase
            final chatJson = {
              'participants': userIds,
              'lastUpdated': DateTime.now().toIso8601String(),
              'messages': messages.map((msg) => msg.toJson()).toList(),
            };
            
            // 上传到 Filebase
            await _filebaseService.uploadJson(
              FilebaseConfig.chatMessagesBucket,
              objectKey,
              chatJson,
            );
            
            // 更新最后更新时间
            _lastUpdateTimes[cacheKey] = DateTime.now();
            
            // 通知监听者
            notifyListeners();
            
            print('已更新消息 $messageId 的状态为 ${status.toString()}');
            return;
          }
        }
      }
    } catch (e) {
      print('更新消息状态失败: $e');
    }
  }
  
  /// 获取缓存的消息列表
  /// 
  /// 如果缓存中有消息，则直接返回；否则从 Filebase 加载
  Future<List<MessageModel>> getCachedMessages({
    required String currentUserId,
    required String otherUserId,
  }) async {
    final cacheKey = _getCacheKey(currentUserId, otherUserId);
    
    if (_messagesCache.containsKey(cacheKey) && 
        _messagesCache[cacheKey]!.isNotEmpty) {
      return _messagesCache[cacheKey]!;
    }
    
    // 缓存为空，从 Filebase 加载
    return await loadMessages(
      currentUserId: currentUserId,
      otherUserId: otherUserId,
    );
  }
  
  /// 获取聊天列表

  /// 发送群组文本消息
  /// 
  /// [groupId] - 群组ID
  /// [senderId] - 发送者ID
  /// [content] - 消息内容
  /// [messageId] - 可选的消息ID，用于前端生成的临时消息ID
  Future<MessageModel?> sendGroupTextMessage({
    required String groupId,
    String? senderId,
    required String content,
    String? messageId,
  }) async {
    try {
      final authService = _authService;
      if (authService == null) {
        throw Exception('认证服务未初始化');
      }
      
      final currentUser = authService.currentUser;
      if (currentUser == null) {
        throw Exception('用户未登录');
      }
      
      senderId = senderId ?? currentUser.userId;
      
      // 创建消息ID（如果未提供）
      final timestamp = DateTime.now();
      messageId = messageId ?? '${timestamp.millisecondsSinceEpoch}_${senderId.substring(0, min(8, senderId.length))}';
      
      // 创建消息模型
      final message = MessageModel(
        messageId: messageId,
        senderId: senderId,
        receiverId: groupId, // 群聊中，receiverId存储groupId
        timestamp: timestamp,
        messageType: MessageType.text,
        content: content,
        status: MessageStatus.sent,
        conversationType: ConversationType.group, // 标记为群聊消息
        senderName: currentUser.username, // 发送者名称
      );
      
      // 保存消息到Filebase
      await _saveGroupMessage(message);
      
      // 通过WebSocket发送群组消息
      if (_websocketService != null) {
        _websocketService!.sendGroupMessage(message);
      }
      
      return message;
    } catch (e) {
      print('发送群组文本消息失败: $e');
      return null;
    }
  }
  
  /// 发送群组图片消息
  /// 
  /// [groupId] - 群组ID
  /// [senderId] - 发送者ID，如果不提供则使用当前登录用户
  /// [imageFile] - 图片文件
  /// [messageId] - 可选的消息ID，用于前端生成的临时消息ID
  Future<MessageModel?> sendGroupImageMessage({
    required String groupId,
    String? senderId,
    required File imageFile,
    String? messageId,
  }) async {
    try {
      final authService = _authService;
      if (authService == null) {
        throw Exception('认证服务未初始化');
      }
      
      final currentUser = authService.currentUser;
      if (currentUser == null) {
        throw Exception('用户未登录');
      }
      
      senderId = senderId ?? currentUser.userId;
      
      // 获取文件扩展名
      final extension = path.extension(imageFile.path).toLowerCase();
      final validExtensions = ['.jpg', '.jpeg', '.png', '.gif'];
      
      if (!validExtensions.contains(extension)) {
        print('不支持的图片格式: $extension');
        return null;
      }
      
      // 创建图片在Filebase中的对象键
      final timestamp = DateTime.now();
      final fileName = 'images/group_${groupId}_${senderId}_${timestamp.millisecondsSinceEpoch}${extension}';
      
      // 上传图片到mediafiles存储桶
      final uploadResult = await _filebaseService.uploadFile(
        FilebaseConfig.mediaFilesBucket,
        fileName,
        imageFile.path,
      );
      
      // 检查上传结果
      if (uploadResult == null || uploadResult.isEmpty) {
        throw Exception('上传图片失败');
      }
      
      // 构建IPFS URL
      final imageUrl = 'https://${FilebaseConfig.mediaFilesBucket}.${FilebaseConfig.endpoint}/$fileName';
      
      // 创建消息ID（如果未提供）
      messageId = messageId ?? '${timestamp.millisecondsSinceEpoch}_${senderId.substring(0, min(8, senderId.length))}';
      
      // 创建消息模型
      final message = MessageModel(
        messageId: messageId,
        senderId: senderId,
        receiverId: groupId, // 群聊中，receiverId存储groupId
        timestamp: timestamp,
        messageType: MessageType.image,
        content: imageUrl,
        status: MessageStatus.sent,
        conversationType: ConversationType.group, // 标记为群聊消息
        senderName: currentUser.username, // 发送者名称
      );
      
      // 保存消息到Filebase
      await _saveGroupMessage(message);
      
      // 通过WebSocket发送群组图片消息
      if (_websocketService != null) {
        _websocketService!.sendGroupMessage(message);
      }
      
      return message;
    } catch (e) {
      print('发送群组图片消息失败: $e');
      return null;
    }
  }
  
  /// 使用字节数据发送群组图片消息（为Web平台设计）
  /// 
  /// [groupId] - 群组ID
  /// [senderId] - 发送者ID，如果不提供则使用当前登录用户
  /// [imageBytes] - 图片字节数据
  /// [messageId] - 可选的消息ID，用于前端生成的临时消息ID
  Future<MessageModel?> sendGroupImageMessageWithBytes({
    required String groupId,
    String? senderId,
    required Uint8List imageBytes,
    String? messageId,
  }) async {
    try {
      final authService = _authService;
      if (authService == null) {
        throw Exception('认证服务未初始化');
      }
      
      final currentUser = authService.currentUser;
      if (currentUser == null) {
        throw Exception('用户未登录');
      }
      
      senderId = senderId ?? currentUser.userId;
      
      // 创建图片在Filebase中的对象键
      final timestamp = DateTime.now();
      final fileName = 'images/group_${groupId}_${senderId}_${timestamp.millisecondsSinceEpoch}.jpg'; // 假设为JPEG格式
      
      // 上传图片到mediafiles存储桶
      final uploadResult = await _filebaseService.uploadData(
        FilebaseConfig.mediaFilesBucket,
        fileName,
        imageBytes,
        'image/jpeg', // 假设为JPEG格式
      );
      
      // 检查上传结果
      if (uploadResult == null || uploadResult.isEmpty) {
        throw Exception('上传图片失败');
      }
      
      // 构建IPFS URL
      final imageUrl = uploadResult; // uploadData 返回的已经是完整的 URL
      
      // 创建消息ID（如果未提供）
      messageId = messageId ?? '${timestamp.millisecondsSinceEpoch}_${senderId.substring(0, min(8, senderId.length))}';
      
      // 创建消息模型
      final message = MessageModel(
        messageId: messageId,
        senderId: senderId,
        receiverId: groupId, // 群聊中，receiverId存储groupId
        timestamp: timestamp,
        messageType: MessageType.image,
        content: imageUrl,
        status: MessageStatus.sent,
        conversationType: ConversationType.group, // 标记为群聊消息
        senderName: currentUser.username, // 发送者名称
      );
      
      // 保存消息到Filebase
      await _saveGroupMessage(message);
      
      // 通过WebSocket发送群组图片消息
      if (_websocketService != null) {
        _websocketService!.sendGroupMessage(message);
      }
      
      return message;
    } catch (e) {
      print('发送群组图片消息失败 (使用 bytes): $e');
      return null;
    }
  }
  
  /// 发送群组表情包消息
  /// 
  /// [groupId] - 群组ID
  /// [senderId] - 发送者ID，如果不提供则使用当前登录用户
  /// [emojiId] - 表情包ID
  /// [messageId] - 可选的消息ID，用于前端生成的临时消息ID
  Future<MessageModel?> sendGroupEmojiMessage({
    required String groupId,
    String? senderId,
    required String emojiId,
    String? messageId,
  }) async {
    try {
      final authService = _authService;
      if (authService == null) {
        throw Exception('认证服务未初始化');
      }
      
      final currentUser = authService.currentUser;
      if (currentUser == null) {
        throw Exception('用户未登录');
      }
      
      senderId = senderId ?? currentUser.userId;
      
      // 创建消息ID（如果未提供）
      final timestamp = DateTime.now();
      messageId = messageId ?? '${timestamp.millisecondsSinceEpoch}_${senderId.substring(0, min(8, senderId.length))}';
      
      // 创建消息模型
      final message = MessageModel(
        messageId: messageId,
        senderId: senderId,
        receiverId: groupId, // 群聊中，receiverId存储groupId
        timestamp: timestamp,
        messageType: MessageType.emoji,
        content: emojiId, // 表情包ID
        status: MessageStatus.sent,
        conversationType: ConversationType.group, // 标记为群聊消息
        senderName: currentUser.username, // 发送者名称
      );
      
      // 保存消息到Filebase
      await _saveGroupMessage(message);
      
      // 通过WebSocket发送群组消息
      if (_websocketService != null) {
        _websocketService!.sendGroupMessage(message);
      }
      
      return message;
    } catch (e) {
      print('发送群组表情包消息失败: $e');
      return null;
    }
  }
  
  /// 保存群组消息到Filebase
  Future<void> _saveGroupMessage(MessageModel message) async {
    try {
      if (message.conversationType != ConversationType.group) {
        throw Exception('非群组消息不能使用此方法保存');
      }
      
      final groupId = message.receiverId; // 群聊中，receiverId存储groupId
      final objectKey = _getGroupChatObjectKey(groupId);
      
      // 尝试从缓存加载现有消息
      List<MessageModel> messages = [];
      if (_groupMessagesCache.containsKey(groupId)) {
        messages = List.from(_groupMessagesCache[groupId]!);
      } else {
        // 尝试从Filebase加载现有的群聊记录
        try {
          final existingData = await _filebaseService.getJson(
            FilebaseConfig.chatMessagesBucket,
            objectKey,
          );
          
          if (existingData != null && existingData['messages'] is List) {
            messages = (existingData['messages'] as List)
                .map((msgJson) => MessageModel.fromJson(msgJson))
                .toList();
          }
        } catch (e) {
          // 如果文件不存在或加载失败，使用空列表
          print('加载群聊记录失败，将创建新记录: $e');
        }
      }
      
      // 添加新消息
      messages.add(message);
      
      // 构建群聊记录JSON
      final chatJson = {
        'groupId': groupId,
        'lastUpdated': DateTime.now().toIso8601String(),
        'messages': messages.map((msg) => msg.toJson()).toList(),
      };
      
      // 保存到Filebase
      await _filebaseService.uploadJson(
        FilebaseConfig.chatMessagesBucket,
        objectKey,
        chatJson,
      );
      
      // 更新缓存
      _groupMessagesCache[groupId] = messages;
      _groupLastUpdateTimes[groupId] = DateTime.now();
    } catch (e) {
      print('保存群组消息失败: $e');
      throw e; // 重新抛出异常，让调用者处理
    }
  }
  
  /// 加载群组消息历史
  /// 
  /// [groupId] - 群组ID
  /// [limit] - 加载消息数量限制，如果为null则加载全部
  /// [beforeTimestamp] - 加载此时间戳之前的消息，用于分页，如果为null则加载最新消息
  Future<List<MessageModel>> loadGroupMessages(
    String groupId, {
    int? limit,
    DateTime? beforeTimestamp,
  }) async {
    try {
      // 检查缓存，如果是较新的缓存且没有分页要求，直接返回
      if (_groupMessagesCache.containsKey(groupId) &&
          _groupLastUpdateTimes.containsKey(groupId) &&
          _groupLastUpdateTimes[groupId]!.isAfter(
            DateTime.now().subtract(const Duration(minutes: 1)),
          ) &&
          beforeTimestamp == null) {
        final cachedMessages = _groupMessagesCache[groupId]!;
        
        // 如果有分页限制，返回最后的limit条消息
        if (limit != null && limit > 0 && cachedMessages.length > limit) {
          return cachedMessages.sublist(cachedMessages.length - limit);
        }
        
        return cachedMessages;
      }
      
      // 从Filebase加载群聊记录
      final objectKey = _getGroupChatObjectKey(groupId);
      final data = await _filebaseService.getJson(
        FilebaseConfig.chatMessagesBucket,
        objectKey,
      );
      
      List<MessageModel> messages = [];
      
      if (data != null && data['messages'] is List) {
        messages = (data['messages'] as List)
            .map((msgJson) => MessageModel.fromJson(msgJson))
            .toList();
            
        // 按时间戳升序排序
        messages.sort((a, b) => a.timestamp.compareTo(b.timestamp));
        
        // 如果指定了时间戳，只保留该时间戳之前的消息
        if (beforeTimestamp != null) {
          messages = messages
              .where((msg) => msg.timestamp.isBefore(beforeTimestamp))
              .toList();
        }
        
        // 如果指定了限制，只返回最后的limit条消息
        if (limit != null && limit > 0 && messages.length > limit) {
          messages = messages.sublist(messages.length - limit);
        }
      }
      
      // 更新缓存
      _groupMessagesCache[groupId] = messages;
      _groupLastUpdateTimes[groupId] = DateTime.now();
      
      return messages;
    } catch (e) {
      print('加载群组消息失败: $e');
      return [];
    }
  }
  
  /// 刷新群聊历史
  /// 
  /// [groupId] - 群组ID
  Future<void> refreshGroupChatHistory(String groupId) async {
    try {
      // 清除缓存，强制从Filebase重新加载
      _groupMessagesCache.remove(groupId);
      _groupLastUpdateTimes.remove(groupId);
      
      // 加载最新消息
      await loadGroupMessages(groupId);
      
      // 通知监听者
      notifyListeners();
      
      // 如果存在回调函数，则调用回调刷新UI
      if (onGroupChatHistoryRefresh != null) {
        onGroupChatHistoryRefresh!();
      }
    } catch (e) {
      print('刷新群聊历史失败: $e');
    }
  }
  
  /// 返回当前用户与之有聊天记录的所有用户和群组
  /// [currentUserId] - 当前用户ID
  Future<List<Map<String, dynamic>>> getChatList(String currentUserId) async {
    print('开始加载聊天列表，当前用户ID: $currentUserId');
    
    // 创建一个空的聊天列表，即使出错也能返回
    final List<Map<String, dynamic>> chatList = [];
    
    try {
      // 尝试列出 chatmessages 存储桶中的所有聊天文件
      List<String> chatFiles = [];
      
      try {
        chatFiles = await _filebaseService.listObjects(
          FilebaseConfig.chatMessagesBucket,
          prefix: 'chats/',
        );
        print('成功获取聊天文件列表，共 ${chatFiles.length} 个文件');
      } catch (e) {
        print('获取聊天文件列表失败，可能是存储桶不存在或为空: $e');
        // 继续执行，使用空的文件列表
        return chatList; // 直接返回空列表
      }
      
      // 如果没有聊天文件，直接返回空列表
      if (chatFiles.isEmpty) {
        print('没有找到聊天文件，返回空列表');
        return chatList;
      }
      
      for (final chatFile in chatFiles) {
        // 只处理 JSON 文件，跳过非 JSON 文件
        if (!chatFile.endsWith('.json')) {
            print('警告: 跳过非JSON聊天文件: $chatFile');
            continue;
        }

        final fileName = path.basename(chatFile);
        final baseName = path.basenameWithoutExtension(fileName); // 例如 "userA_userB" 或 "group_groupId"
        final userIdsInFile = baseName.split('_'); // 明确命名为文件中的ID

        // --- 新增：更严格的文件名格式初步验证 ---
        // 检查文件基础名称是否为空，或者是否为目录前缀（不包含 .json 扩展名）
        if (baseName.isEmpty || chatFile.endsWith('/')) { 
            print('警告: 跳过空文件名或目录占位符: $chatFile');
            continue;
        }

        // 检查文件名是否符合私聊 (userA_userB) 或群聊 (group_groupId) 的基本格式
        // 如果不是这两种之一，则跳过
        final isPrivateChatFormat = userIdsInFile.length == 2 && userIdsInFile[0].isNotEmpty && userIdsInFile[1].isNotEmpty;
        final isGroupChatFormat = baseName.startsWith('group_') && userIdsInFile.length == 2 && userIdsInFile[1].isNotEmpty; // group_ID

        if (!isPrivateChatFormat && !isGroupChatFormat) {
            print('警告: 跳过不符合预期的聊天文件格式: $chatFile (预期: userA_userB.json 或 group_ID.json)');
            continue;
        }

        // --- 优先处理私聊文件 ---
        // 检查是否是标准的私聊文件 (假设私聊文件名固定为 user1_user2 格式)
        if (isPrivateChatFormat && userIdsInFile.contains(currentUserId)) {
            // 确保 otherUserId 能被正确解析且不为空
            final otherUserId = userIdsInFile[0] == currentUserId ? userIdsInFile[1] : userIdsInFile[0];

            if (otherUserId.isEmpty || otherUserId == 'null' || otherUserId.contains('/') || otherUserId.contains('\\') || otherUserId.contains('.')) {
                print('警告: 发现格式异常的 otherUserId ($otherUserId)，跳过此私聊文件: $chatFile');
                continue; // 跳过此文件，因为它没有有效的对方用户ID
            }

            // 加载聊天消息
            final messages = await loadMessages(
                currentUserId: currentUserId,
                otherUserId: otherUserId,
            );

            // 获取对方用户信息
            UserModel? otherUser;
            if (_authService != null) {
                otherUser = await _authService!.getUserInfo(otherUserId);
            }

            // 如果有消息，添加到聊天列表
            if (messages.isNotEmpty) {
                final lastMessage = messages.last;

                chatList.add({
                    'userId': otherUserId,
                    'username': otherUser?.username ?? otherUserId,
                    'avatarUrl': otherUser?.avatarUrl,
                    'lastMessage': lastMessage,
                    'unreadCount': 0, // 未读消息数，后续可实现
                    'isGroup': false, // 明确标记为私聊
                });
            } else {
                // 即使没有消息，也添加此联系人到列表中
                chatList.add({
                    'userId': otherUserId,
                    'username': otherUser?.username ?? otherUserId,
                    'avatarUrl': otherUser?.avatarUrl,
                    'lastMessage': null, // 明确标记为没有消息
                    'unreadCount': 0,
                    'isGroup': false,
                });
            }
            continue; // 处理完这个私聊文件后，跳到下一个 chatFile
        }

        // --- 非私聊文件，在此处或群聊处理逻辑中跳过或处理 ---
        // 此时只剩下群聊格式的文件 (isGroupChatFormat 为 true)
        // 这些文件将会在下面的群聊列表加载逻辑中被处理，此处不需要额外处理
        // 非标准格式的文件已经在前面的验证中被过滤掉了
      }
      
      // 按最后一条消息的时间戳降序排序，处理lastMessage可能为null的情况
      if (chatList.isNotEmpty) {
        chatList.sort((a, b) {
          // 检查是否有加载错误标记
          final aHasError = a['loadError'] == true;
          final bHasError = b['loadError'] == true;
          
          // 有加载错误的排在后面
          if (aHasError && !bHasError) return 1;
          if (!aHasError && bHasError) return -1;
          
          final aMessage = a['lastMessage'] as MessageModel?;
          final bMessage = b['lastMessage'] as MessageModel?;
          
          if (aMessage == null && bMessage == null) return 0;
          if (aMessage == null) return 1; // null的排在后面
          if (bMessage == null) return -1;
          
          return bMessage.timestamp.compareTo(aMessage.timestamp);
        });
      }
      
      // --- 加载群聊列表 ---
      try {
        // 如果基本服务未就绪，就跳过群聊处理的剩余部分，但不提早返回整个 chatList
        if (_authService == null || _websocketService == null) {
          print('警告: 认证或WebSocket服务未就绪，跳过群聊列表加载。');
        } else {
        final groupService = GroupService(_filebaseService, _authService!, _websocketService!);
        final currentUserId = _authService!.currentUser?.userId;

        if (currentUserId == null) {
            print('警告: 当前用户ID为空，跳过群聊列表加载。');
          } else {
        final userGroups = await groupService.getUserGroups(currentUserId);
            print('获取到用户群组列表: ${userGroups.length}个');
        
        if (userGroups.isEmpty) {
              print('没有群组，跳过群聊列表加载。');
            } else {
        for (final group in userGroups) {
          // 验证群组ID的有效性
          if (group.groupId.isEmpty || group.groupId == 'null' || 
              group.groupId.contains('/') || group.groupId.contains('\\')) {
            print('警告: 发现无效的群组ID: ${group.groupId}，跳过此群组');
            continue;
          }

          try {
            // 加载群组的最新消息
            final groupMessages = await loadGroupMessages(group.groupId, limit: 1);
            
            // 如果有消息，添加到聊天列表
            if (groupMessages.isNotEmpty) {
              final lastMessage = groupMessages.last;
              
              chatList.add({
                'groupId': group.groupId,
                'groupName': group.groupName,
                'avatarUrl': group.avatarUrl,
                'isGroup': true,
                'lastMessage': lastMessage,
                'unreadCount': 0, // 未读消息数，后续可实现
                      'groupModel': group, // 将完整的 GroupModel 也传递过去
              });
            } else {
                    // 如果没有消息，仍然添加群组到列表（无 lastMessage）
              chatList.add({
                'groupId': group.groupId,
                'groupName': group.groupName,
                'avatarUrl': group.avatarUrl,
                'isGroup': true,
                      'lastMessage': null, // 明确设置为 null
                'unreadCount': 0,
                      'groupModel': group, // 将完整的 GroupModel 也传递过去
              });
            }
          } catch (e) {
            print('警告: 加载群组 ${group.groupId} 的消息失败: $e');
            // 即使加载消息失败，也添加群组到列表
            chatList.add({
              'groupId': group.groupId,
              'groupName': group.groupName,
              'avatarUrl': group.avatarUrl,
              'isGroup': true,
              'lastMessage': null,
              'unreadCount': 0,
              'loadError': true, // 标记加载错误
                    'groupModel': group, // 将完整的 GroupModel 也传递过去
            });
                }
              }
            }
          }
        }
      } catch (e) {
        print('加载群聊列表失败: $e');
        // 允许函数继续执行到最后，不影响私聊列表的返回
      }
      
      // 只有在聊天列表不为空时才排序
      if (chatList.isNotEmpty) {
        try {
          // 按最后一条消息的时间戳降序排序（没有消息的群组排在最后）
          chatList.sort((a, b) {
            // 首先检查是否有加载错误标记
            final aHasError = a['loadError'] == true;
            final bHasError = b['loadError'] == true;
            
            // 有加载错误的排在后面
            if (aHasError && !bHasError) return 1;
            if (!aHasError && bHasError) return -1;
            
            // 然后检查是否有最后一条消息
            final aMessage = a['lastMessage'] as MessageModel?;
            final bMessage = b['lastMessage'] as MessageModel?;
            
            // 如果两者都没有消息，按照群组/用户名排序
            if (aMessage == null && bMessage == null) {
              final aName = a['isGroup'] == true ? (a['groupName'] as String?) : (a['username'] as String?);
              final bName = b['isGroup'] == true ? (b['groupName'] as String?) : (b['username'] as String?);
              
              if (aName == null && bName == null) return 0;
              if (aName == null) return 1;
              if (bName == null) return -1;
              
              return aName.compareTo(bName);
            }
            
            // 如果只有一个有消息，有消息的排在前面
            if (aMessage == null) return 1;
            if (bMessage == null) return -1;
            
            // 如果两者都有消息，按时间戳排序
            return bMessage.timestamp.compareTo(aMessage.timestamp);
          });
        } catch (sortError) {
          print('排序聊天列表时出错: $sortError');
          // 排序失败不影响返回结果
        }
      }
      
      print('成功加载聊天列表，共 ${chatList.length} 个聊天');
      return chatList;
    } catch (e) {
      print('获取聊天列表时发生未处理的异常: $e');
      // 返回空列表而不是抛出异常
      return [];
    }
  }
  
  /// 消息轮询计时器
  Timer? _pollingTimer;
  
  /// 当前正在轮询的用户ID
  String? _pollingUserId;
  
  /// 当前正在轮询的群组ID
  String? _pollingGroupId;
  
  /// 开始消息轮询
  /// 
  /// 定期检查新消息
  /// [userId] - 聊天对象的用户ID，如果是群聊则为null
  /// [groupId] - 群聊ID，如果是私聊则为null
  /// [interval] - 轮询间隔，默认为3秒
  void startMessagePolling({
    String? userId,
    String? groupId,
    Duration interval = const Duration(seconds: 3),
  }) {
    // 停止现有的轮询
    stopMessagePolling();
    
    // 设置当前轮询的对象
    _pollingUserId = userId;
    _pollingGroupId = groupId;
    
    // 创建新的轮询计时器
    _pollingTimer = Timer.periodic(interval, (timer) async {
      try {
        if (_pollingUserId != null && _authService?.currentUser != null) {
          // 刷新私聊消息
          await refreshChatHistory(_pollingUserId!);
        } else if (_pollingGroupId != null) {
          // 刷新群聊消息
          await refreshGroupChatHistory(_pollingGroupId!);
        }
      } catch (e) {
        print('消息轮询出错: $e');
      }
    });
  }
  
  /// 停止消息轮询
  void stopMessagePolling() {
    _pollingTimer?.cancel();
    _pollingTimer = null;
    _pollingUserId = null;
    _pollingGroupId = null;
  }
  
  /// 标记消息为已读
  /// 
  /// [messageIds] - 要标记为已读的消息ID列表
  /// [currentUserId] - 当前用户ID
  /// [otherUserId] - 对方用户ID
  Future<void> markMessagesAsRead({
    required List<String> messageIds,
    required String currentUserId,
    required String otherUserId,
  }) async {
    try {
      final cacheKey = _getCacheKey(currentUserId, otherUserId);
      
      // 如果缓存中没有消息，先加载
      if (!_messagesCache.containsKey(cacheKey) || _messagesCache[cacheKey]!.isEmpty) {
        await loadMessages(
          currentUserId: currentUserId,
          otherUserId: otherUserId,
        );
      }
      
      // 获取缓存中的消息
      final messages = _messagesCache[cacheKey]!;
      bool hasChanges = false;
      
      // 遍历消息，标记为已读
      for (int i = 0; i < messages.length; i++) {
        if (messageIds.contains(messages[i].messageId) &&
            messages[i].receiverId == currentUserId &&
            messages[i].status != MessageStatus.read) {
          // 创建一个新的已读消息
          messages[i] = messages[i].copyWith(status: MessageStatus.read);
          hasChanges = true;
        }
      }
      
      // 如果有更改，保存回 Filebase
      if (hasChanges) {
        final objectKey = _getChatObjectKey(currentUserId, otherUserId);
        
        // 构建聊天记录 JSON
        final chatJson = {
          'participants': [currentUserId, otherUserId],
          'lastUpdated': DateTime.now().toIso8601String(),
          'messages': messages.map((msg) => msg.toJson()).toList(),
        };
        
        // 保存到 Filebase
        await _filebaseService.uploadJson(
          FilebaseConfig.chatMessagesBucket,
          objectKey,
          chatJson,
        );
        
        // 更新本地缓存
        _messagesCache[cacheKey] = messages;
        _lastUpdateTimes[cacheKey] = DateTime.now();
        
        // 通知监听者
        notifyListeners();
      }
    } catch (e) {
      print('标记消息为已读失败: $e');
    }
  }
}

/// 返回两个整数中的较小值
int min(int a, int b) {
  return a < b ? a : b;
}
