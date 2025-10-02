import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../models/user_model.dart';
import '../services/user_service.dart';
import '../services/auth_service.dart';

/// 用户资料页面
/// 严格遵循项目蓝图第一阶段要求，实现基础用户资料功能
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final UserService _userService = UserService();
  final AuthService _authService = AuthService();
  final TextEditingController _displayNameController = TextEditingController();
  
  bool _isUpdating = false;
  bool _isUploadingPhoto = false;
  UserModel? _currentUser;

  @override
  void initState() {
    super.initState();
    _loadUserData();
  }

  @override
  void dispose() {
    _displayNameController.dispose();
    super.dispose();
  }

  /// 加载当前用户数据
  void _loadUserData() async {
    final user = await _authService.getCurrentUserModel();
    if (user != null && mounted) {
      setState(() {
        _currentUser = user;
        _displayNameController.text = user.displayName;
      });
    }
  }

  /// 显示昵称编辑对话框
  void _showEditDisplayNameDialog() {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('编辑昵称'),
          content: TextField(
            controller: _displayNameController,
            decoration: const InputDecoration(
              labelText: '请输入新昵称',
              border: OutlineInputBorder(),
            ),
            maxLength: 20,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('取消'),
            ),
            ElevatedButton(
              onPressed: _updateDisplayName,
              child: const Text('保存'),
            ),
          ],
        );
      },
    );
  }

  /// 更新用户昵称
  void _updateDisplayName() async {
    if (_currentUser == null) return;

    final newName = _displayNameController.text.trim();
    if (newName.isEmpty) {
      _showErrorSnackBar('昵称不能为空');
      return;
    }

    setState(() => _isUpdating = true);

    try {
      await _userService.updateDisplayName(_currentUser!.uid, newName);
      await _authService.updateUserProfile(displayName: newName);
      
      if (mounted) {
        Navigator.of(context).pop();
        _showSuccessSnackBar('昵称更新成功');
        _loadUserData(); // 重新加载数据
      }
    } catch (e) {
      if (mounted) {
        _showErrorSnackBar('昵称更新失败：${e.toString()}');
      }
    } finally {
      if (mounted) {
        setState(() => _isUpdating = false);
      }
    }
  }

  /// 显示头像更换选项
  void _showAvatarOptions() {
    showModalBottomSheet(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Wrap(
            children: [
              ListTile(
                leading: const Icon(Icons.photo_library),
                title: const Text('从相册选择'),
                onTap: () {
                  Navigator.pop(context);
                  _updateProfilePictureFromGallery();
                },
              ),
              ListTile(
                leading: const Icon(Icons.camera_alt),
                title: const Text('拍摄照片'),
                onTap: () {
                  Navigator.pop(context);
                  _updateProfilePictureFromCamera();
                },
              ),
            ],
          ),
        );
      },
    );
  }

  /// 从相册更新头像
  void _updateProfilePictureFromGallery() async {
    if (_currentUser == null) return;

    setState(() => _isUploadingPhoto = true);

    try {
      final downloadUrl = await _userService.updateUserProfilePicture(_currentUser!.uid);
      
      if (downloadUrl != null && mounted) {
        await _authService.updateUserProfile(photoUrl: downloadUrl);
        _showSuccessSnackBar('头像更新成功');
        _loadUserData(); // 重新加载数据
      }
    } catch (e) {
      if (mounted) {
        _showErrorSnackBar('头像更新失败：${e.toString()}');
      }
    } finally {
      if (mounted) {
        setState(() => _isUploadingPhoto = false);
      }
    }
  }

  /// 从相机更新头像
  void _updateProfilePictureFromCamera() async {
    if (_currentUser == null) return;

    setState(() => _isUploadingPhoto = true);

    try {
      final downloadUrl = await _userService.updateUserProfilePictureFromCamera(_currentUser!.uid);
      
      if (downloadUrl != null && mounted) {
        await _authService.updateUserProfile(photoUrl: downloadUrl);
        _showSuccessSnackBar('头像更新成功');
        _loadUserData(); // 重新加载数据
      }
    } catch (e) {
      if (mounted) {
        _showErrorSnackBar('头像更新失败：${e.toString()}');
      }
    } finally {
      if (mounted) {
        setState(() => _isUploadingPhoto = false);
      }
    }
  }

  /// 显示成功提示
  void _showSuccessSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.green,
      ),
    );
  }

  /// 显示错误提示
  void _showErrorSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.red,
      ),
    );
  }

  /// 登出确认对话框
  void _showSignOutDialog() {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('确认登出'),
          content: const Text('您确定要登出吗？'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('取消'),
            ),
            ElevatedButton(
              onPressed: () async {
                try {
                  await _authService.signOut();
                  if (mounted) {
                    Navigator.of(context).pop();
                    Navigator.of(context).pushReplacementNamed('/auth');
                  }
                } catch (e) {
                  if (mounted) {
                    Navigator.of(context).pop();
                    _showErrorSnackBar('登出失败：${e.toString()}');
                  }
                }
              },
              child: const Text('登出'),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('个人资料'),
        elevation: 0,
      ),
      body: _currentUser == null
          ? const Center(child: CircularProgressIndicator())
          : StreamBuilder<UserModel?>(
              stream: _userService.getUserByIdStream(_currentUser!.uid),
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }

                if (snapshot.hasError) {
                  return Center(
                    child: Text('加载失败：${snapshot.error}'),
                  );
                }

                final user = snapshot.data;
                if (user == null) {
                  return const Center(
                    child: Text('用户数据不存在'),
                  );
                }

                return SingleChildScrollView(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      // 头像区域
                      Stack(
                        children: [
                          GestureDetector(
                            onTap: _showAvatarOptions,
                            child: Container(
                              width: 120,
                              height: 120,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                border: Border.all(
                                  color: Theme.of(context).primaryColor,
                                  width: 3,
                                ),
                              ),
                              child: _isUploadingPhoto
                                  ? const CircularProgressIndicator()
                                  : CircleAvatar(
                                      radius: 57,
                                      backgroundImage: user.photoUrl != null
                                          ? NetworkImage(user.photoUrl!)
                                          : null,
                                      child: user.photoUrl == null
                                          ? Text(
                                              user.displayName.isNotEmpty 
                                                  ? user.displayName[0].toUpperCase()
                                                  : 'U',
                                              style: const TextStyle(fontSize: 40),
                                            )
                                          : null,
                                    ),
                            ),
                          ),
                          Positioned(
                            bottom: 0,
                            right: 0,
                            child: Container(
                              decoration: BoxDecoration(
                                color: Theme.of(context).primaryColor,
                                shape: BoxShape.circle,
                              ),
                              child: IconButton(
                                icon: const Icon(Icons.camera_alt, color: Colors.white),
                                onPressed: _showAvatarOptions,
                              ),
                            ),
                          ),
                        ],
                      ),
                      
                      const SizedBox(height: 24),

                      // 昵称区域
                      Card(
                        child: ListTile(
                          leading: const Icon(Icons.person),
                          title: const Text('昵称'),
                          subtitle: Text(user.displayName),
                          trailing: IconButton(
                            icon: const Icon(Icons.edit),
                            onPressed: _showEditDisplayNameDialog,
                          ),
                        ),
                      ),

                      const SizedBox(height: 8),

                      // 邮箱区域（只读）
                      Card(
                        child: ListTile(
                          leading: const Icon(Icons.email),
                          title: const Text('邮箱'),
                          subtitle: Text(user.email),
                        ),
                      ),

                      const SizedBox(height: 8),

                      // 注册时间
                      Card(
                        child: ListTile(
                          leading: const Icon(Icons.calendar_today),
                          title: const Text('注册时间'),
                          subtitle: Text(
                            '${user.createdAt.toDate().year}年${user.createdAt.toDate().month}月${user.createdAt.toDate().day}日',
                          ),
                        ),
                      ),

                      const SizedBox(height: 32),

                      // 登出按钮
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          onPressed: _showSignOutDialog,
                          icon: const Icon(Icons.logout),
                          label: const Text('登出'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.red,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 16),
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
    );
  }
}
