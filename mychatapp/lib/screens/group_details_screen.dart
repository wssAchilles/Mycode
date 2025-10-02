import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/models.dart';
import '../services/auth_service.dart';
import '../services/group_service.dart';
import '../services/user_service.dart';

/// 群组详情页面
/// 显示群组信息、成员列表，支持群组管理功能
class GroupDetailsScreen extends StatefulWidget {
  final GroupModel group;

  const GroupDetailsScreen({
    Key? key,
    required this.group,
  }) : super(key: key);

  @override
  State<GroupDetailsScreen> createState() => _GroupDetailsScreenState();
}

class _GroupDetailsScreenState extends State<GroupDetailsScreen> {
  final AuthService _authService = AuthService();
  final GroupService _groupService = GroupService();
  final UserService _userService = UserService();
  
  late String _currentUserId;
  List<UserModel> _groupMembers = [];
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _initializeScreen();
  }

  /// 初始化页面
  void _initializeScreen() async {
    final currentUser = _authService.currentUser;
    if (currentUser != null) {
      _currentUserId = currentUser.uid;
      await _loadGroupMembers();
    }
  }

  /// 加载群组成员信息
  Future<void> _loadGroupMembers() async {
    setState(() {
      _isLoading = true;
    });

    try {
      final members = <UserModel>[];
      for (String userId in widget.group.participantIds) {
        final user = await _userService.getUserById(userId);
        if (user != null) {
          members.add(user);
        }
      }
      setState(() {
        _groupMembers = members;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('加载成员信息失败：${e.toString()}')),
        );
      }
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  /// 检查是否为管理员
  bool get _isAdmin {
    return widget.group.adminIds.contains(_currentUserId);
  }

  /// 检查是否为群主
  bool get _isOwner {
    // 简化处理：第一个管理员作为群主
    return widget.group.adminIds.isNotEmpty && widget.group.adminIds.first == _currentUserId;
  }

  /// 退出群组
  Future<void> _leaveGroup() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('退出群组'),
        content: Text('确定要退出群组"${widget.group.groupName}"吗？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('退出'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    setState(() {
      _isLoading = true;
    });

    try {
      await _groupService.removeGroupMember(
        groupId: widget.group.groupId,
        memberIdToRemove: _currentUserId,
        operatorId: _currentUserId,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('已退出群组"${widget.group.groupName}"'),
            backgroundColor: Colors.green,
          ),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('退出群组失败：${e.toString()}'),
            backgroundColor: Colors.red,
          ),
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

  /// 移除成员
  Future<void> _removeMember(UserModel member) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('移除成员'),
        content: Text('确定要移除成员"${member.displayName}"吗？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('移除'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    setState(() {
      _isLoading = true;
    });

    try {
      await _groupService.removeGroupMember(
        groupId: widget.group.groupId,
        memberIdToRemove: member.uid,
        operatorId: _currentUserId,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('已移除成员"${member.displayName}"'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('移除成员失败：${e.toString()}'),
            backgroundColor: Colors.red,
          ),
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

  /// 更改成员角色
  Future<void> _changeMemberRole(UserModel member) async {
    final isAdmin = widget.group.adminIds.contains(member.uid);
    final actionText = isAdmin ? '取消管理员' : '设为管理员';
    
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(actionText),
        content: Text('确定要${actionText}"${member.displayName}"吗？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text('确定'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    setState(() {
      _isLoading = true;
    });

    try {
      // 根据数据模型，通过adminIds管理角色，这里简化为添加/移除管理员权限
      if (widget.group.adminIds.contains(member.uid)) {
        // 移除管理员权限
        await _groupService.removeGroupAdmin(
          groupId: widget.group.groupId,
          adminIdToRemove: member.uid,
          operatorId: _currentUserId,
        );
      } else {
        // 添加管理员权限
        await _groupService.addGroupAdmin(
          groupId: widget.group.groupId,
          newAdminId: member.uid,
          operatorId: _currentUserId,
        );
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('已${actionText}"${member.displayName}"'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('${actionText}失败：${e.toString()}'),
            backgroundColor: Colors.red,
          ),
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

  /// 显示成员操作菜单
  void _showMemberActions(UserModel member) {
    if (member.uid == _currentUserId) return; // 不能对自己操作
    
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => Container(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              member.displayName,
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 20),
            if (_isOwner && member.uid != widget.group.adminIds.first) ...[
              ListTile(
                leading: Icon(
                  widget.group.adminIds.contains(member.uid) ? Icons.person : Icons.admin_panel_settings,
                  color: Theme.of(context).primaryColor,
                ),
                title: Text(
                  widget.group.adminIds.contains(member.uid) ? '取消管理员' : '设为管理员',
                ),
                onTap: () {
                  Navigator.pop(context);
                  _changeMemberRole(member);
                },
              ),
            ],
            if (_isAdmin && member.uid != widget.group.adminIds.first) ...[
              ListTile(
                leading: const Icon(Icons.remove_circle, color: Colors.red),
                title: const Text('移除成员', style: TextStyle(color: Colors.red)),
                onTap: () {
                  Navigator.pop(context);
                  _removeMember(member);
                },
              ),
            ],
            const SizedBox(height: 10),
          ],
        ),
      ),
    );
  }

  /// 获取成员角色文本
  String _getMemberRoleText(String userId) {
    if (widget.group.adminIds.isNotEmpty && widget.group.adminIds.first == userId) {
      return '群主';
    } else if (widget.group.adminIds.contains(userId)) {
      return '管理员';
    } else {
      return '成员';
    }
  }

  /// 获取成员角色颜色
  Color _getMemberRoleColor(String userId) {
    if (widget.group.adminIds.isNotEmpty && widget.group.adminIds.first == userId) {
      return Colors.orange;
    } else if (widget.group.adminIds.contains(userId)) {
      return Colors.blue;
    } else {
      return Colors.grey;
    }
  }

  /// 构建成员列表项
  Widget _buildMemberItem(UserModel member) {
    final isCurrentUser = member.uid == _currentUserId;
    
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: Theme.of(context).primaryColor,
          backgroundImage: member.photoUrl != null ? NetworkImage(member.photoUrl!) : null,
          child: member.photoUrl == null
              ? Text(
                  member.displayName.substring(0, 1).toUpperCase(),
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                )
              : null,
        ),
        title: Row(
          children: [
            Expanded(
              child: Text(
                member.displayName + (isCurrentUser ? ' (我)' : ''),
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: isCurrentUser ? Theme.of(context).primaryColor : null,
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: _getMemberRoleColor(member.uid).withOpacity(0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: _getMemberRoleColor(member.uid),
                  width: 1,
                ),
              ),
              child: Text(
                _getMemberRoleText(member.uid),
                style: TextStyle(
                  fontSize: 12,
                  color: _getMemberRoleColor(member.uid),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        subtitle: Text(
          '群组成员',
          style: TextStyle(
            color: Colors.grey[600],
            fontSize: 12,
          ),
        ),
        trailing: (!isCurrentUser && _isAdmin && member.uid != widget.group.adminIds.first)
            ? IconButton(
                icon: const Icon(Icons.more_vert),
                onPressed: () => _showMemberActions(member),
              )
            : null,
        onTap: () {
          if (!isCurrentUser && _isAdmin) {
            _showMemberActions(member);
          }
        },
      ),
    );
  }

  /// 格式化日期
  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final difference = now.difference(date);

    if (difference.inDays == 0) {
      return '今天';
    } else if (difference.inDays == 1) {
      return '昨天';
    } else if (difference.inDays < 7) {
      return '${difference.inDays}天前';
    } else {
      return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
    }
  }

  /// 构建群组信息卡片
  Widget _buildGroupInfoCard() {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            Theme.of(context).primaryColor,
            Theme.of(context).primaryColor.withOpacity(0.8),
          ],
        ),
        borderRadius: BorderRadius.circular(15),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          CircleAvatar(
            radius: 40,
            backgroundColor: Colors.white.withOpacity(0.2),
            backgroundImage: widget.group.groupIconUrl != null 
                ? NetworkImage(widget.group.groupIconUrl!) 
                : null,
            child: widget.group.groupIconUrl == null
                ? const Icon(
                    Icons.group,
                    color: Colors.white,
                    size: 40,
                  )
                : null,
          ),
          const SizedBox(height: 16),
          Text(
            widget.group.groupName,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
            textAlign: TextAlign.center,
          ),
          if (widget.group.description != null && widget.group.description!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              widget.group.description!,
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 16,
              ),
              textAlign: TextAlign.center,
            ),
          ],
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              Column(
                children: [
                  Text(
                    '${widget.group.participantIds.length}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const Text(
                    '成员',
                    style: TextStyle(
                      color: Colors.white70,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
              Column(
                children: [
                  Text(
                    _formatDate(widget.group.createdAt.toDate()),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const Text(
                    '创建时间',
                    style: TextStyle(
                      color: Colors.white70,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('群组详情'),
        backgroundColor: Theme.of(context).primaryColor,
        foregroundColor: Colors.white,
        elevation: 2,
        actions: [
          if (_isAdmin)
            PopupMenuButton<String>(
              onSelected: (value) {
                switch (value) {
                  case 'edit':
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('编辑群组功能即将推出')),
                    );
                    break;
                  case 'add_member':
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('添加成员功能即将推出')),
                    );
                    break;
                }
              },
              itemBuilder: (context) => [
                const PopupMenuItem(
                  value: 'edit',
                  child: Row(
                    children: [
                      Icon(Icons.edit),
                      SizedBox(width: 8),
                      Text('编辑群组'),
                    ],
                  ),
                ),
                const PopupMenuItem(
                  value: 'add_member',
                  child: Row(
                    children: [
                      Icon(Icons.person_add),
                      SizedBox(width: 8),
                      Text('添加成员'),
                    ],
                  ),
                ),
              ],
            ),
        ],
      ),
      body: Column(
        children: [
          // 群组信息卡片
          _buildGroupInfoCard(),

          // 成员列表标题
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Text(
                  '群组成员',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Colors.grey[800],
                  ),
                ),
                const Spacer(),
                if (_isAdmin)
                  TextButton.icon(
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('添加成员功能即将推出')),
                      );
                    },
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('添加', style: TextStyle(fontSize: 12)),
                  ),
              ],
            ),
          ),

          // 成员列表
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : ListView.builder(
                    itemCount: _groupMembers.length,
                    itemBuilder: (context, index) {
                      // 按角色排序：群主 > 管理员 > 成员
                      final sortedMembers = [..._groupMembers];
                      sortedMembers.sort((a, b) {
                        final aIsOwner = widget.group.adminIds.isNotEmpty && widget.group.adminIds.first == a.uid;
                        final bIsOwner = widget.group.adminIds.isNotEmpty && widget.group.adminIds.first == b.uid;
                        final aIsAdmin = widget.group.adminIds.contains(a.uid);
                        final bIsAdmin = widget.group.adminIds.contains(b.uid);

                        if (aIsOwner && !bIsOwner) return -1;
                        if (bIsOwner && !aIsOwner) return 1;
                        if (aIsAdmin && !bIsAdmin) return -1;
                        if (bIsAdmin && !aIsAdmin) return 1;
                        return a.displayName.compareTo(b.displayName);
                      });
                      
                      return _buildMemberItem(sortedMembers[index]);
                    },
            ),
          ),

          // 底部操作区域
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border(
                top: BorderSide(color: Colors.grey[300]!),
              ),
            ),
            child: SafeArea(
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _isLoading ? null : _leaveGroup,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.red,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                  child: _isLoading
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            color: Colors.white,
                            strokeWidth: 2,
                          ),
                        )
                      : Text(
                          _isOwner ? '解散群组' : '退出群组',
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
