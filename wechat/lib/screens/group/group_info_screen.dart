import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';

import '../../models/group_model.dart';
import '../../models/user_model.dart';
import '../../services/auth_service.dart';
import '../../services/group_service.dart';
import '../../services/friend_service.dart';
import '../../widgets/animated_list_item.dart';

/// 群组信息页面
class GroupInfoScreen extends StatefulWidget {
  final GroupModel group;

  const GroupInfoScreen({Key? key, required this.group}) : super(key: key);

  @override
  State<GroupInfoScreen> createState() => _GroupInfoScreenState();
}

class _GroupInfoScreenState extends State<GroupInfoScreen> {
  // 编辑控制器
  final _groupNameController = TextEditingController();
  final _descriptionController = TextEditingController();

  // 加载状态
  bool _isLoading = false;
  bool _isEditingGroupInfo = false;
  bool _isAddingMembers = false;

  // 群组信息
  late GroupModel _group;
  
  // 群组头像
  File? _avatarFile;
  Uint8List? _avatarBytes; // Web平台使用

  // 用户信息缓存
  final Map<String, dynamic> _memberInfo = {};
  
  // 好友列表 (用于添加成员)
  List<UserModel> _friendsList = [];
  
  @override
  void initState() {
    super.initState();
    _group = widget.group;
    _groupNameController.text = _group.groupName;
    _descriptionController.text = _group.description ?? '';
    _loadMembersInfo();
    _loadFriendsList();
  }

