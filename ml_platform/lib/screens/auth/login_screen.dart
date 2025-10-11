// 登录页面
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ml_platform/services/firebase_service.dart';
import 'package:ml_platform/widgets/common/custom_button.dart';
import 'package:ml_platform/widgets/common/loading_indicator.dart';

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

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
    });

    try {
      await FirebaseService().loginWithEmail(
        email: _emailController.text.trim(),
        password: _passwordController.text,
      );

      if (!mounted) return;
      
      // 登录成功，跳转到主页
      context.go('/home');
    } catch (e) {
      if (!mounted) return;
      
      // 显示错误消息
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_getErrorMessage(e.toString())),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  String _getErrorMessage(String error) {
    if (error.contains('user-not-found')) {
      return '用户不存在';
    } else if (error.contains('wrong-password')) {
      return '密码错误';
    } else if (error.contains('invalid-email')) {
      return '邮箱格式不正确';
    } else if (error.contains('user-disabled')) {
      return '用户已被禁用';
    } else {
      return '登录失败，请稍后重试';
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: LoadingOverlay(
        isLoading: _isLoading,
        message: '正在登录...',
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24.0),
            child: Container(
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
                    '欢迎回来',
                    style: theme.textTheme.headlineMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '登录以继续学习',
                    style: theme.textTheme.bodyLarge?.copyWith(
                      color: Colors.grey[600],
                    ),
                  ),
                  const SizedBox(height: 32),
                  
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
                          validator: (value) {
                            if (value == null || value.isEmpty) {
                              return '请输入邮箱';
                            }
                            if (!value.contains('@')) {
                              return '请输入有效的邮箱地址';
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: 16),
                        
                        // 密码输入框
                        TextFormField(
                          controller: _passwordController,
                          obscureText: _obscurePassword,
                          decoration: InputDecoration(
                            labelText: '密码',
                            hintText: '请输入您的密码',
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
                              return '密码长度至少为6位';
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
                              // TODO: 实现忘记密码功能
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('忘记密码功能即将推出'),
                                ),
                              );
                            },
                            child: const Text('忘记密码？'),
                          ),
                        ),
                        const SizedBox(height: 24),
                        
                        // 登录按钮
                        CustomButton(
                          text: '登录',
                          width: double.infinity,
                          onPressed: _handleLogin,
                          icon: Icons.login,
                        ),
                        const SizedBox(height: 16),
                        
                        // 分隔线
                        Row(
                          children: [
                            const Expanded(child: Divider()),
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 16),
                              child: Text(
                                '或',
                                style: TextStyle(color: Colors.grey[600]),
                              ),
                            ),
                            const Expanded(child: Divider()),
                          ],
                        ),
                        const SizedBox(height: 16),
                        
                        // 注册链接
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              '还没有账号？',
                              style: TextStyle(color: Colors.grey[600]),
                            ),
                            TextButton(
                              onPressed: () {
                                context.go('/register');
                              },
                              child: const Text('立即注册'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
