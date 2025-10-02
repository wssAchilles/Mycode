import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../models/models.dart';
import '../services/auth_service.dart';
import '../services/user_service.dart';
import '../services/chat_service.dart';
import '../services/group_service.dart';
import 'chat_screen.dart';
import 'group_chat_screen.dart';
import 'create_group_screen.dart';
import 'profile_screen.dart';

/// 主页面
/// 登录后的首页，包含私聊、群聊和联系人三个Tab
/// 支持查看会话列表、群组列表和用户列表
class HomeScreen extends StatefulWidget {
  const HomeScreen({Key? key}) : super(key: key);

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with TickerProviderStateMixin {
  final AuthService _authService = AuthService();
  final UserService _userService = UserService();
  final ChatService _chatService = ChatService();
  final GroupService _groupService = GroupService();
  final TextEditingController _searchController = TextEditingController();
  
  late TabController _tabController;
  String _searchQuery = '';
  UserModel? _currentUserModel;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _loadCurrentUserModel();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  /// 加载当前用户模型
  Future<void> _loadCurrentUserModel() async {
    try {
      UserModel? userModel = await _authService.getCurrentUserModel();
      if (mounted) {
        setState(() {
          _currentUserModel = userModel;
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('加载用户信息失败：${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  /// 处理登出
  Future<void> _handleSignOut() async {
    try {
      await _authService.signOut();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('已安全登出'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('登出失败：${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  /// 导航到私聊页面
  void _navigateToChat(UserModel otherUser) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => ChatScreen(
          otherUser: otherUser,
        ),
      ),
    );
  }

  /// 导航到群聊页面
  void _navigateToGroupChat(GroupModel group) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => GroupChatScreen(
          group: group,
        ),
      ),
    );
  }

  /// 导航到创建群组页面
  void _navigateToCreateGroup() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => CreateGroupScreen(),
      ),
    );
  }

  /// 导航到个人资料页面
  void _navigateToProfile() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => const ProfileScreen(),
      ),
    );
  }

  /// 搜索变化处理
  void _onSearchChanged(String query) {
    setState(() {
      _searchQuery = query;
    });
  }

  /// 构建用户列表项
  Widget _buildUserListItem(UserModel user) {
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
          style: const TextStyle(
            fontWeight: FontWeight.w600,
          ),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              user.email,
              style: TextStyle(
                color: Colors.grey[600],
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              '加入时间：${_formatDate(user.createdAt.toDate())}',
              style: TextStyle(
                color: Colors.grey[500],
                fontSize: 11,
              ),
            ),
          ],
        ),
        trailing: Icon(
          Icons.chat_bubble_outline,
          color: Theme.of(context).primaryColor,
        ),
        onTap: () => _navigateToChat(user),
      ),
    );
  }

  /// 构建群组列表项
  Widget _buildGroupListItem(GroupModel group) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: Theme.of(context).primaryColor,
          backgroundImage: group.groupIconUrl != null ? NetworkImage(group.groupIconUrl!) : null,
          child: group.groupIconUrl == null
              ? const Icon(
                  Icons.group,
                  color: Colors.white,
                )
              : null,
        ),
        title: Text(
          group.groupName,
          style: const TextStyle(
            fontWeight: FontWeight.w600,
          ),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (group.description != null && group.description!.isNotEmpty)
              Text(
                group.description!,
                style: TextStyle(
                  color: Colors.grey[600],
                  fontSize: 12,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            const SizedBox(height: 2),
            Text(
              '${group.participantIds.length} 成员',
              style: TextStyle(
                color: Colors.grey[500],
                fontSize: 11,
              ),
            ),
          ],
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.group_outlined,
              color: Theme.of(context).primaryColor,
            ),
            Text(
                '群组',
                style: TextStyle(
                  color: Colors.grey[400],
                  fontSize: 10,
                ),
              ),
          ],
        ),
        onTap: () => _navigateToGroupChat(group),
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

  /// 格式化时间（用于消息时间）
  String _formatTime(DateTime date) {
    final now = DateTime.now();
    final difference = now.difference(date);
    
    if (difference.inDays == 0) {
      return '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
    } else if (difference.inDays == 1) {
      return '昨天';
    } else if (difference.inDays < 7) {
      return '${difference.inDays}天前';
    } else {
      return '${date.month}/${date.day}';
    }
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
        title: const Text('MyChatApp'),
        backgroundColor: Theme.of(context).primaryColor,
        foregroundColor: Colors.white,
        elevation: 2,
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: Colors.white,
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white70,
          tabs: const [
            Tab(icon: Icon(Icons.chat), text: '会话'),
            Tab(icon: Icon(Icons.group), text: '群聊'),
            Tab(icon: Icon(Icons.contacts), text: '联系人'),
          ],
        ),
        actions: [
          // 刷新按钮
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadCurrentUserModel,
            tooltip: '刷新',
          ),
          // 用户菜单
          PopupMenuButton<String>(
            icon: CircleAvatar(
              radius: 16,
              backgroundColor: Colors.white,
              backgroundImage: _currentUserModel?.photoUrl != null 
                  ? NetworkImage(_currentUserModel!.photoUrl!) 
                  : null,
              child: _currentUserModel?.photoUrl == null
                  ? Text(
                      (_currentUserModel?.displayName ?? 'U').substring(0, 1).toUpperCase(),
                      style: TextStyle(
                        color: Theme.of(context).primaryColor,
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                      ),
                    )
                  : null,
            ),
            onSelected: (value) {
              switch (value) {
                case 'profile':
                  _navigateToProfile();
                  break;
                case 'create_group':
                  _navigateToCreateGroup();
                  break;
                case 'logout':
                  _handleSignOut();
                  break;
              }
            },
            itemBuilder: (context) => [
              PopupMenuItem(
                value: 'profile',
                child: Row(
                  children: [
                    const Icon(Icons.person),
                    const SizedBox(width: 8),
                    Text('个人资料'),
                  ],
                ),
              ),
              PopupMenuItem(
                value: 'create_group',
                child: Row(
                  children: [
                    const Icon(Icons.group_add),
                    const SizedBox(width: 8),
                    Text('创建群组'),
                  ],
                ),
              ),
              const PopupMenuDivider(),
              PopupMenuItem(
                value: 'logout',
                child: Row(
                  children: [
                    const Icon(Icons.logout, color: Colors.red),
                    const SizedBox(width: 8),
                    const Text('退出登录', style: TextStyle(color: Colors.red)),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildChatsTab(currentUser.uid),
          _buildGroupsTab(currentUser.uid),
          _buildContactsTab(currentUser.uid),
        ],
      ),
    );
  }

  /// 构建会话Tab内容
  Widget _buildChatsTab(String currentUserId) {
    return Column(
      children: [
        // 搜索框
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: TextField(
            controller: _searchController,
            onChanged: _onSearchChanged,
            decoration: InputDecoration(
              hintText: '搜索会话...',
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
        // 会话列表
        Expanded(
          child: StreamBuilder<List<ChatRoomModel>>(
            stream: _chatService.getChatRoomsStream(currentUserId),
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
                      Text('加载会话失败', style: TextStyle(fontSize: 16, color: Colors.grey[600])),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: () => setState(() {}),
                        child: const Text('重试'),
                      ),
                    ],
                  ),
                );
              }

              final chatRooms = snapshot.data ?? [];
              
              if (chatRooms.isEmpty) {
                return Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.chat_bubble_outline, size: 64, color: Colors.grey[400]),
                      const SizedBox(height: 16),
                      Text('暂无会话', style: TextStyle(fontSize: 16, color: Colors.grey[600])),
                      const SizedBox(height: 8),
                      Text('开始和朋友聊天吧！', style: TextStyle(fontSize: 14, color: Colors.grey[500])),
                    ],
                  ),
                );
              }

              return ListView.builder(
                itemCount: chatRooms.length,
                itemBuilder: (context, index) => _buildChatRoomItem(chatRooms[index]),
              );
            },
          ),
        ),
      ],
    );
  }

  /// 构建群组Tab内容
  Widget _buildGroupsTab(String currentUserId) {
    return Column(
      children: [
        // 搜索框
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: TextField(
            controller: _searchController,
            onChanged: _onSearchChanged,
            decoration: InputDecoration(
              hintText: '搜索群组...',
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
        // 群组列表
        Expanded(
          child: StreamBuilder<List<GroupModel>>(
            stream: _groupService.getUserGroups(currentUserId),
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
                      Text('加载群组失败', style: TextStyle(fontSize: 16, color: Colors.grey[600])),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: () => setState(() {}),
                        child: const Text('重试'),
                      ),
                    ],
                  ),
                );
              }

              final groups = snapshot.data ?? [];
              
              if (groups.isEmpty) {
                return Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.group_outlined, size: 64, color: Colors.grey[400]),
                      const SizedBox(height: 16),
                      Text('暂无群组', style: TextStyle(fontSize: 16, color: Colors.grey[600])),
                      const SizedBox(height: 8),
                      Text('创建或加入群组开始群聊！', style: TextStyle(fontSize: 14, color: Colors.grey[500])),
                      const SizedBox(height: 16),
                      ElevatedButton.icon(
                        onPressed: _navigateToCreateGroup,
                        icon: const Icon(Icons.add),
                        label: const Text('创建群组'),
                      ),
                    ],
                  ),
                );
              }

              return ListView.builder(
                itemCount: groups.length,
                itemBuilder: (context, index) => _buildGroupListItem(groups[index]),
              );
            },
          ),
        ),
      ],
    );
  }

  /// 构建联系人Tab内容
  Widget _buildContactsTab(String currentUserId) {
    return Column(
      children: [
        // 用户信息卡片
        if (_currentUserModel != null)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.all(16),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  Theme.of(context).primaryColor,
                  Theme.of(context).primaryColor.withOpacity(0.8),
                ],
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '欢迎回来，${_currentUserModel!.displayName}！',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _currentUserModel!.email,
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
          ),

        // 搜索框
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
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
        
        // 联系人列表
        Expanded(
          child: StreamBuilder<List<UserModel>>(
            stream: _searchQuery.isEmpty
                ? _userService.getAllUsersExceptCurrentStream(currentUserId)
                : _userService.searchUsersStream(_searchQuery, currentUserId),
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
                      Text('加载联系人失败', style: TextStyle(fontSize: 16, color: Colors.grey[600])),
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
    );
  }

  /// 构建聊天室列表项
  Widget _buildChatRoomItem(ChatRoomModel chatRoom) {
    // TODO: 需要根据chatRoom获取对方用户信息来显示
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: Theme.of(context).primaryColor,
          child: const Icon(Icons.chat, color: Colors.white),
        ),
        title: Text(
          '聊天室 ${chatRoom.chatRoomId}',
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          (chatRoom.lastMessage?.isEmpty ?? true) ? '暂无消息' : chatRoom.lastMessage!,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: chatRoom.lastMessageTimestamp != null
            ? Text(
                _formatTime(chatRoom.lastMessageTimestamp!.toDate()),
                style: TextStyle(color: Colors.grey[500], fontSize: 12),
              )
            : null,
        onTap: () {
          // TODO: 导航到聊天界面
        },
      ),
    );
  }
}
