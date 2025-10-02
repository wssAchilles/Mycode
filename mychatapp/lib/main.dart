import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'firebase_options.dart';
import 'screens/auth_gate.dart';
import 'services/notification_service.dart';

void main() async {
  // 确保 Flutter 小部件绑定已初始化
  WidgetsFlutterBinding.ensureInitialized();
  
  // 初始化 Firebase
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  
  // 初始化推送通知服务
  await _initializeNotificationService();
  
  // 运行应用程序
  runApp(const MyApp());
}

/// 初始化推送通知服务
Future<void> _initializeNotificationService() async {
  try {
    final notificationService = NotificationService();
    await notificationService.initialize();
    
    // 监听认证状态变化，用户登录后更新FCM令牌
    FirebaseAuth.instance.authStateChanges().listen((User? user) async {
      if (user != null) {
        await notificationService.updateUserFCMToken(user.uid);
        notificationService.startSession(); // 开始使用会话追踪
      }
    });
  } catch (e) {
    debugPrint('初始化推送通知服务失败: $e');
  }
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MyChatApp',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blue),
        useMaterial3: true,
        appBarTheme: AppBarTheme(
          backgroundColor: Colors.blue,
          foregroundColor: Colors.white,
          elevation: 2,
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.blue,
            foregroundColor: Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        ),
      ),
      home: const AuthGate(),
      debugShowCheckedModeBanner: false,
    );
  }
}