  @override
  void dispose() {
    _groupNameController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  /// 加载成员信息
  Future<void> _loadMembersInfo() async {
    setState(() {
      _isLoading = true;
    });

    try {
      final authService = Provider.of<AuthService>(context, listen: false);
      
      for (final memberId in _group.members) {
        if (!_memberInfo.containsKey(memberId)) {
          final user = await authService.getUserInfo(memberId);
          if (user != null && mounted) {
            setState(() {
              _memberInfo[memberId] = {
                'username': user.username,
                'avatarUrl': user.avatarUrl,
              };
            });
          }
        }
      }
    } catch (e) {
      print('加载成员信息错误: $e');
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }
  
  /// 加载好友列表
  Future<void> _loadFriendsList() async {
    try {
      final friendService = Provider.of<FriendService>(context, listen: false);
      final authService = Provider.of<AuthService>(context, listen: false);
      final currentUserId = authService.currentUser?.userId;
      
      if (currentUserId == null) return;
      
      // 获取好友ID列表
      final friendIds = await friendService.getFriends(currentUserId);
      
      // 获取每个好友的详细信息
      final List<UserModel> friends = [];
      for (final friendId in friendIds) {
        final user = await authService.getUserInfo(friendId);
        if (user != null) {
          friends.add(user);
        }
      }
      
      if (mounted) {
        setState(() {
          _friendsList = friends;
        });
      }
    } catch (e) {
      print('加载好友列表错误: $e');
    }
  }
  
  /// 显示添加成员对话框
  Future<void> _showAddMembersDialog() async {
    // 过滤掉已经是群成员的好友
    final availableFriends = _friendsList.where((friend) => 
      !_group.members.contains(friend.userId)).toList();
    
    if (availableFriends.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('没有可添加的好友')),
      );
      return;
    }
    
    // 被选中的好友ID
    final selectedFriends = <String>{};
    
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) {
          return AlertDialog(
            title: const Text('添加群成员'),
            content: SizedBox(
              width: double.maxFinite,
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: availableFriends.length,
                itemBuilder: (context, index) {
                  final friend = availableFriends[index];
                  final isSelected = selectedFriends.contains(friend.userId);
                  
                  return CheckboxListTile(
                    value: isSelected,
                    onChanged: (value) {
                      setState(() {
                        if (value == true) {
                          selectedFriends.add(friend.userId);
                        } else {
                          selectedFriends.remove(friend.userId);
                        }
                      });
                    },
                    title: Text(friend.username),
                    secondary: CircleAvatar(
                      backgroundImage: friend.avatarUrl != null
                          ? NetworkImage(friend.avatarUrl!)
                          : null,
                      child: friend.avatarUrl == null
                          ? Text(friend.username.isNotEmpty ? friend.username[0] : '?')
                          : null,
                    ),
                  );
                },
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('取消'),
              ),
              ElevatedButton(
                onPressed: selectedFriends.isEmpty
                    ? null
                    : () => Navigator.of(context).pop(true),
                child: const Text('添加'),
              ),
            ],
          );
        },
      ),
    );
    
    if (result == true && selectedFriends.isNotEmpty) {
      _addMembers(selectedFriends.toList());
    }
  }
  
  /// 添加成员到群组
  Future<void> _addMembers(List<String> userIds) async {
    setState(() {
      _isAddingMembers = true;
    });
    
    try {
      final groupService = Provider.of<GroupService>(context, listen: false);
      
      // 逐个添加成员
      for (final userId in userIds) {
        final success = await groupService.addMemberToGroup(
          groupId: _group.groupId,
          userId: userId,
        );
        
        if (!success) {
          print('添加成员失败: $userId');
        }
      }
      
      // 重新加载群组信息
      final refreshedGroup = await groupService.getGroup(_group.groupId);
      if (refreshedGroup != null && mounted) {
        setState(() {
          _group = refreshedGroup;
        });
        
        // 加载新成员的信息
        _loadMembersInfo();
      }
      
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('成员添加成功')),
      );
    } catch (e) {
      print('添加成员错误: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('添加成员错误: $e')),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isAddingMembers = false;
        });
      }
    }
  }

  /// 选择群组头像
  Future<void> _pickImage() async {
    // 检查当前用户是否是群主或管理员
    final authService = Provider.of<AuthService>(context, listen: false);
    final currentUserId = authService.currentUser?.userId;
    
    if (currentUserId == null) return;
    
    if (currentUserId != _group.ownerId && !_group.adminIds.contains(currentUserId)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('只有群主或管理员可以修改群头像')),
      );
      return;
    }
    
    final ImagePicker picker = ImagePicker();
    final XFile? image = await picker.pickImage(source: ImageSource.gallery);

    if (image != null) {
      if (kIsWeb) {
        // Web平台：读取字节数据
        final bytes = await image.readAsBytes();
        setState(() {
          _avatarBytes = bytes;
          _avatarFile = null;
        });
      } else {
        // 非Web平台：使用文件路径
        setState(() {
          _avatarFile = File(image.path);
          _avatarBytes = null;
        });
      }
      
      // 直接更新头像
      _updateGroupAvatar();
    }
  }

  /// 更新群组头像
  Future<void> _updateGroupAvatar() async {
    if (_avatarFile == null && _avatarBytes == null) return;
    
    setState(() {
      _isLoading = true;
    });

    try {
      final groupService = Provider.of<GroupService>(context, listen: false);
      bool updatedGroup;
      
      if (kIsWeb && _avatarBytes != null) {
        // Web平台：使用字节数据更新头像
        updatedGroup = await groupService.updateGroupAvatarWithBytes(
          groupId: _group.groupId,
          avatarBytes: _avatarBytes!,
        );
      } else if (_avatarFile != null) {
        // 非Web平台：使用文件更新头像
        updatedGroup = await groupService.updateGroupAvatar(
          groupId: _group.groupId,
          avatarFile: _avatarFile!,
        );
      } else {
        throw Exception('没有可用的头像数据');
      }

      if (updatedGroup) {
        // 更新成功，重新加载群组信息
        final groupService = Provider.of<GroupService>(context, listen: false);
        final refreshedGroup = await groupService.getGroup(_group.groupId);
        setState(() {
          if (refreshedGroup != null) {
            _group = refreshedGroup;
          }
          _avatarFile = null;
          _avatarBytes = null;
        });
        
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('群头像更新成功')),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('群头像更新失败')),
        );
      }
    } catch (e) {
      print('更新群头像错误: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('更新群头像错误: $e')),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  /// 更新群组信息
  Future<void> _updateGroupInfo() async {
    if (!_isEditingGroupInfo) {
      setState(() {
        _isEditingGroupInfo = true;
      });
      return;
    }

    // 检查群名是否为空
    final groupName = _groupNameController.text.trim();
    if (groupName.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('群组名称不能为空')),
      );
      return;
    }

    // 检查是否有变化
    if (groupName == _group.groupName && 
        _descriptionController.text.trim() == (_group.description ?? '')) {
      setState(() {
        _isEditingGroupInfo = false;
      });
      return;
    }

    setState(() {
      _isLoading = true;
    });

    try {
      final groupService = Provider.of<GroupService>(context, listen: false);
      final updatedGroup = await groupService.updateGroupProfile(
        groupId: _group.groupId,
        groupName: groupName,
        description: _descriptionController.text.trim(),
      );

      if (updatedGroup) {
        // 更新成功，重新加载群组信息
        final groupService = Provider.of<GroupService>(context, listen: false);
        final refreshedGroup = await groupService.getGroup(_group.groupId);
        setState(() {
          if (refreshedGroup != null) {
            _group = refreshedGroup;
          }
          _isEditingGroupInfo = false;
        });
        
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('群组信息更新成功')),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('群组信息更新失败')),
        );
      }
    } catch (e) {
      print('更新群组信息错误: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('更新群组信息错误: $e')),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  /// 显示退出群组确认对话框
  Future<void> _showLeaveGroupDialog() async {
    final authService = Provider.of<AuthService>(context, listen: false);
    final currentUserId = authService.currentUser?.userId;
    
    if (currentUserId == null) return;
    
    // 群主不能退出群组，只能解散群组
    if (currentUserId == _group.ownerId) {
      _showDisbandGroupDialog();
      return;
    }
    
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('退出群组'),
        content: const Text('确定要退出此群组吗？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('确定'),
          ),
        ],
      ),
    );

    if (result == true) {
      _leaveGroup();
    }
  }

  /// 退出群组
  Future<void> _leaveGroup() async {
    setState(() {
      _isLoading = true;
    });

    try {
      final groupService = Provider.of<GroupService>(context, listen: false);
      final authService = Provider.of<AuthService>(context, listen: false);
      final currentUserId = authService.currentUser?.userId;
      
      if (currentUserId == null) {
        throw Exception('用户未登录');
      }
      
      final success = await groupService.removeMemberFromGroup(
        groupId: _group.groupId,
        userId: currentUserId,
      );

      if (success) {
        if (mounted) {
          // 退出成功，返回上一页
          Navigator.of(context).pop(true);
        }
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('退出群组失败')),
          );
        }
      }
    } catch (e) {
      print('退出群组错误: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('退出群组错误: $e')),
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

  /// 显示解散群组确认对话框
  Future<void> _showDisbandGroupDialog() async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('解散群组'),
        content: const Text('确定要解散此群组吗？此操作不可撤销。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('确定'),
            style: TextButton.styleFrom(
              foregroundColor: Colors.red,
            ),
          ),
        ],
      ),
    );

    if (result == true) {
      _disbandGroup();
    }
  }

  /// 解散群组
  Future<void> _disbandGroup() async {
    setState(() {
      _isLoading = true;
    });

    try {
      final groupService = Provider.of<GroupService>(context, listen: false);
      final success = await groupService.disbandGroup(_group.groupId);

      if (success) {
        if (mounted) {
          // 解散成功，返回上上一页（聊天列表页）
          Navigator.of(context).popUntil((route) => route.isFirst);
        }
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('解散群组失败')),
          );
        }
      }
    } catch (e) {
      print('解散群组错误: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('解散群组错误: $e')),
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
  
  /// 显示成员操作选项对话框
  Future<void> _showMemberOptionsDialog(String memberId, bool isOwner, bool isAdmin) async {
    final authService = Provider.of<AuthService>(context, listen: false);
    final currentUserId = authService.currentUser?.userId;
    
    if (currentUserId == null) return;
    
    // 当前用户是否是群主
    final isCurrentUserOwner = _group.ownerId == currentUserId;
    
    // 获取成员名称
    final memberName = _memberInfo[memberId]?['username'] ?? '群成员';
    
    // 构建选项列表
    final options = <Widget>[];
    
    // 移除成员选项（群主可以移除任何人，管理员可以移除普通成员）
    if ((isCurrentUserOwner || (currentUserId != memberId && !isOwner && !isAdmin)) && 
        memberId != _group.ownerId) {
      options.add(
        ListTile(
          leading: const Icon(Icons.person_remove, color: Colors.red),
          title: Text('移除 $memberName'),
          onTap: () {
            Navigator.of(context).pop();
            _showRemoveMemberConfirmDialog(memberId, memberName);
          },
        ),
      );
    }
    
    // 设置/取消管理员选项（只有群主可以设置/取消管理员）
    if (isCurrentUserOwner && memberId != currentUserId) {
      if (isAdmin) {
        options.add(
          ListTile(
            leading: const Icon(Icons.admin_panel_settings_outlined),
            title: Text('取消 $memberName 的管理员权限'),
            onTap: () {
              Navigator.of(context).pop();
              _removeAdmin(memberId);
            },
          ),
        );
      } else {
        options.add(
          ListTile(
            leading: const Icon(Icons.admin_panel_settings),
            title: Text('设置 $memberName 为管理员'),
            onTap: () {
              Navigator.of(context).pop();
              _addAdmin(memberId);
            },
          ),
        );
      }
    }
    
    // 如果没有可用选项，显示提示
    if (options.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('没有可用的操作')),
      );
      return;
    }
    
    // 显示对话框
    await showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('$memberName 的操作选项'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: options,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('取消'),
          ),
        ],
      ),
    );
  }
  
  /// 显示移除成员确认对话框
  Future<void> _showRemoveMemberConfirmDialog(String memberId, String memberName) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('移除 $memberName'),
        content: Text('确定要将 $memberName 移出群组吗？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('确定'),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
          ),
        ],
      ),
    );
    
    if (result == true) {
      _removeMember(memberId);
    }
  }
  
  /// 移除成员
  Future<void> _removeMember(String memberId) async {
    setState(() {
      _isLoading = true;
    });
    
    try {
      final groupService = Provider.of<GroupService>(context, listen: false);
      final success = await groupService.removeMemberFromGroup(
        groupId: _group.groupId,
        userId: memberId,
      );
      
      if (success) {
        // 重新加载群组信息
        final refreshedGroup = await groupService.getGroup(_group.groupId);
        if (refreshedGroup != null && mounted) {
          setState(() {
            _group = refreshedGroup;
          });
        }
        
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('成员已移除')),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('移除成员失败')),
        );
      }
    } catch (e) {
      print('移除成员错误: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('移除成员错误: $e')),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }
  
  /// 添加管理员
  Future<void> _addAdmin(String memberId) async {
    setState(() {
      _isLoading = true;
    });
    
    try {
      final groupService = Provider.of<GroupService>(context, listen: false);
      final success = await groupService.addGroupAdmin(
        groupId: _group.groupId,
        userId: memberId,
      );
      
      if (success) {
        // 重新加载群组信息
        final refreshedGroup = await groupService.getGroup(_group.groupId);
        if (refreshedGroup != null && mounted) {
          setState(() {
            _group = refreshedGroup;
          });
        }
        
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('已设置为管理员')),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('设置管理员失败')),
        );
      }
    } catch (e) {
      print('设置管理员错误: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('设置管理员错误: $e')),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }
  
  /// 移除管理员
  Future<void> _removeAdmin(String memberId) async {
    setState(() {
      _isLoading = true;
    });
    
    try {
      final groupService = Provider.of<GroupService>(context, listen: false);
      final success = await groupService.removeGroupAdmin(
        groupId: _group.groupId,
        userId: memberId,
      );
      
      if (success) {
        // 重新加载群组信息
        final refreshedGroup = await groupService.getGroup(_group.groupId);
        if (refreshedGroup != null && mounted) {
          setState(() {
            _group = refreshedGroup;
          });
        }
        
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('已取消管理员权限')),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('取消管理员权限失败')),
        );
      }
    } catch (e) {
      print('取消管理员权限错误: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('取消管理员权限错误: $e')),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  /// 检查当前用户是否是群主或管理员
  bool _isOwnerOrAdmin() {
    final authService = Provider.of<AuthService>(context, listen: false);
    final currentUserId = authService.currentUser?.userId;
    
    if (currentUserId == null) return false;
    
    return currentUserId == _group.ownerId || _group.adminIds.contains(currentUserId);
  }
  
  /// 构建头像图片
  ImageProvider? _buildAvatarImage() {
    if (_avatarFile != null) {
      // 非Web平台：使用文件
      return FileImage(_avatarFile!);
    } else if (_avatarBytes != null) {
      // Web平台：使用内存图片
      return MemoryImage(_avatarBytes!);
    } else if (_group.avatarUrl != null) {
      // 使用网络图片
      return NetworkImage(_group.avatarUrl!);
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final authService = Provider.of<AuthService>(context);
    final currentUserId = authService.currentUser?.userId;
    
    // 是否是群主
    final isOwner = currentUserId == _group.ownerId;
    // 是否是管理员
    final isAdmin = isOwner || _group.adminIds.contains(currentUserId);
    
    return Scaffold(
      appBar: AppBar(
        title: const Text('群组信息'),
        actions: [
          if (isAdmin && !_isEditingGroupInfo)
            IconButton(
              icon: const Icon(Icons.edit),
              onPressed: _updateGroupInfo,
            ),
          if (_isEditingGroupInfo)
            IconButton(
              icon: const Icon(Icons.check),
              onPressed: _updateGroupInfo,
            ),
        ],
      ),
      body: Stack(
        children: [
          ListView(
            padding: const EdgeInsets.all(16.0),
            children: [
              // 群组头像
              Center(
                child: GestureDetector(
                  onTap: _pickImage,
                  child: Stack(
                    children: [
                      CircleAvatar(
                        radius: 50,
                        backgroundImage: _buildAvatarImage(),
                        child: (_avatarFile == null && _avatarBytes == null && _group.avatarUrl == null)
                            ? Text(
                                _group.groupName.isNotEmpty ? _group.groupName[0] : '?',
                                style: const TextStyle(fontSize: 40),
                              )
                            : null,
                      ),
                      if (isAdmin)
                        Positioned(
                          right: 0,
                          bottom: 0,
                          child: CircleAvatar(
                            radius: 18,
                            backgroundColor: theme.colorScheme.primary,
                            child: const Icon(
                              Icons.camera_alt,
                              size: 18,
                              color: Colors.white,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 24),

              // 群组名称
              if (_isEditingGroupInfo)
                TextFormField(
                  controller: _groupNameController,
                  decoration: InputDecoration(
                    labelText: '群组名称',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                )
              else
                ListTile(
                  title: const Text('群组名称'),
                  subtitle: Text(_group.groupName),
                ),
              const SizedBox(height: 8),

              // 群组描述
              if (_isEditingGroupInfo)
                TextFormField(
                  controller: _descriptionController,
                  decoration: InputDecoration(
                    labelText: '群组描述',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  maxLines: 3,
                )
              else
                ListTile(
                  title: const Text('群组描述'),
                  subtitle: Text(_group.description ?? '无描述'),
                ),
              const SizedBox(height: 16),

              // 群主和管理员标识
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                child: Row(
                  children: [
                    const Text('群主：'),
                    Text(_memberInfo[_group.ownerId]?['username'] ?? '加载中...'),
                  ],
                ),
              ),

              // 成员列表标题
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 16.0),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      '群成员列表',
                      style: theme.textTheme.titleMedium,
                    ),
                    Text(
                      '${_group.members.length} 人',
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ),
              ),

                              // 成员列表标题和添加成员按钮
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '群成员列表',
                        style: theme.textTheme.titleMedium,
                      ),
                      if (isAdmin) // 只有群主和管理员可以添加成员
                        IconButton(
                          icon: const Icon(Icons.person_add),
                          tooltip: '添加成员',
                          onPressed: _isAddingMembers ? null : _showAddMembersDialog,
                        ),
                    ],
                  ),
                ),
                
                // 成员列表
                if (_isLoading && _memberInfo.isEmpty)
                  const Center(child: CircularProgressIndicator())
                else
                  ListView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: _group.members.length,
                    itemBuilder: (context, index) {
                      final memberId = _group.members[index];
                      final memberData = _memberInfo[memberId];
                      final isOwner = memberId == _group.ownerId;
                      final isAdmin = _group.adminIds.contains(memberId);
                      
                      return AnimatedListItem(
                        index: index,
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundImage: memberData != null && memberData['avatarUrl'] != null
                                ? NetworkImage(memberData['avatarUrl'])
                                : null,
                            child: memberData == null || memberData['avatarUrl'] == null
                                ? Text(memberData != null && memberData['username'] != null 
                                    ? memberData['username'][0] 
                                    : '?')
                                : null,
                          ),
                          title: Row(
                            children: [
                              Expanded(
                                child: Text(memberData != null ? memberData['username'] : '加载中...'),
                              ),
                              if (isOwner)
                                Container(
                                  margin: const EdgeInsets.only(left: 8),
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: Colors.orangeAccent,
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: const Text(
                                    '群主',
                                    style: TextStyle(color: Colors.white, fontSize: 10),
                                  ),
                                ),
                              if (isAdmin && !isOwner)
                                Container(
                                  margin: const EdgeInsets.only(left: 8),
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: Colors.blueAccent,
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: const Text(
                                    '管理员',
                                    style: TextStyle(color: Colors.white, fontSize: 10),
                                  ),
                                ),
                            ],
                          ),
                          // 如果当前用户是群主或管理员，且不是自己，显示更多操作按钮
                          trailing: isAdmin && currentUserId != memberId && currentUserId != null
                              ? IconButton(
                                  icon: const Icon(Icons.more_vert),
                                  onPressed: () => _showMemberOptionsDialog(memberId, isOwner, isAdmin),
                                )
                              : null,
                        ),
                      );
                    },
                  ),
              const SizedBox(height: 24),

              // 退出群组按钮
              if (currentUserId != null)
                ElevatedButton(
                  onPressed: _showLeaveGroupDialog,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: isOwner ? Colors.red : null,
                    foregroundColor: isOwner ? Colors.white : null,
                  ),
                  child: Text(isOwner ? '解散群组' : '退出群组'),
                ),
            ],
          ),
          
          // 加载指示器
          if (_isLoading)
            Container(
              color: Colors.black.withOpacity(0.1),
              child: const Center(
                child: CircularProgressIndicator(),
              ),
            ),
        ],
      ),
    );
  }
}
