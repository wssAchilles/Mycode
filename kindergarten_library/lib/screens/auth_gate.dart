import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../main.dart';
import '../services/auth_service.dart';
import 'login_screen.dart';
import 'main_navigation.dart';

/// 认证网关 - App的"前门"
/// 自动检查用户登录状态，并引导到正确的页面
/// 支持深度链接认证回调处理
class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> with WidgetsBindingObserver {
  final AuthService _authService = AuthService();
  
  @override
  void initState() {
    super.initState();
    // 添加生命周期监听器，处理应用重新获取焦点时的情况
    WidgetsBinding.instance.addObserver(this);
    // 初始化时检查是否有待处理的深度链接
    _handleInitialLink();
    // 初始化用户状态
    _initializeAuthState();
  }
  
  /// 初始化认证状态
  Future<void> _initializeAuthState() async {
    try {
      await _authService.initializeUserState();
    } catch (e) {
      print('初始化用户状态失败: $e');
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// 处理初始深度链接（应用被唤醒时）
  void _handleInitialLink() {
    // Supabase会自动处理深度链接并更新认证状态
    // onAuthStateChange流会自动响应状态变化
    // 这里我们只需要确保UI能够响应状态变化
  }

  /// 当应用重新获取焦点时调用
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      // 应用重新获取焦点时，可能是从邮件链接返回
      // Supabase会自动检测并更新认证状态
      // 这会触发onAuthStateChange流的更新
    }
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<AuthState>(
      // 监听认证状态变化，支持深度链接自动登录
      stream: supabase.auth.onAuthStateChange,
      builder: (context, snapshot) {
        // 如果还在加载中，显示加载界面
        if (snapshot.connectionState == ConnectionState.waiting) {
          return Scaffold(
            backgroundColor: Colors.green[50],
            body: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  CircularProgressIndicator(
                    valueColor: AlwaysStoppedAnimation<Color>(Colors.green),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    '正在初始化...',
                    style: TextStyle(
                      color: Colors.green[700],
                      fontSize: 16,
                    ),
                  ),
                ],
              ),
            ),
          );
        }
        
        // 获取当前session和认证状态
        final session = supabase.auth.currentSession;
        final authState = snapshot.data;
        
        // 处理认证状态变化
        if (authState?.event == AuthChangeEvent.signedIn && session != null) {
          // 用户登录成功，初始化用户状态
          WidgetsBinding.instance.addPostFrameCallback((_) async {
            await _authService.onUserLoggedIn();
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('欢迎使用，${_authService.displayName}！'),
                  backgroundColor: Colors.green,
                  duration: const Duration(seconds: 2),
                ),
              );
            }
          });
        } else if (authState?.event == AuthChangeEvent.signedOut) {
          // 用户登出，清理用户状态
          _authService.onUserLoggedOut();
        }
        
        // 根据登录状态导航到不同页面
        if (session != null) {
          // 已登录 - 进入主导航页面
          return const MainNavigationScreen();
        } else {
          // 未登录 - 进入登录页
          return const LoginScreen();
        }
      },
    );
  }
}
