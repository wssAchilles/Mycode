import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../services/auth_service.dart';
import 'login_screen.dart';
import 'home_screen.dart';

/// 认证状态守卫
/// 作为应用的入口点，使用StreamBuilder监听Firebase认证状态变化
/// 根据用户是否已登录来决定显示HomeScreen还是LoginScreen
class AuthGate extends StatelessWidget {
  const AuthGate({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final authService = AuthService();

    return StreamBuilder<User?>(
      stream: authService.authStateChanges,
      builder: (context, snapshot) {
        // 显示加载状态
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            body: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 16),
                  Text(
                    '正在加载...',
                    style: TextStyle(
                      fontSize: 16,
                      color: Colors.grey,
                    ),
                  ),
                ],
              ),
            ),
          );
        }

        // 检查认证状态
        if (snapshot.hasData && snapshot.data != null) {
          // 用户已登录，显示主页
          return const HomeScreen();
        } else {
          // 用户未登录，显示登录页面
          return const LoginScreen();
        }
      },
    );
  }
}

/// 认证状态监听器Widget
/// 提供额外的认证状态监听功能，可用于特定页面的认证保护
class AuthStateListener extends StatefulWidget {
  final Widget child;
  final VoidCallback? onSignOut;

  const AuthStateListener({
    Key? key,
    required this.child,
    this.onSignOut,
  }) : super(key: key);

  @override
  State<AuthStateListener> createState() => _AuthStateListenerState();
}

class _AuthStateListenerState extends State<AuthStateListener> {
  final AuthService _authService = AuthService();

  @override
  void initState() {
    super.initState();
    _listenToAuthChanges();
  }

  void _listenToAuthChanges() {
    _authService.authStateChanges.listen((User? user) {
      if (user == null && widget.onSignOut != null) {
        // 用户登出时的回调
        widget.onSignOut!();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return widget.child;
  }
}

/// 需要认证的页面包装器
/// 确保只有已登录用户才能访问特定页面
class AuthRequiredWidget extends StatelessWidget {
  final Widget child;
  final Widget? fallback;

  const AuthRequiredWidget({
    Key? key,
    required this.child,
    this.fallback,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final authService = AuthService();

    return StreamBuilder<User?>(
      stream: authService.authStateChanges,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(
            child: CircularProgressIndicator(),
          );
        }

        if (snapshot.hasData && snapshot.data != null) {
          return child;
        } else {
          return fallback ?? const LoginScreen();
        }
      },
    );
  }
}

/// 认证状态提供者
/// 为子Widget提供当前用户信息
class AuthProvider extends InheritedWidget {
  final User? user;
  final AuthService authService;

  const AuthProvider({
    Key? key,
    required this.user,
    required this.authService,
    required Widget child,
  }) : super(key: key, child: child);

  static AuthProvider? of(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<AuthProvider>();
  }

  @override
  bool updateShouldNotify(AuthProvider oldWidget) {
    return user?.uid != oldWidget.user?.uid;
  }
}

/// 获取当前认证状态的便捷方法
class AuthUtils {
  static User? getCurrentUser(BuildContext context) {
    final authProvider = AuthProvider.of(context);
    return authProvider?.user;
  }

  static bool isLoggedIn(BuildContext context) {
    return getCurrentUser(context) != null;
  }

  static String? getCurrentUserId(BuildContext context) {
    return getCurrentUser(context)?.uid;
  }

  static String? getCurrentUserEmail(BuildContext context) {
    return getCurrentUser(context)?.email;
  }

  static String? getCurrentUserDisplayName(BuildContext context) {
    final user = getCurrentUser(context);
    return user?.displayName ?? user?.email?.split('@').first;
  }
}
