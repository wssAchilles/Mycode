import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:vibration/vibration.dart';
import '../models/notification_settings.dart';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'auth_service.dart';
import '../models/group_model.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

/// 通知服务
/// 
/// 负责处理本地推送通知，包括消息通知和系统通知
class NotificationService {
  // 本地通知插件
  final FlutterLocalNotificationsPlugin _notifications = FlutterLocalNotificationsPlugin();
  
  // 认证服务
  final AuthService _authService;
  
  // 通知ID映射（防止重复）
  final Map<String, int> _notificationIds = {};
  
  /// 构造函数
  NotificationService(this._authService) {
    _initNotifications();
  }
  
  /// 初始化通知
  Future<void> _initNotifications() async {
    // 安卓设置
    const AndroidInitializationSettings androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    
    // iOS设置
    const DarwinInitializationSettings iOSSettings = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );
    
    // 初始化设置
    const InitializationSettings initSettings = InitializationSettings(
      android: androidSettings,
      iOS: iOSSettings,
    );
    
    // 初始化通知插件
    await _notifications.initialize(
      initSettings,
      onDidReceiveNotificationResponse: _onNotificationTap,
    );
    
    // 请求通知权限
    _requestPermissions();
  }
  
  /// 请求通知权限
  Future<void> _requestPermissions() async {
    // 只有在非Web平台才请求原生通知权限
    if (!kIsWeb) {
      // Android / iOS 权限请求
      if (Platform.isAndroid || Platform.isIOS) {
        if (Platform.isIOS) {
          await _notifications
              .resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>()
              ?.requestPermissions(
                alert: true,
                badge: true,
                sound: true,
              );
        } else if (Platform.isAndroid) {
          await _notifications
              .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
              ?.requestNotificationsPermission();
        }
      }
    } else {
      // Web 平台下的处理，这里可以打印一条信息或执行Web相关的通知初始化
      print('NotificationService: 在Web平台跳过原生通知权限请求');
    }
  }
  
  /// 处理通知点击事件
  void _onNotificationTap(NotificationResponse response) {
    // 获取通知负载
    final payload = response.payload;
    if (payload == null) return;
    
    // 解析负载数据并处理导航
    // 例如: {type: message, senderId: 12345}
    // 这里可以通过全局导航器导航到相应的页面
    print('通知被点击，负载: $payload');
    
    // 在真实应用中，可以通过全局导航器导航到聊天详情页
    // 例如: 
    // final data = jsonDecode(payload);
    // if (data['type'] == 'message') {
    //   navigatorKey.currentState?.pushNamed(
    //     '/chat_detail',
    //     arguments: {'otherUserId': data['senderId']},
    //   );
    // }
  }
  
  

  /// 默认通知设置
  static final NotificationSettings defaultSettings = NotificationSettings();

  /// 显示消息通知
  Future<void> showMessageNotification({
    required String senderId,
    required String messagePreview,
    bool isInForeground = false,
    NotificationSettings? settings,
  }) async {
    // Use provided settings or default if null
    settings = settings ?? defaultSettings;
    try {
      // 如果应用在前台且设置为不在前台显示通知
      if (isInForeground && !settings.showInForeground) {
        // 如果启用了震动，则只震动而不显示通知
        if (settings.vibrationEnabled) {
          _triggerVibration();
        }
        return;
      }
      
      // 获取发送者信息
      final sender = await _authService.getUserInfo(senderId);
      if (sender == null) return;
      
      // 通知标题
      final title = sender.username;
      
      // 通知内容
      final body = messagePreview;
      
      // 读取之前来自该发送者的通知，实现通知分组
      final existingNotificationId = _getNotificationIdForSender(senderId);
      
      // 安卓通知详情
      final AndroidNotificationDetails androidDetails = AndroidNotificationDetails(
        'messages_channel',
        '消息通知',
        channelDescription: '接收新消息的通知',
        importance: Importance.high,
        priority: Priority.high,
        showWhen: true,
        enableVibration: settings.vibrationEnabled,
        playSound: settings.soundEnabled,
        sound: settings.soundEnabled ? const RawResourceAndroidNotificationSound('message_sound') : null,
        groupKey: 'chat_$senderId', // 按发送者分组
        setAsGroupSummary: false,
        styleInformation: BigTextStyleInformation(body),
      );
      
      // iOS通知详情
      final DarwinNotificationDetails iOSDetails = DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: settings.soundEnabled,
        sound: settings.soundEnabled ? 'message_sound.aiff' : null,
        threadIdentifier: 'chat_$senderId', // iOS 上的通知分组
      );
      
      // 合并通知详情
      final NotificationDetails notificationDetails = NotificationDetails(
        android: androidDetails,
        iOS: iOSDetails,
      );
      
      // 使用发送者的通知ID或生成新ID
      final notificationId = existingNotificationId ?? _getUniqueId();
      _notificationIds[senderId] = notificationId;
      
      // 显示通知
      await _notifications.show(
        notificationId,
        title,
        body,
        notificationDetails,
        payload: jsonEncode({
          "type": "message",
          "senderId": senderId,
        }),
      );
      
      // 如果启用了震动，则触发震动
      if (settings.vibrationEnabled) {
        _triggerVibration();
      }
      
      // 如果这个发送者的消息超过2条，显示汇总通知
      if (_countNotificationsFromSender(senderId) >= 2) {
        _showNotificationSummary(senderId, sender.username);
      }
    } catch (e) {
      print('显示消息通知失败: $e');
    }
  }

  /// 触发震动效果
  void _triggerVibration() async {
    if (await Vibration.hasVibrator() ?? false) {
      // 自定义震动模式（短-停-短）
      Vibration.vibrate(pattern: [0, 100, 100, 100]);
    }
  }

  /// 统计来自特定发送者的通知数量
  int _countNotificationsFromSender(String senderId) {
    // 实际应用中可以从本地存储读取数量
    // 这里简化处理
    return 2; // 假设有2条通知
  }

  /// 显示通知汇总
  void _showNotificationSummary(String senderId, String senderName) async {
    try {
      // 安卓通知汇总
      final AndroidNotificationDetails androidDetails = AndroidNotificationDetails(
        'messages_summary_channel',
        '消息通知汇总',
        channelDescription: '多条消息的汇总通知',
        importance: Importance.high,
        priority: Priority.high,
        groupKey: 'chat_$senderId',
        setAsGroupSummary: true,
      );
      
      // iOS 不需要特殊的汇总通知，系统自动处理
      const DarwinNotificationDetails iOSDetails = DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: false,
      );
      
      final NotificationDetails notificationDetails = NotificationDetails(
        android: androidDetails,
        iOS: iOSDetails,
      );
      
      // 计算未读消息数量
      final unreadCount = _countNotificationsFromSender(senderId);
      
      // 显示汇总通知
      await _notifications.show(
        _getUniqueId() + 10000, // 使用大于10000的ID避免与普通通知冲突
        '来自 $senderName 的新消息',
        '您有 $unreadCount 条未读消息',
        notificationDetails,
        payload: jsonEncode({
          "type": "message_summary",
          "senderId": senderId,
          "count": unreadCount,
        }),
      );
    } catch (e) {
      print('显示汇总通知失败: $e');
    }
  }

  /// 显示系统通知
  Future<void> showSystemNotification({
    required String title,
    required String body,
    String? payload,
  }) async {
    try {
      // 安卓通知详情
      const AndroidNotificationDetails androidDetails = AndroidNotificationDetails(
        'system_channel',
        '系统通知',
        channelDescription: '系统相关的通知',
        importance: Importance.defaultImportance,
        priority: Priority.defaultPriority,
      );
      
      // iOS通知详情
      const DarwinNotificationDetails iOSDetails = DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: true,
      );
      
      // 通知详情
      const NotificationDetails details = NotificationDetails(
        android: androidDetails,
        iOS: iOSDetails,
      );
      
      // 随机通知ID
      final notificationId = Random().nextInt(100000);
      
      // 显示通知
      await _notifications.show(
        notificationId,
        title,
        body,
        details,
        payload: payload,
      );
      
    } catch (e) {
      print('显示系统通知错误: $e');
    }
  }

  /// 取消所有通知
  Future<void> cancelAllNotifications() async {
    await _notifications.cancelAll();
    _notificationIds.clear();
  }

  /// 取消特定用户的通知
  Future<void> cancelNotificationsForUser(String userId) async {
    final notificationId = _notificationIds[userId];
    if (notificationId != null) {
      await _notifications.cancel(notificationId);
      _notificationIds.remove(userId);
    }
  }
  
  /// 取消特定群组的通知
  Future<void> cancelNotificationsForGroup(String groupId) async {
    final groupNotificationKey = 'group_$groupId';
    final notificationId = _notificationIds[groupNotificationKey];
    if (notificationId != null) {
      await _notifications.cancel(notificationId);
      _notificationIds.remove(groupNotificationKey);
    }
  }

  /// 获取或生成通知ID
  int _getNotificationId(String userId) {
    // 检查是否已有通知ID
    if (_notificationIds.containsKey(userId)) {
      return _notificationIds[userId]!;
    }
    
    // 生成新的通知ID
    final newId = Random().nextInt(100000);
    _notificationIds[userId] = newId;
    return newId;
  }

  /// 获取唯一通知ID
  int _getUniqueId() {
    return Random().nextInt(100000);
  }

  /// 获取特定发送者的通知ID
  int? _getNotificationIdForSender(String senderId) {
    return _notificationIds[senderId];
  }

  /// 显示群组消息通知
  Future<void> showGroupMessageNotification({
    required String groupId,
    required String groupName,
    required String senderId,
    required String senderName,
    required String messagePreview,
    bool isInForeground = false,
    NotificationSettings? settings,
  }) async {
    // Use provided settings or default if null
    settings = settings ?? defaultSettings;
    try {
      // 如果应用在前台且设置为不在前台显示通知
      if (isInForeground && !settings.showInForeground) {
        // 如果启用了震动，则只震动而不显示通知
        if (settings.vibrationEnabled) {
          _triggerVibration();
        }
        return;
      }
      
      // 对消息内容进行处理，确保不超长
      final truncatedPreview = messagePreview.length > 50 
          ? '${messagePreview.substring(0, 47)}...'
          : messagePreview;
      
      // 安卓通知详情
      final AndroidNotificationDetails androidDetails = AndroidNotificationDetails(
        'group_messages_channel',
        '群聊消息',
        channelDescription: '群聊消息通知',
        importance: Importance.high,
        priority: Priority.high,
        showWhen: true,
        enableVibration: settings.vibrationEnabled,
        playSound: settings.soundEnabled,
      );
      
      // iOS通知详情
      final DarwinNotificationDetails iOSDetails = DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: settings.soundEnabled,
      );
      
      final NotificationDetails notificationDetails = NotificationDetails(
        android: androidDetails,
        iOS: iOSDetails,
      );
      
      // 获取或创建群组通知ID
      final String groupNotificationKey = 'group_$groupId';
      final notificationId = _getNotificationId(groupNotificationKey);
      
      // 显示通知
      await _notifications.show(
        notificationId,
        '$groupName', // 标题显示群名称
        '$senderName: $truncatedPreview', // 内容显示发送者和消息预览
        notificationDetails,
        payload: jsonEncode({
          "type": "group_message",
          "groupId": groupId,
          "groupName": groupName,
          "senderId": senderId,
          "messagePreview": messagePreview,
        }),
      );
      
      // 如果启用了震动
      if (settings.vibrationEnabled) {
        _triggerVibration();
      }
      
    } catch (e) {
      print('显示群组消息通知失败: $e');
    }
  }
  
  /// 显示好友请求通知
  Future<void> showFriendRequestNotification({
    required String senderId,
    required String username,
    String? message,
  }) async {
    try {
      // 安卓通知详情
      final AndroidNotificationDetails androidDetails = AndroidNotificationDetails(
        'friend_requests_channel',
        '好友请求',
        channelDescription: '好友请求通知',
        importance: Importance.high,
        priority: Priority.high,
        showWhen: true,
        enableVibration: true,
        playSound: true,
        sound: const RawResourceAndroidNotificationSound('friend_request_sound'),
      );
      
      // iOS通知详情
      const DarwinNotificationDetails iOSDetails = DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: true,
        sound: 'friend_request_sound.aiff',
        interruptionLevel: InterruptionLevel.active,
      );
      
      final NotificationDetails notificationDetails = NotificationDetails(
        android: androidDetails,
        iOS: iOSDetails,
      );
      
      final notificationId = 200000 + Random().nextInt(10000); // 使用不同范围的ID
      
      // 显示通知
      await _notifications.show(
        notificationId,
        '好友请求',
        '$username 请求添加您为好友${message != null ? ": $message" : ""}',
        notificationDetails,
        payload: jsonEncode({
          "type": "friend_request",
          "senderId": senderId,
        }),
      );
      
      // 触发震动效果
      _triggerVibration();
      
    } catch (e) {
      print('显示好友请求通知失败: $e');
    }
  }
}
