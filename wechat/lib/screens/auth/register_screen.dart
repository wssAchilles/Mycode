import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../services/auth_service.dart';
import '../../services/emoji_service.dart';

/// 注册界面
class RegisterScreen extends StatefulWidget {
  @override
  _RegisterScreenState createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  
  bool _isLoading = false;
  String? _errorMessage;
  bool _isSuccess = false;

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  /// 处理注册逻辑
  Future<void> _handleRegister() async {
    // 隐藏键盘
    FocusScope.of(context).unfocus();
    
    // 表单验证
    if (_formKey.currentState?.validate() != true) {
      return;
    }
    
    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _isSuccess = false;
    });
    
    try {
      final authService = Provider.of<AuthService>(context, listen: false);
      final user = await authService.register(
        _usernameController.text.trim(),
        _passwordController.text,
      );
      
      if (user != null) {
        // 注册成功，初始化表情包服务
        final emojiService = Provider.of<EmojiService>(context, listen: false);
        await emojiService.initializeForUser(user.userId);
        
        if (mounted) {
          setState(() {
            _isSuccess = true;
            _isLoading = false;
          });
          
          // 重置表单
          _formKey.currentState?.reset();
          
          // 延迟2秒后返回登录页
          Future.delayed(Duration(seconds: 2), () {
            if (mounted) {
              Navigator.pop(context);
            }
          });
        }
      } else {
        // 注册失败
        if (mounted) {
          setState(() {
            _errorMessage = '注册失败，用户名可能已存在';
            _isLoading = false;
          });
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = '注册失败: $e';
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('注册账号'),
        centerTitle: true,
      ),
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
                  // 应用标题
                  Text(
                    '创建新账号',
                    style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                      color: Theme.of(context).primaryColor,
                      fontWeight: FontWeight.bold,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  SizedBox(height: 32),
                  
                  // 成功消息
                  if (_isSuccess) ...[
                    Container(
                      padding: EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.green.shade50,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        '注册成功！正在返回登录页...',
                        style: TextStyle(color: Colors.green),
                        textAlign: TextAlign.center,
                      ),
                    ),
                    SizedBox(height: 24),
                  ],
                  
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
                      if (value.length < 3) {
                        return '用户名至少需要3个字符';
                      }
                      return null;
                    },
                    enabled: !_isLoading && !_isSuccess,
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
                      if (value.length < 6) {
                        return '密码至少需要6个字符';
                      }
                      return null;
                    },
                    enabled: !_isLoading && !_isSuccess,
                    textInputAction: TextInputAction.next,
                  ),
                  SizedBox(height: 16),
                  
                  // 确认密码输入框
                  TextFormField(
                    controller: _confirmPasswordController,
                    decoration: InputDecoration(
                      labelText: '确认密码',
                      prefixIcon: Icon(Icons.lock_outline),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    obscureText: true,
                    validator: (value) {
                      if (value == null || value.isEmpty) {
                        return '请再次输入密码';
                      }
                      if (value != _passwordController.text) {
                        return '两次输入的密码不一致';
                      }
                      return null;
                    },
                    enabled: !_isLoading && !_isSuccess,
                    onFieldSubmitted: (_) => _handleRegister(),
                  ),
                  SizedBox(height: 32),
                  
                  // 注册按钮
                  SizedBox(
                    height: 50,
                    child: ElevatedButton(
                      onPressed: (_isLoading || _isSuccess) ? null : _handleRegister,
                      style: ElevatedButton.styleFrom(
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: _isLoading
                          ? CircularProgressIndicator()
                          : Text('注册', style: TextStyle(fontSize: 16)),
                    ),
                  ),
                  SizedBox(height: 16),
                  
                  // 返回登录
                  TextButton(
                    onPressed: _isLoading ? null : () => Navigator.pop(context),
                    child: Text('已有账号？返回登录'),
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
