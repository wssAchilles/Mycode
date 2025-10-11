// 路由配置
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ml_platform/screens/home_screen.dart';
import 'package:ml_platform/screens/sorting_screen.dart';
import 'package:ml_platform/screens/auth/login_screen.dart';
import 'package:ml_platform/screens/auth/register_screen.dart';
import 'package:ml_platform/screens/data_structure_screen.dart';
import 'package:ml_platform/screens/profile_screen.dart';
import 'package:ml_platform/screens/splash_screen.dart';
import 'package:ml_platform/screens/algorithm_comparison_screen.dart';
import 'package:ml_platform/screens/tree_visualization_screen.dart';
import 'package:ml_platform/screens/graph_visualization_screen.dart';
import 'package:ml_platform/screens/os/os_main_screen.dart';
import 'package:ml_platform/screens/os/process_scheduling_screen.dart';
import 'package:ml_platform/screens/os/memory_management_screen.dart';
import 'package:ml_platform/screens/os/deadlock_simulation_screen.dart';
import 'package:ml_platform/services/firebase_service.dart';

class AppRouter {
  static final FirebaseService _firebaseService = FirebaseService();
  
  static final GoRouter router = GoRouter(
    initialLocation: '/splash',
    debugLogDiagnostics: true,
    
    // 全局重定向逻辑
    redirect: (BuildContext context, GoRouterState state) {
      // 如果Firebase未初始化，跳转到启动页
      if (!_firebaseService.isInitialized) {
        return state.matchedLocation == '/splash' ? null : '/splash';
      }
      
      final isAuthenticated = _firebaseService.currentUser != null;
      final isAuthRoute = state.matchedLocation == '/login' || 
                         state.matchedLocation == '/register';
      final isSplashRoute = state.matchedLocation == '/splash';
      
      // 如果Firebase已初始化但还在启动页，根据登录状态重定向
      if (isSplashRoute) {
        return isAuthenticated ? '/home' : '/login';
      }
      
      // 如果未登录且不在认证页面，跳转到登录页
      if (!isAuthenticated && !isAuthRoute) {
        return '/login';
      }
      
      // 如果已登录且在认证页面，跳转到首页
      if (isAuthenticated && isAuthRoute) {
        return '/home';
      }
      
      return null;
    },
    
    routes: [
      // 启动页
      GoRoute(
        path: '/splash',
        name: 'splash',
        builder: (context, state) => const SplashScreen(),
      ),
      
      // 认证相关路由
      GoRoute(
        path: '/login',
        name: 'login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/register',
        name: 'register',
        builder: (context, state) => const RegisterScreen(),
      ),
      
      // 主页
      GoRoute(
        path: '/home',
        name: 'home',
        builder: (context, state) => const HomeScreen(),
        routes: [
          // 个人资料页
          GoRoute(
            path: 'profile',
            name: 'profile',
            builder: (context, state) => const ProfileScreen(),
          ),
        ],
      ),
      
      // 排序算法页面
      GoRoute(
        path: '/sorting',
        name: 'sorting',
        builder: (context, state) => const SortingScreen(),
        routes: [
          // 具体算法页面
          GoRoute(
            path: ':algorithmType',
            name: 'sorting-algorithm',
            builder: (context, state) {
              final algorithmType = state.pathParameters['algorithmType'] ?? '';
              return SortingScreen(algorithmType: algorithmType);
            },
          ),
          // 算法对比页面
          GoRoute(
            path: 'comparison',
            name: 'algorithm-comparison',
            builder: (context, state) => const AlgorithmComparisonScreen(),
          ),
        ],
      ),
      
      // 操作系统模拟器
      GoRoute(
        path: '/os',
        name: 'os',
        builder: (context, state) => const OSMainScreen(),
        routes: [
          GoRoute(
            path: 'scheduling',
            name: 'process-scheduling',
            builder: (context, state) => const ProcessSchedulingScreen(),
          ),
          GoRoute(
            path: 'memory',
            name: 'memory-management',
            builder: (context, state) => const MemoryManagementScreen(),
          ),
          GoRoute(
            path: 'banker',
            name: 'banker-algorithm',
            builder: (context, state) => const DeadlockSimulationScreen(),
          ),
        ],
      ),
      
      // 数据结构页面
      GoRoute(
        path: '/data-structures',
        name: 'dataStructures',
        builder: (context, state) => const DataStructureScreen(),
        routes: [
          // 具体数据结构页面
          GoRoute(
            path: ':structureType',
            name: 'data-structure',
            builder: (context, state) {
              final structureType = state.pathParameters['structureType'] ?? '';
              return DataStructureScreen(structureType: structureType);
            },
          ),
          // 树形结构可视化页面
          GoRoute(
            path: 'tree/:treeType',
            name: 'tree-visualization',
            builder: (context, state) {
              final treeType = state.pathParameters['treeType'] ?? 'bst';
              return TreeVisualizationScreen(treeType: treeType);
            },
          ),
          // 图算法可视化页面
          GoRoute(
            path: 'graph',
            name: 'graph-visualization',
            builder: (context, state) => const GraphVisualizationScreen(),
          ),
        ],
      ),
    ],
    
    // 错误页面
    errorBuilder: (context, state) => _ErrorPage(error: state.error),
  );
}

// 错误页面
class _ErrorPage extends StatelessWidget {
  final Exception? error;
  
  const _ErrorPage({Key? key, this.error}) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('页面错误')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(
              Icons.error_outline,
              size: 64,
              color: Colors.red,
            ),
            const SizedBox(height: 16),
            Text(
              '页面加载失败',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Text(
              error?.toString() ?? '未知错误',
              style: Theme.of(context).textTheme.bodyMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () => context.go('/home'),
              child: const Text('返回首页'),
            ),
          ],
        ),
      ),
    );
  }
}
