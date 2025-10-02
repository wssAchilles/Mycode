import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';

import '../../models/friend_model.dart';
import '../../models/user_model.dart';
import '../../services/auth_service.dart';
import '../../services/friend_service.dart';
import '../../services/group_service.dart';
import '../../widgets/animated_list_item.dart';
import '../chat/group_chat_detail_screen.dart';

/// 创建群组页面
class CreateGroupScreen extends StatefulWidget {
  const CreateGroupScreen({Key? key}) : super(key: key);

  @override
  State<CreateGroupScreen> createState() => _CreateGroupScreenState();
}

class _CreateGroupScreenState extends State<CreateGroupScreen> {
  // 表单相关控制器
  final _formKey = GlobalKey<FormState>();
  final _groupNameController = TextEditingController();
  final _descriptionController = TextEditingController();

  // 选中的好友列表
  final List<String> _selectedFriendIds = [];

  // 群组头像
  File? _avatarFile;

  // 加载状态
  bool _isLoading = false;
  bool _isLoadingFriends = true;

  // 好友列表
  List<FriendModel> _friends = [];

  @override
  void initState() {
    super.initState();
    _loadFriends();
  }

  @override
  void dispose() {
    _groupNameController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  /// 加载好友列表
  Future<void> _loadFriends() async {
    setState(() {
      _isLoadingFriends = true;
    });

    final friendService = Provider.of<FriendService>(context, listen: false);
    final authService = Provider.of<AuthService>(context, listen: false);
    final friendIds = await friendService.getFriends(authService.currentUser!.userId);
    
    // 将好友ID转换为FriendModel对象
    final List<FriendModel> friendModels = [];
    for (final friendId in friendIds) {
      final user = await authService.getUserInfo(friendId);
      if (user != null) {
        friendModels.add(FriendModel(
          userId: user.userId,
          username: user.username,
          avatarUrl: user.avatarUrl,
        ));
      }
    }

    setState(() {
      _friends = friendModels;
      _isLoadingFriends = false;
    });
  }

  /// 选择群组头像
  Future<void> _pickImage() async {
    final ImagePicker picker = ImagePicker();
    final XFile? image = await picker.pickImage(source: ImageSource.gallery);

    if (image != null) {
      setState(() {
        _avatarFile = File(image.path);
      });
    }
  }

  /// 切换好友选中状态
  void _toggleFriendSelection(String friendId) {
    setState(() {
      if (_selectedFriendIds.contains(friendId)) {
        _selectedFriendIds.remove(friendId);
      } else {
        _selectedFriendIds.add(friendId);
      }
    });
  }

  /// 创建群组
  Future<void> _createGroup() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    // 检查是否至少选择了一个好友
    if (_selectedFriendIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请至少选择一个好友加入群组')),
      );
      return;
    }

    setState(() {
      _isLoading = true;
    });

    try {
      final groupService = Provider.of<GroupService>(context, listen: false);

      // 创建群组
      final group = await groupService.createGroup(
        groupName: _groupNameController.text,
        memberIds: _selectedFriendIds,
        description: _descriptionController.text.isNotEmpty 
            ? _descriptionController.text 
            : null,
        avatarFile: _avatarFile,
      );

      if (group != null) {
        // 创建成功，导航到群聊详情页面
        if (mounted) {
          Navigator.of(context).pushReplacement(
            MaterialPageRoute(
              builder: (context) => GroupChatDetailScreen(
                groupId: group.groupId,
                groupName: group.groupName,
              ),
            ),
          );
        }
      } else {
        // 创建失败
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('创建群组失败，请稍后重试')),
          );
        }
      }
    } catch (e) {
      print('创建群组错误: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('创建群组错误: $e')),
        );
      }
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
    
    return Scaffold(
      appBar: AppBar(
        title: const Text('创建群组'),
        actions: [
          if (!_isLoading)
            TextButton(
              onPressed: _createGroup,
              child: const Text('创建'),
            ),
          if (_isLoading)
            const Padding(
              padding: EdgeInsets.all(16.0),
              child: SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                ),
              ),
            ),
        ],
      ),
      body: _isLoadingFriends
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // 群组头像选择
                      Center(
                        child: GestureDetector(
                          onTap: _pickImage,
                          child: CircleAvatar(
                            radius: 50,
                            backgroundColor: theme.colorScheme.primaryContainer,
                            backgroundImage: _avatarFile != null
                                ? FileImage(_avatarFile!)
                                : null,
                            child: _avatarFile == null
                                ? const Icon(Icons.camera_alt, size: 40)
                                : null,
                          ),
                        ),
                      ),
                      const SizedBox(height: 20),

                      // 群组名称输入框
                      TextFormField(
                        controller: _groupNameController,
                        decoration: InputDecoration(
                          labelText: '群组名称',
                          hintText: '请输入群组名称',
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return '请输入群组名称';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 16),

                      // 群组描述输入框
                      TextFormField(
                        controller: _descriptionController,
                        decoration: InputDecoration(
                          labelText: '群组描述 (可选)',
                          hintText: '请输入群组描述',
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                        maxLines: 3,
                      ),
                      const SizedBox(height: 24),

                      // 已选择的好友数量
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8.0),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              '选择好友',
                              style: theme.textTheme.titleMedium,
                            ),
                            Text(
                              '已选择 ${_selectedFriendIds.length} 人',
                              style: theme.textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),

                      // 好友列表
                      ListView.builder(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        itemCount: _friends.length,
                        itemBuilder: (context, index) {
                          final friend = _friends[index];
                          final isSelected = _selectedFriendIds.contains(friend.userId);

                          return AnimatedListItem(
                            index: index,
                            child: CheckboxListTile(
                              title: Text(friend.username),
                              subtitle: friend.remark != null && friend.remark!.isNotEmpty
                                  ? Text(friend.remark!)
                                  : null,
                              secondary: CircleAvatar(
                                backgroundImage: friend.avatarUrl != null
                                    ? NetworkImage(friend.avatarUrl!)
                                    : null,
                                child: friend.avatarUrl == null
                                    ? Text(friend.username.isNotEmpty ? friend.username[0] : '?')
                                    : null,
                              ),
                              value: isSelected,
                              activeColor: theme.colorScheme.primary,
                              onChanged: (bool? value) {
                                _toggleFriendSelection(friend.userId);
                              },
                            ),
                          );
                        },
                      ),
                    ],
                  ),
                ),
              ),
            ),
    );
  }
}
