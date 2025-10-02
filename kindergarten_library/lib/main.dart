import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'screens/auth_gate.dart';

/// 应用入口 - 初始化Supabase并启动应用
void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 初始化Supabase，PKCE流程已默认启用支持深度链接
  await Supabase.initialize(
    url: 'https://fltccqznbyypmlhyiooz.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsdGNjcXpuYnl5cG1saHlpb296Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY4ODU4NTYsImV4cCI6MjA3MjQ2MTg1Nn0.3cqDN_hydADjQNnx-ktxe6IdF5o6NGFBshL70DnoB1w',
  );

  runApp(const MyApp());
}

/// Supabase全局客户端 - 方便在App各处调用
final supabase = Supabase.instance.client;

/// 应用主体
class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '幼儿园图书管理',
      theme: ThemeData(
        primarySwatch: Colors.green,
        // 设置全局字体
        fontFamily: 'Microsoft YaHei',
        // 优化Material 3主题
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.green),
        // 设置卡片主题
        cardTheme: CardThemeData(
          elevation: 2,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
        // 设置输入框主题
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      debugShowCheckedModeBanner: false, // 隐藏调试标签
      // 使用AuthGate作为应用入口，自动管理认证状态
      home: const AuthGate(),
    );
  }
}