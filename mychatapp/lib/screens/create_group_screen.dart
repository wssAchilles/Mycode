import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/auth_service.dart';
import '../services/user_service.dart';
import '../services/group_service.dart';

/// 创建群组页面
/// 允许用户创建新的群组，选择成员，设置群组名称和描述
class CreateGroupScreen extends StatefulWidget {
  const CreateGroupScreen({Key? key}) : super(key: key);

  @override
  State<CreateGroupScreen> createState() => _CreateGroupScreenState();
}

class _CreateGroupScreenState extends State<CreateGroupScreen> {
  final AuthService _authService = AuthService();
  final UserService _userService = UserService();
  final GroupService _groupService = GroupService();
  
  final TextEditingController _groupNameController = TextEditingController();
  final TextEditingController _groupDescriptionController = TextEditingController();
  final TextEditingController _searchController = TextEditingController();
  
  String _searchQuery = '';
  final Set<String> _selectedMemberIds = {};
  final Map<String, UserModel> _selectedMembers = {};
  bool _isCreating = false;

  @override
  void dispose() {
    _groupNameController.dispose();
    _groupDescriptionController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  /// 切换成员选择状态
  void _toggleMemberSelection(UserModel user) {
    setState(() {
      if (_selectedMemberIds.contains(user.uid)) {
        _selectedMemberIds.remove(user.uid);
        _selectedMembers.remove(user.uid);
      } else {
        _selectedMemberIds.add(user.uid);
        _selectedMembers[user.uid] = user;
      }
    });
  }

  /// 创建群组
  Future<void> _createGroup() async {
    final groupName = _groupNameController.text.trim();
    if (groupName.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('请输入群组名称'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    if (_selectedMemberIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('请至少选择一个成员'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    setState(() {
      _isCreating = true;
    });

    try {
      final currentUser = _authService.currentUser;
      if (currentUser == null) {
        throw Exception('用户未登录');
      }

      final group = await _groupService.createGroup(
        name: groupName,
        description: _groupDescriptionController.text.trim().isNotEmpty 
            ? _groupDescriptionController.text.trim() 
            : null,
        creatorId: currentUser.uid,
        memberIds: _selectedMemberIds.toList(),
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('群组"${group.groupName}"创建成功！'),
            backgroundColor: Colors.green,
          ),
        );
        Navigator.of(context).pop(group);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('创建群组失败：${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isCreating = false;
        });
      }
    }
  }

  /// 搜索变化处理
  void _onSearchChanged(String query) {
    setState(() {
      _searchQuery = query;
    });
  }

  /// 构建已选成员显示
  Widget _buildSelectedMembers() {
    if (_selectedMembers.isEmpty) {
      return const SizedBox.shrink();
    }

    return Container(
      height: 80,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '已选成员 (${_selectedMembers.length})',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: Colors.grey[700],
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              itemCount: _selectedMembers.length,
              itemBuilder: (context, index) {
                final member = _selectedMembers.values.elementAt(index);
                return Container(
                  margin: const EdgeInsets.only(right: 8),
                  child: Column(
                    children: [
                      CircleAvatar(
                        radius: 20,
                        backgroundColor: Theme.of(context).primaryColor,
                        backgroundImage: member.photoUrl != null 
                            ? NetworkImage(member.photoUrl!) 
                            : null,
                        child: member.photoUrl == null
                            ? Text(
                                member.displayName.substring(0, 1).toUpperCase(),
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                ),
                              )
                            : null,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        member.displayName.length > 6 
                            ? '${member.displayName.substring(0, 6)}...'
                            : member.displayName,
                        style: TextStyle(
                          fontSize: 10,
                          color: Colors.grey[600],
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  /// 构建用户列表项
  Widget _buildUserListItem(UserModel user) {
    final isSelected = _selectedMemberIds.contains(user.uid);
    
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: Theme.of(context).primaryColor,
          backgroundImage: user.photoUrl != null ? NetworkImage(user.photoUrl!) : null,
          child: user.photoUrl == null
              ? Text(
                  user.displayName.substring(0, 1).toUpperCase(),
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                )
              : null,
        ),
        title: Text(
          user.displayName,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          user.email,
          style: TextStyle(
            color: Colors.grey[600],
            fontSize: 12,
          ),
        ),
        trailing: Checkbox(
          value: isSelected,
          onChanged: (_) => _toggleMemberSelection(user),
          activeColor: Theme.of(context).primaryColor,
        ),
        onTap: () => _toggleMemberSelection(user),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final currentUser = _authService.currentUser;
    
    if (currentUser == null) {
      return const Scaffold(
        body: Center(
          child: Text('用户未登录'),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('创建群组'),
        backgroundColor: Theme.of(context).primaryColor,
        foregroundColor: Colors.white,
        elevation: 2,
        actions: [
          TextButton(
            onPressed: _isCreating ? null : _createGroup,
            child: _isCreating
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      color: Colors.white,
                      strokeWidth: 2,
                    ),
                  )
                : const Text(
                    '创建',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
          ),
        ],
      ),
      body: Column(
        children: [
          // 群组信息输入区域
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border(
                bottom: BorderSide(color: Colors.grey[300]!),
              ),
            ),
            child: Column(
              children: [
                // 群组名称输入
                TextField(
                  controller: _groupNameController,
                  decoration: InputDecoration(
                    labelText: '群组名称',
                    hintText: '输入群组名称',
                    prefixIcon: const Icon(Icons.group),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  maxLength: 50,
                ),
                const SizedBox(height: 16),
                
                // 群组描述输入
                TextField(
                  controller: _groupDescriptionController,
                  decoration: InputDecoration(
                    labelText: '群组描述（可选）',
                    hintText: '输入群组描述',
                    prefixIcon: const Icon(Icons.description),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  maxLines: 2,
                  maxLength: 200,
                ),
              ],
            ),
          ),

          // 已选成员显示
          _buildSelectedMembers(),
          
          // 搜索框
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _searchController,
              onChanged: _onSearchChanged,
              decoration: InputDecoration(
                hintText: '搜索联系人...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _searchController.clear();
                          _onSearchChanged('');
                        },
                      )
                    : null,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(25),
                ),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16),
              ),
            ),
          ),

          // 用户列表
          Expanded(
            child: StreamBuilder<List<UserModel>>(
              stream: _searchQuery.isEmpty
                  ? _userService.getAllUsersExceptCurrentStream(currentUser.uid)
                  : _userService.searchUsersStream(_searchQuery, currentUser.uid),
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }

                if (snapshot.hasError) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.error_outline, size: 64, color: Colors.grey[400]),
                        const SizedBox(height: 16),
                        Text('加载用户失败', style: TextStyle(fontSize: 16, color: Colors.grey[600])),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: () => setState(() {}),
                          child: const Text('重试'),
                        ),
                      ],
                    ),
                  );
                }

                final users = snapshot.data ?? [];

                if (users.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          _searchQuery.isEmpty ? Icons.people_outline : Icons.search_off,
                          size: 64,
                          color: Colors.grey[400],
                        ),
                        const SizedBox(height: 16),
                        Text(
                          _searchQuery.isEmpty ? '暂无其他用户' : '未找到匹配的用户',
                          style: TextStyle(fontSize: 16, color: Colors.grey[600]),
                        ),
                        if (_searchQuery.isEmpty) ...[
                          const SizedBox(height: 8),
                          Text(
                            '邀请朋友加入开始聊天吧！',
                            style: TextStyle(fontSize: 14, color: Colors.grey[500]),
                          ),
                        ],
                      ],
                    ),
                  );
                }

                return ListView.builder(
                  itemCount: users.length,
                  itemBuilder: (context, index) => _buildUserListItem(users[index]),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
