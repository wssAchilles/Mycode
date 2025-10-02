import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../services/auth_service.dart';
import '../../services/emoji_service.dart';
import 'register_screen.dart';

/// 登录界面
class LoginScreen extends StatefulWidget {
  @override
  _LoginScreenState createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  /// 处理登录逻辑
  Future<void> _handleLogin() async {
    // 隐藏键盘
    FocusScope.of(context).unfocus();
    
    // 表单验证
    if (_formKey.currentState?.validate() != true) {
      return;
    }
    
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    
    try {
      final authService = Provider.of<AuthService>(context, listen: false);
      final user = await authService.login(
        _usernameController.text.trim(),
        _passwordController.text,
      );
      
      if (user != null) {
        // 登录成功，初始化表情包服务
        final emojiService = Provider.of<EmojiService>(context, listen: false);
        await emojiService.initializeForUser(user.userId);
        
        if (mounted) {
          // 显示成功消息
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('登录成功！欢迎 ${user.username}')),
          );
          
          // 导航到聊天列表页面
          Navigator.of(context).pushReplacementNamed('/chat_list');
          
          // 重置表单
          _formKey.currentState?.reset();
        }
      } else {
        // 登录失败
        if (mounted) {
          setState(() {
            _errorMessage = '用户名或密码错误';
            _isLoading = false;
          });
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = '登录失败: $e';
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: EdgeInsets.all(24),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // 应用标题/Logo
                  Text(
                    '微聊',
                    style: Theme.of(context).textTheme.displaySmall?.copyWith(
                      color: Theme.of(context).primaryColor,
                      fontWeight: FontWeight.bold,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  SizedBox(height: 48),
                  
                  // 错误消息
                  if (_errorMessage != null) ...[
                    Container(
                      padding: EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.red.shade50,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        _errorMessage!,
                        style: TextStyle(color: Colors.red),
                        textAlign: TextAlign.center,
                      ),
                    ),
                    SizedBox(height: 24),
                  ],
                  
                  // 用户名输入框
                  TextFormField(
                    controller: _usernameController,
                    decoration: InputDecoration(
                      labelText: '用户名',
                      prefixIcon: Icon(Icons.person),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    validator: (value) {
                      if (value == null || value.trim().isEmpty) {
                        return '请输入用户名';
                      }
                      return null;
                    },
                    enabled: !_isLoading,
                    textInputAction: TextInputAction.next,
                  ),
                  SizedBox(height: 16),
                  
                  // 密码输入框
                  TextFormField(
                    controller: _passwordController,
                    decoration: InputDecoration(
                      labelText: '密码',
                      prefixIcon: Icon(Icons.lock),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    obscureText: true,
                    validator: (value) {
                      if (value == null || value.isEmpty) {
                        return '请输入密码';
                      }
                      return null;
                    },
                    enabled: !_isLoading,
                    onFieldSubmitted: (_) => _handleLogin(),
                  ),
                  SizedBox(height: 32),
                  
                  // 登录按钮
                  SizedBox(
                    height: 50,
                    child: ElevatedButton(
                      onPressed: _isLoading ? null : _handleLogin,
                      style: ElevatedButton.styleFrom(
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: _isLoading
                          ? CircularProgressIndicator()
                          : Text('登录', style: TextStyle(fontSize: 16)),
                    ),
                  ),
                  SizedBox(height: 16),
                  
                  // 去注册
                  TextButton(
                    onPressed: _isLoading
                        ? null
                        : () {
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => RegisterScreen(),
                              ),
                            );
                          },
                    child: Text('没有账号？去注册'),
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
