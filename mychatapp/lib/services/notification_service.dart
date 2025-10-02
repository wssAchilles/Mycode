import 'dart:io';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';
import '../models/models.dart';
import 'user_service.dart';

/// 推送通知服务类
/// 
/// 提供完整的FCM推送通知功能，包括：
/// - FCM令牌管理和权限处理
/// - 前台/后台/终止状态消息处理
/// - 防沉迷推送通知系统
/// - 好友请求和新消息通知
class NotificationService {
  static final NotificationService _instance = NotificationService._internal();
  factory NotificationService() => _instance;
  NotificationService._internal();

  final FirebaseMessaging _messaging = FirebaseMessaging.instance;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final UserService _userService = UserService();
  final FirebaseFunctions _functions = FirebaseFunctions.instance;

  /// 防沉迷相关配置
  static const int _maxDailyUsageMinutes = 120; // 每日最大使用时间（分钟）
  static const int _continuousUsageWarningMinutes = 30; // 连续使用警告时间
  static const int _restReminderIntervalMinutes = 60; // 休息提醒间隔

  DateTime? _sessionStartTime;
  DateTime? _lastUsageWarning;
  bool _isInitialized = false;

  /// 初始化推送通知服务
  Future<void> initialize() async {
    if (_isInitialized) return;

    try {
      // 请求通知权限
      await _requestPermission();
      
      // 获取并保存FCM令牌
      await _initializeFCMToken();
      
      // 设置消息处理器
      _setupMessageHandlers();
      
      // 初始化防沉迷功能
      _initializeAntiAddiction();
      
      _isInitialized = true;
      debugPrint('NotificationService initialized successfully');
    } catch (e) {
      debugPrint('Failed to initialize NotificationService: $e');
    }
  }

  /// 请求通知权限
  Future<bool> _requestPermission() async {
    NotificationSettings settings = await _messaging.requestPermission(
      alert: true,
      announcement: false,
      badge: true,
      carPlay: false,
      criticalAlert: false,
      provisional: false,
      sound: true,
    );

    if (settings.authorizationStatus == AuthorizationStatus.authorized) {
      debugPrint('Push notification permission granted');
      return true;
    } else {
      debugPrint('Push notification permission denied');
      return false;
    }
  }

  /// 初始化FCM令牌
  Future<void> _initializeFCMToken() async {
    try {
      String? token = await _messaging.getToken();
      if (token != null) {
        await _saveTokenToDatabase(token);
      }
      
      // 监听令牌刷新
      _messaging.onTokenRefresh.listen(_saveTokenToDatabase);
    } catch (e) {
      debugPrint('Failed to initialize FCM token: $e');
    }
  }

