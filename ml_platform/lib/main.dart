// 应用入口文件
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/config/app_router.dart';
import 'package:ml_platform/models/visualization_state.dart';
import 'package:ml_platform/services/firebase_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // 在应用启动前初始化Firebase
  try {
    await FirebaseService().initialize();
  } catch (e) {
    debugPrint('Firebase初始化失败: $e');
  }
  
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        // 提供可视化状态管理
        ChangeNotifierProvider(
          create: (context) => VisualizationState(),
        ),
      ],
      child: MaterialApp.router(
        title: '算法可视化学习平台',
        debugShowCheckedModeBanner: false,
        
        // 应用主题
        theme: AppTheme.lightTheme,
        darkTheme: AppTheme.darkTheme,
        themeMode: ThemeMode.system,
        
        // 路由配置
        routerConfig: AppRouter.router,
      ),
    );
  }
}
