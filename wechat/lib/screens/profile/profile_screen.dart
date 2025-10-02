import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';

import '../../models/user_model.dart';
import '../../services/auth_service.dart';
import '../../services/emoji_service.dart';

/// 用户资料页面
///
/// 允许用户查看和修改个人信息（用户名、头像）
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({Key? key}) : super(key: key);

  @override
  _ProfileScreenState createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  // 是否正在编辑用户名
  bool _isEditingUsername = false;
  
  // 是否正在上传头像
  bool _isUpdatingAvatar = false;
  
  // 是否正在保存用户名
  bool _isSavingUsername = false;
  
  // 用户名文本编辑控制器
  final TextEditingController _usernameController = TextEditingController();
  
  // 图片选择器
  final ImagePicker _imagePicker = ImagePicker();
  
  // 新选择的头像文件
  File? _selectedAvatarFile;
  
  // Web平台使用的头像字节数据
  Uint8List? _currentAvatarBytes;
  
  // 修改后的用户名
  String? _newUsername;
  
  // 错误信息
  String? _errorMessage;
  
  // 成功信息
  String? _successMessage;

  @override
  void initState() {
    super.initState();
    _initializeUsername();
  }

  @override
  void dispose() {
    _usernameController.dispose();
    super.dispose();
  }

  /// 初始化用户名
  void _initializeUsername() {
    final authService = Provider.of<AuthService>(context, listen: false);
    final currentUser = authService.currentUser;
    if (currentUser != null) {
      _usernameController.text = currentUser.username;
    }
  }

  /// 选择头像
  Future<void> _pickAvatar() async {
    try {
      final XFile? pickedFile = await _imagePicker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 70, // 压缩图片质量以减小文件大小
        maxWidth: 300,    // 限制宽度
        maxHeight: 300,   // 限制高度
      );
      
      if (pickedFile != null) {
        // 对于非Web平台，使用File对象
        if (!kIsWeb) {
          setState(() {
            _selectedAvatarFile = File(pickedFile.path);
            _currentAvatarBytes = null; // 清除之前的字节数据
            _errorMessage = null;
            _successMessage = null;
          });
        } 
        // 对于Web平台，读取字节数据
        else {
          try {
            final bytes = await pickedFile.readAsBytes();
            setState(() {
              _currentAvatarBytes = bytes;
              _selectedAvatarFile = null; // Web平台上不使用File对象
              _errorMessage = null;
              _successMessage = null;
            });
          } catch (e) {
            print('读取图片字节数据失败: $e');
            setState(() {
              _errorMessage = '读取图片失败: $e';
            });
          }
        }
      }
    } catch (e) {
      setState(() {
        _errorMessage = '选择头像失败: $e';
      });
      print('选择头像错误: $e');
    }
  }

  /// 更新头像
  Future<void> _updateAvatar() async {
    // 检查是否有选择新头像（无论是文件还是字节数据）
    if (_selectedAvatarFile == null && _currentAvatarBytes == null) return;
    
    final authService = Provider.of<AuthService>(context, listen: false);
    
    try {
      setState(() {
        _isUpdatingAvatar = true;
        _errorMessage = null;
        _successMessage = null;
      });
      
      UserModel? result;
      
      // 根据平台选择不同的更新方式
      if (kIsWeb && _currentAvatarBytes != null) {
        // Web平台使用字节数据
        // 注意：这里假设AuthService有一个接受字节数据的方法
        // 如果没有，您需要修改AuthService添加这个功能
        result = await authService.updateUserProfileWithBytes(
          avatarBytes: _currentAvatarBytes!,
        );
      } else if (_selectedAvatarFile != null) {
        // 非Web平台使用文件路径
        result = await authService.updateUserProfile(
          newAvatarFilePath: _selectedAvatarFile!.path,
        );
      }
      
      setState(() {
        _isUpdatingAvatar = false;
      });
      
      if (result != null) {
        setState(() {
          _successMessage = '头像更新成功';
          _selectedAvatarFile = null; // 清除已选择的文件
          _currentAvatarBytes = null; // 清除字节数据
        });
      } else {
        setState(() {
          _errorMessage = '头像更新失败';
        });
      }
    } catch (e) {
      setState(() {
        _isUpdatingAvatar = false;
        _errorMessage = '头像更新错误: $e';
      });
      print('头像更新错误: $e');
    }
  }

  /// 保存用户名
  Future<void> _saveUsername() async {
    final newUsername = _usernameController.text.trim();
    if (newUsername.isEmpty) {
      setState(() {
        _errorMessage = '用户名不能为空';
      });
      return;
    }
    
    final authService = Provider.of<AuthService>(context, listen: false);
    final currentUser = authService.currentUser;
    
    if (currentUser == null) {
      setState(() {
        _errorMessage = '未登录，无法更新用户名';
      });
      return;
    }
    
    // 如果用户名未更改，则不进行更新
    if (newUsername == currentUser.username) {
      setState(() {
        _isEditingUsername = false;
      });
      return;
    }
    
    try {
      setState(() {
        _isSavingUsername = true;
        _errorMessage = null;
        _successMessage = null;
      });
      
      // 调用 AuthService 更新用户名
      final result = await authService.updateUserProfile(
        newUsername: newUsername,
      );
      
      setState(() {
        _isSavingUsername = false;
      });
      
      if (result != null) {
        setState(() {
          _isEditingUsername = false;
          _successMessage = '用户名更新成功';
        });
      } else {
        setState(() {
          _errorMessage = '用户名更新失败';
        });
      }
    } catch (e) {
      setState(() {
        _isSavingUsername = false;
        _errorMessage = '用户名更新错误: $e';
      });
      print('用户名更新错误: $e');
    }
  }

  /// 登出
  Future<void> _logout() async {
    final authService = Provider.of<AuthService>(context, listen: false);
    final emojiService = Provider.of<EmojiService>(context, listen: false);
    
    // 清理表情包数据
    emojiService.clearUserData();
    
    // 登出用户
    authService.logout(); // Method returns void so don't await it
    
    // 导航回登录页面
    Navigator.of(context).pushReplacementNamed('/login');
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AuthService>(
      builder: (context, authService, child) {
        final currentUser = authService.currentUser;
        
        if (currentUser == null) {
          // 未登录状态
          return Scaffold(
            appBar: AppBar(title: Text('个人资料')),
            body: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('请先登录'),
                  SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () => Navigator.of(context).pushReplacementNamed('/login'),
                    child: Text('前往登录'),
                  ),
                ],
              ),
            ),
          );
        }
        
        // 已登录状态
        return Scaffold(
          appBar: AppBar(
            title: Text('个人资料'),
            leading: IconButton(
              icon: Icon(Icons.arrow_back),
              onPressed: () => Navigator.pop(context),
            ),
          ),
          body: _buildProfileBody(currentUser),
        );
      },
    );
  }

  /// 构建个人资料页面主体
  Widget _buildProfileBody(UserModel user) {
    return SingleChildScrollView(
      padding: EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // 头像部分
          _buildAvatarSection(user),
          
          SizedBox(height: 24),
          
          // 用户名部分
          _buildUsernameSection(user),
          
          SizedBox(height: 24),
          
          // 状态消息
          if (_errorMessage != null)
            Padding(
              padding: EdgeInsets.only(bottom: 16),
              child: Text(
                _errorMessage!,
                style: TextStyle(color: Colors.red),
              ),
            ),
            
          if (_successMessage != null)
            Padding(
              padding: EdgeInsets.only(bottom: 16),
              child: Text(
                _successMessage!,
                style: TextStyle(color: Colors.green),
              ),
            ),
          
          SizedBox(height: 24),
          
          // 其他信息
          Card(
            child: ListTile(
              leading: Icon(Icons.calendar_today),
              title: Text('注册时间'),
              subtitle: Text(
                '${user.createdAt.year}-${user.createdAt.month.toString().padLeft(2, '0')}-${user.createdAt.day.toString().padLeft(2, '0')}',
              ),
            ),
          ),
          
          SizedBox(height: 16),
          
          // 表情包管理
          Card(
            child: ListTile(
              leading: Icon(Icons.emoji_emotions, color: Colors.orange),
              title: Text('表情包管理'),
              subtitle: Text('添加、删除和管理您的自定义表情包'),
              trailing: Icon(Icons.chevron_right),
              onTap: () {
                Navigator.pushNamed(context, '/emoji_manager');
              },
            ),
          ),
          
          SizedBox(height: 24),
          
          // 登出按钮
          ElevatedButton.icon(
            onPressed: _logout,
            icon: Icon(Icons.exit_to_app),
            label: Text('退出登录'),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.red,
              foregroundColor: Colors.white,
              minimumSize: Size(double.infinity, 50),
            ),
          ),
        ],
      ),
    );
  }

  /// 构建头像部分
  Widget _buildAvatarSection(UserModel user) {
    return Column(
      children: [
        // 头像显示
        Stack(
          alignment: Alignment.center,
          children: [
            // 头像容器
            Container(
              width: 120,
              height: 120,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.grey[200],
                border: Border.all(color: Colors.blue, width: 2),
              ),
              
              // 头像图片 (如果有)
              child: ClipOval(
                child: _buildAvatarImage(user),
              ),
            ),
            
            // 加载指示器
            if (_isUpdatingAvatar)
              Container(
                width: 120,
                height: 120,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.black.withOpacity(0.5),
                ),
                child: Center(
                  child: CircularProgressIndicator(color: Colors.white),
                ),
              ),
          ],
        ),
        
        SizedBox(height: 16),
        
        // 修改头像按钮
        (_selectedAvatarFile == null && _currentAvatarBytes == null)
            ? ElevatedButton.icon(
                onPressed: _pickAvatar,
                icon: Icon(Icons.camera_alt),
                label: Text('修改头像'),
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // 取消按钮
                  TextButton.icon(
                    onPressed: () {
                      setState(() {
                        _selectedAvatarFile = null;
                        _currentAvatarBytes = null;
                        _errorMessage = null;
                        _successMessage = null;
                      });
                    },
                    icon: Icon(Icons.close),
                    label: Text('取消'),
                    style: TextButton.styleFrom(foregroundColor: Colors.red),
                  ),
                  
                  SizedBox(width: 16),
                  
                  // 保存按钮
                  ElevatedButton.icon(
                    onPressed: _isUpdatingAvatar ? null : _updateAvatar,
                    icon: Icon(Icons.check),
                    label: Text('保存头像'),
                  ),
                ],
              ),
      ],
    );
  }

  /// 构建头像图片
  Widget _buildAvatarImage(UserModel user) {
    // 如果在Web平台上有字节数据
    if (kIsWeb && _currentAvatarBytes != null) {
      return Image.memory(
        _currentAvatarBytes!,
        width: 120,
        height: 120,
        fit: BoxFit.cover,
      );
    }
    // 如果在非Web平台上有文件
    else if (!kIsWeb && _selectedAvatarFile != null) {
      return Image.file(
        _selectedAvatarFile!,
        width: 120,
        height: 120,
        fit: BoxFit.cover,
      );
    }
    // 如果有网络头像
    else if (user.avatarUrl != null) {
      return Image.network(
        user.avatarUrl!,
        width: 120,
        height: 120,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => Icon(Icons.person, size: 60),
        loadingBuilder: (_, child, loadingProgress) {
          if (loadingProgress == null) return child;
          return Center(
            child: CircularProgressIndicator(
              value: loadingProgress.expectedTotalBytes != null
                  ? loadingProgress.cumulativeBytesLoaded / loadingProgress.expectedTotalBytes!
                  : null,
            ),
          );
        },
      );
    }
    // 默认显示占位图标
    else {
      return Icon(Icons.person, size: 60);
    }
  }

  /// 构建用户名部分
  Widget _buildUsernameSection(UserModel user) {
    return Card(
      child: Padding(
        padding: EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '用户名',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: Colors.grey[600],
              ),
            ),
            
            SizedBox(height: 8),
            
            // 编辑用户名
            _isEditingUsername
                ? Column(
                    children: [
                      // 用户名输入框
                      TextField(
                        controller: _usernameController,
                        decoration: InputDecoration(
                          hintText: '输入新用户名',
                          border: OutlineInputBorder(),
                          contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                        ),
                      ),
                      
                      SizedBox(height: 16),
                      
                      // 按钮组
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          // 取消按钮
                          TextButton(
                            onPressed: _isSavingUsername
                                ? null
                                : () {
                                    setState(() {
                                      _isEditingUsername = false;
                                      _usernameController.text = user.username;
                                      _errorMessage = null;
                                      _successMessage = null;
                                    });
                                  },
                            child: Text('取消'),
                            style: TextButton.styleFrom(foregroundColor: Colors.grey),
                          ),
                          
                          SizedBox(width: 16),
                          
                          // 保存按钮
                          ElevatedButton(
                            onPressed: _isSavingUsername ? null : _saveUsername,
                            child: _isSavingUsername
                                ? SizedBox(
                                    width: 20,
                                    height: 20,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  )
                                : Text('保存'),
                          ),
                        ],
                      ),
                    ],
                  )
                : Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      // 显示用户名
                      Text(
                        user.username,
                        style: TextStyle(fontSize: 18),
                      ),
                      
                      // 编辑按钮
                      IconButton(
                        icon: Icon(Icons.edit, color: Colors.blue),
                        onPressed: () {
                          setState(() {
                            _isEditingUsername = true;
                            _errorMessage = null;
                            _successMessage = null;
                          });
                        },
                      ),
                    ],
                  ),
          ],
        ),
      ),
    );
  }
}