  /// 保存令牌到数据库
  Future<void> _saveTokenToDatabase(String token) async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user != null) {
        await _firestore.collection('users').doc(user.uid).update({
          'fcmToken': token,
        });
        debugPrint('FCM token saved: ${token.substring(0, 20)}...');
      }
    } catch (e) {
      debugPrint('Failed to save FCM token: $e');
    }
  }

  /// 更新用户FCM令牌
  Future<void> updateUserFCMToken(String userId) async {
    try {
      String? token = await _messaging.getToken();
      if (token != null) {
        await _firestore.collection('users').doc(userId).update({
          'fcmToken': token,
        });
        debugPrint('FCM token updated for user: $userId');
      }
    } catch (e) {
      debugPrint('Failed to update FCM token: $e');
    }
  }

  /// 设置消息处理器
  void _setupMessageHandlers() {
    // 前台消息处理
    FirebaseMessaging.onMessage.listen(_handleForegroundMessage);
    
    // 后台消息点击处理
    FirebaseMessaging.onMessageOpenedApp.listen(_handleBackgroundMessageClick);
    
    // 应用终止状态下的消息处理
    _handleTerminatedMessage();
  }

  /// 处理前台消息
  void _handleForegroundMessage(RemoteMessage message) {
    debugPrint('Received foreground message: ${message.messageId}');
    
    if (message.notification != null) {
      _showLocalNotification(message);
    }
    
    // 处理数据载荷
    if (message.data.isNotEmpty) {
      _handleMessageData(message.data);
    }
  }

  /// 处理后台消息点击
  void _handleBackgroundMessageClick(RemoteMessage message) {
    debugPrint('Background message clicked: ${message.messageId}');
    _handleMessageData(message.data);
  }

  /// 处理应用终止状态下的消息
  void _handleTerminatedMessage() {
    FirebaseMessaging.instance.getInitialMessage().then((RemoteMessage? message) {
      if (message != null) {
        debugPrint('App opened from terminated state: ${message.messageId}');
        _handleMessageData(message.data);
      }
    });
  }

  /// 显示本地通知（前台时）
  void _showLocalNotification(RemoteMessage message) {
    debugPrint('Local notification: ${message.notification?.title}');
    debugPrint('Local notification body: ${message.notification?.body}');
  }

  /// 处理消息数据载荷
  void _handleMessageData(Map<String, dynamic> data) {
    final type = data['type'];
    
    switch (type) {
      case 'friend_request':
        _handleFriendRequestNotification(data);
        break;
      case 'new_message':
        _handleNewMessageNotification(data);
        break;
      case 'anti_addiction':
        _handleAntiAddictionNotification(data);
        break;
      default:
        debugPrint('Unknown notification type: $type');
    }
  }

  /// 处理好友请求通知
  void _handleFriendRequestNotification(Map<String, dynamic> data) {
    debugPrint('Navigate to friend requests screen');
  }

  /// 处理新消息通知
  void _handleNewMessageNotification(Map<String, dynamic> data) {
    final chatRoomId = data['chatRoomId'];
    final senderId = data['senderId'];
    debugPrint('Navigate to chat: $chatRoomId from $senderId');
  }

  /// 处理防沉迷通知
  void _handleAntiAddictionNotification(Map<String, dynamic> data) {
    final action = data['action'];
    
    switch (action) {
      case 'usage_warning':
        debugPrint('Show usage warning dialog');
        break;
      case 'rest_reminder':
        debugPrint('Show rest reminder dialog');
        break;
      case 'daily_limit':
        debugPrint('Show daily limit dialog');
        break;
    }
  }

  /// 初始化防沉迷功能
  void _initializeAntiAddiction() {
    _sessionStartTime = DateTime.now();
    debugPrint('Anti-addiction system initialized');
  }

  /// 开始新的使用会话
  void startSession() {
    _sessionStartTime = DateTime.now();
    debugPrint('Usage session started');
  }

  /// 结束使用会话
  Future<void> endSession() async {
    if (_sessionStartTime != null) {
      final sessionDuration = DateTime.now().difference(_sessionStartTime!);
      await recordUsageTime(sessionDuration);
      _sessionStartTime = null;
      debugPrint('Usage session ended: ${sessionDuration.inMinutes} minutes');
    }
  }

  /// 记录使用时间
  Future<void> recordUsageTime(Duration duration) async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) return;

      final today = DateTime.now();
      final startOfDay = DateTime(today.year, today.month, today.day);
      
      await _firestore
          .collection('users')
          .doc(user.uid)
          .collection('daily_usage')
          .doc('${startOfDay.year}-${startOfDay.month.toString().padLeft(2, '0')}-${startOfDay.day.toString().padLeft(2, '0')}')
          .set({
        'date': Timestamp.fromDate(startOfDay),
        'totalMinutes': FieldValue.increment(duration.inMinutes),
        'lastUpdated': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    } catch (e) {
      debugPrint('Failed to record usage time: $e');
    }
  }

  /// 发送使用时间警告通知
  Future<void> sendUsageWarningNotification(String message) async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) return;

      final userModel = await _userService.getUserById(user.uid);
      if (userModel?.fcmToken == null) return;

      final callable = _functions.httpsCallable('sendAntiAddictionNotification');
      final result = await callable.call({
        'userToken': userModel!.fcmToken!,
        'notificationType': 'usage_warning',
        'customMessage': message,
      });
      
      debugPrint('使用时间警告通知发送成功: ${result.data}');
    } catch (e) {
      debugPrint('发送使用时间警告通知失败: $e');
    }
  }

  /// 发送好友请求通知
  Future<void> sendFriendRequestNotification({
    required String receiverFCMToken,
    required String senderName,
    required String senderId,
  }) async {
    try {
      final callable = _functions.httpsCallable('sendFriendRequestNotification');
      final result = await callable.call({
        'receiverToken': receiverFCMToken,
        'senderName': senderName,
        'senderId': senderId,
      });
      
      debugPrint('好友请求通知发送成功: ${result.data}');
    } catch (e) {
      debugPrint('发送好友请求通知失败: $e');
    }
  }

  /// 发送新消息通知
  Future<void> sendNewMessageNotification({
    required String receiverFCMToken,
    required String senderName,
    required String messagePreview,
    required String chatRoomId,
    required String senderId,
  }) async {
    try {
      final callable = _functions.httpsCallable('sendNewMessageNotification');
      final result = await callable.call({
        'receiverToken': receiverFCMToken,
        'senderName': senderName,
        'messagePreview': messagePreview,
        'chatRoomId': chatRoomId,
        'senderId': senderId,
      });
      
      debugPrint('新消息通知发送成功: ${result.data}');
    } catch (e) {
      debugPrint('发送新消息通知失败: $e');
    }
  }

  /// 清理资源
  void dispose() {
    _sessionStartTime = null;
    _lastUsageWarning = null;
    _isInitialized = false;
  }
}
