// 注册页面
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ml_platform/services/firebase_service.dart';
import 'package:ml_platform/widgets/common/custom_button.dart';
import 'package:ml_platform/widgets/common/loading_indicator.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({Key? key}) : super(key: key);

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _isLoading = false;
  bool _obscurePassword = true;
  bool _obscureConfirmPassword = true;
  bool _agreeToTerms = false;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _handleRegister() async {
    if (!_formKey.currentState!.validate()) return;
    
    if (!_agreeToTerms) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('请同意用户协议和隐私政策'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    setState(() {
      _isLoading = true;
    });

    try {
      await FirebaseService().registerWithEmail(
        email: _emailController.text.trim(),
        password: _passwordController.text,
        displayName: _nameController.text.trim(),
      );

      if (!mounted) return;
      
      // 注册成功，显示成功消息并跳转到主页
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('注册成功！欢迎加入'),
          backgroundColor: Colors.green,
        ),
      );
      
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
    if (error.contains('email-already-in-use')) {
      return '该邮箱已被注册';
    } else if (error.contains('invalid-email')) {
      return '邮箱格式不正确';
    } else if (error.contains('weak-password')) {
      return '密码强度太弱，请使用更复杂的密码';
    } else {
      return '注册失败，请稍后重试';
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: LoadingOverlay(
        isLoading: _isLoading,
        message: '正在创建账号...',
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
                    '创建账号',
                    style: theme.textTheme.headlineMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '开始您的算法学习之旅',
                    style: theme.textTheme.bodyLarge?.copyWith(
                      color: Colors.grey[600],
                    ),
                  ),
                  const SizedBox(height: 32),
                  
                  // 注册表单
                  Form(
                    key: _formKey,
                    child: Column(
                      children: [
                        // 姓名输入框
                        TextFormField(
                          controller: _nameController,
                          decoration: const InputDecoration(
                            labelText: '姓名',
                            hintText: '请输入您的姓名',
                            prefixIcon: Icon(Icons.person_outline),
                          ),
                          validator: (value) {
                            if (value == null || value.isEmpty) {
                              return '请输入姓名';
                            }
                            if (value.length < 2) {
                              return '姓名至少需要2个字符';
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: 16),
                        
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
                            if (!value.contains('@') || !value.contains('.')) {
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
                            hintText: '至少6位字符',
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
                        const SizedBox(height: 16),
                        
                        // 确认密码输入框
                        TextFormField(
                          controller: _confirmPasswordController,
                          obscureText: _obscureConfirmPassword,
                          decoration: InputDecoration(
                            labelText: '确认密码',
                            hintText: '请再次输入密码',
                            prefixIcon: const Icon(Icons.lock_outline),
                            suffixIcon: IconButton(
                              icon: Icon(
                                _obscureConfirmPassword
                                    ? Icons.visibility_off
                                    : Icons.visibility,
                              ),
                              onPressed: () {
                                setState(() {
                                  _obscureConfirmPassword = !_obscureConfirmPassword;
                                });
                              },
                            ),
                          ),
                          validator: (value) {
                            if (value == null || value.isEmpty) {
                              return '请确认密码';
                            }
                            if (value != _passwordController.text) {
                              return '两次输入的密码不一致';
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: 16),
                        
                        // 用户协议
                        Row(
                          children: [
                            Checkbox(
                              value: _agreeToTerms,
                              onChanged: (value) {
                                setState(() {
                                  _agreeToTerms = value ?? false;
                                });
                              },
                            ),
                            Expanded(
                              child: GestureDetector(
                                onTap: () {
                                  setState(() {
                                    _agreeToTerms = !_agreeToTerms;
                                  });
                                },
                                child: RichText(
                                  text: TextSpan(
                                    style: theme.textTheme.bodyMedium,
                                    children: [
                                      TextSpan(
                                        text: '我已阅读并同意',
                                        style: TextStyle(color: Colors.grey[700]),
                                      ),
                                      TextSpan(
                                        text: '用户协议',
                                        style: TextStyle(
                                          color: theme.primaryColor,
                                          decoration: TextDecoration.underline,
                                        ),
                                      ),
                                      TextSpan(
                                        text: '和',
                                        style: TextStyle(color: Colors.grey[700]),
                                      ),
                                      TextSpan(
                                        text: '隐私政策',
                                        style: TextStyle(
                                          color: theme.primaryColor,
                                          decoration: TextDecoration.underline,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 24),
                        
                        // 注册按钮
                        CustomButton(
                          text: '注册',
                          width: double.infinity,
                          onPressed: _handleRegister,
                          icon: Icons.person_add,
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
                        
                        // 登录链接
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              '已有账号？',
                              style: TextStyle(color: Colors.grey[600]),
                            ),
                            TextButton(
                              onPressed: () {
                                context.go('/login');
                              },
                              child: const Text('立即登录'),
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
