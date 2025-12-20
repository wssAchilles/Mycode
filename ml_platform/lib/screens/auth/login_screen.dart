// 登录页面
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ml_platform/services/firebase_service.dart';
import 'package:ml_platform/utils/validators.dart';
import 'package:ml_platform/utils/error_handler.dart';
import 'package:ml_platform/widgets/common/custom_button.dart';
import 'package:ml_platform/widgets/common/loading_indicator.dart';
import 'package:ml_platform/utils/responsive_layout.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({Key? key}) : super(key: key);

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isLoading = false;
  bool _obscurePassword = true;
  String _loadingMessage = '正在登录...';

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  /// 自动登录或注册
  /// 如果账号存在则登录，不存在则自动注册
  Future<void> _handleSignInOrRegister() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
      _loadingMessage = '正在验证...';
    });

    try {
      final (credential, isNewUser) = await FirebaseService().signInOrRegister(
        email: _emailController.text.trim(),
        password: _passwordController.text,
      );

      if (!mounted) return;
      
      if (credential != null) {
        if (isNewUser) {
          // 新用户注册成功
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('账号创建成功，欢迎加入！'),
              backgroundColor: Colors.green,
            ),
          );
        }
        // 跳转到主页
        context.go('/home');
      }
    } catch (e) {
      if (!mounted) return;
      ErrorHandler.handleError(context, e, prefix: '登录失败');
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  /// Google 登录
  Future<void> _handleGoogleSignIn() async {
    setState(() {
      _isLoading = true;
      _loadingMessage = '正在连接 Google...';
    });

    try {
      final credential = await FirebaseService().signInWithGoogle();

      if (!mounted) return;
      
      if (credential != null) {
        // 登录成功，跳转到主页
        context.go('/home');
      }
    } catch (e) {
      if (!mounted) return;
      ErrorHandler.handleError(context, e, prefix: 'Google 登录失败');
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    // 登录表单内容
    Widget _buildLoginForm() {
      return Container(
        constraints: const BoxConstraints(maxWidth: 400),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Logo
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                color: theme.primaryColor,
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Icon(
                Icons.analytics_outlined,
                size: 48,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 24),
            
            // 标题
            Text(
              '欢迎使用',
              style: theme.textTheme.headlineMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '登录或使用邮箱快速注册',
              style: theme.textTheme.bodyLarge?.copyWith(
                color: Colors.grey[600],
              ),
            ),
            const SizedBox(height: 32),
            
            // Google 登录按钮
            _buildGoogleSignInButton(),
            const SizedBox(height: 24),
            
            // 分隔线
            Row(
              children: [
                const Expanded(child: Divider()),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Text(
                    '或使用邮箱',
                    style: TextStyle(color: Colors.grey[600]),
                  ),
                ),
                const Expanded(child: Divider()),
              ],
            ),
            const SizedBox(height: 24),
            
            // 登录表单
            Form(
              key: _formKey,
              child: Column(
                children: [
                  // 邮箱输入框
                  TextFormField(
                    controller: _emailController,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(
                      labelText: '邮箱',
                      hintText: '请输入您的邮箱',
                      prefixIcon: Icon(Icons.email_outlined),
                    ),
                    validator: Validators.validateEmail,
                  ),
                  const SizedBox(height: 16),
                  
                  // 密码输入框
                  TextFormField(
                    controller: _passwordController,
                    obscureText: _obscurePassword,
                    decoration: InputDecoration(
                      labelText: '密码',
                      hintText: '请输入您的密码 (至少6位)',
                      prefixIcon: const Icon(Icons.lock_outline),
                      suffixIcon: IconButton(
                        icon: Icon(
                          _obscurePassword
                              ? Icons.visibility_off
                              : Icons.visibility,
                        ),
                        onPressed: () {
                          setState(() {
                            _obscurePassword = !_obscurePassword;
                          });
                        },
                      ),
                    ),
                    validator: (value) {
                      if (value == null || value.isEmpty) {
                        return '请输入密码';
                      }
                      if (value.length < 6) {
                        return '密码至少需要6位';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 8),
                  
                  // 忘记密码
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: () {
                        _showForgotPasswordDialog();
                      },
                      child: const Text('忘记密码？'),
                    ),
                  ),
                  const SizedBox(height: 24),
                  
                  // 登录/注册按钮 (合并)
                  CustomButton(
                    text: '登录 / 注册',
                    width: double.infinity,
                    onPressed: _handleSignInOrRegister,
                    icon: Icons.login,
                  ),
                  const SizedBox(height: 12),
                  
                  // 说明文字
                  Text(
                    '账号存在则直接登录，不存在则自动注册',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: Colors.grey[500],
                      ),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    return Scaffold(
      body: LoadingOverlay(
        isLoading: _isLoading,
        message: _loadingMessage,
        child: ResponsiveLayout(
          // 移动端：居中但占据更多空间，或者不使用 Center
          mobile: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24.0),
              child: _buildLoginForm(),
            ),
          ),
          // 桌面端：可以在左侧加个大图，右侧放表单，或者保持居中
          desktop: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24.0),
              child: Card( // 桌面端给个卡片背景
                elevation: 4,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                child: Padding(
                  padding: const EdgeInsets.all(48.0),
                  child: _buildLoginForm(),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
  
  /// 构建 Google 登录按钮
  Widget _buildGoogleSignInButton() {
    return SizedBox(
      width: double.infinity,
      height: 50,
      child: OutlinedButton.icon(
        onPressed: _handleGoogleSignIn,
        icon: Image.network(
          'https://www.google.com/favicon.ico',
          width: 24,
          height: 24,
          errorBuilder: (context, error, stackTrace) {
            return const Icon(Icons.g_mobiledata, size: 24);
          },
        ),
        label: const Text(
          '使用 Google 账号登录',
          style: TextStyle(fontSize: 16),
        ),
        style: OutlinedButton.styleFrom(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          side: BorderSide(color: Colors.grey[300]!),
        ),
      ),
    );
  }
  
  /// 显示忘记密码对话框
  void _showForgotPasswordDialog() {
    final emailController = TextEditingController();
    
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('重置密码'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('请输入您的注册邮箱，我们将发送重置密码链接。'),
            const SizedBox(height: 16),
            TextField(
              controller: emailController,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                labelText: '邮箱',
                hintText: '请输入您的邮箱',
                prefixIcon: Icon(Icons.email_outlined),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          ElevatedButton(
            onPressed: () async {
              final email = emailController.text.trim();
              if (email.isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('请输入邮箱')),
                );
                return;
              }
              
              try {
                await FirebaseService().resetPassword(email);
                if (!mounted) return;
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('重置密码邮件已发送，请查收'),
                    backgroundColor: Colors.green,
                  ),
                );
              } catch (e) {
                if (!mounted) return;
                ErrorHandler.handleError(context, e, prefix: '发送失败');
              }
            },
            child: const Text('发送'),
          ),
        ],
      ),
    );
  }
}
