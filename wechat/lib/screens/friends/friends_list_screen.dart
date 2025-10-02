import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/friend_model.dart';
import '../../models/user_model.dart';
import '../../services/auth_service.dart';
import '../../services/friend_service.dart';
import 'add_friend_screen.dart';
import 'friend_request_screen.dart';

/// 好友列表屏幕
class FriendsListScreen extends StatefulWidget {
  const FriendsListScreen({Key? key}) : super(key: key);

  @override
  State<FriendsListScreen> createState() => _FriendsListScreenState();
}

class _FriendsListScreenState extends State<FriendsListScreen> with SingleTickerProviderStateMixin {
  /// Tab控制器
  late TabController _tabController;
  
  /// 是否正在加载
  bool _isLoading = true;
  
  /// 好友列表
  List<String> _friends = [];
  
  /// 好友用户信息缓存
  final Map<String, UserModel?> _friendInfoCache = {};
  
  /// 待处理的好友请求数量
  int _pendingRequestsCount = 0;
  
  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadFriends();
    _checkPendingRequests();
  }
  
  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }
  
  /// 加载好友列表
  Future<void> _loadFriends() async {
    if (mounted) {
      setState(() {
        _isLoading = true;
      });
    }
    
    try {
      final authService = Provider.of<AuthService>(context, listen: false);
      final friendService = Provider.of<FriendService>(context, listen: false);
      
      final userId = authService.currentUser?.userId;
      if (userId == null) return;
      
      // 获取好友列表
      final friends = await friendService.getFriends(userId);
      
      // 预加载好友信息
      for (final friendId in friends) {
        if (!_friendInfoCache.containsKey(friendId)) {
          final userInfo = await authService.getUserInfo(friendId);
          _friendInfoCache[friendId] = userInfo;
        }
      }
      
      if (mounted) {
        setState(() {
          _friends = friends;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
        
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('加载好友列表失败: $e')),
        );
      }
    }
  }
  
  /// 检查待处理的好友请求
  Future<void> _checkPendingRequests() async {
    try {
      final authService = Provider.of<AuthService>(context, listen: false);
      final friendService = Provider.of<FriendService>(context, listen: false);
      
      final userId = authService.currentUser?.userId;
      if (userId == null) return;
      
      // 获取待处理的好友请求
      final pendingRequests = await friendService.getPendingFriendRequests(userId);
      
      if (mounted) {
        setState(() {
          _pendingRequestsCount = pendingRequests.length;
        });
      }
    } catch (e) {
      print('检查待处理好友请求失败: $e');
    }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('通讯录'),
        actions: [
          // 好友请求按钮
          Stack(
            alignment: Alignment.center,
            children: [
              IconButton(
                icon: Icon(Icons.person_add),
                onPressed: () async {
                  await Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => FriendRequestScreen(),
                    ),
                  );
                  // 刷新数据
                  _loadFriends();
                  _checkPendingRequests();
                },
              ),
              // 显示未读请求数量
              if (_pendingRequestsCount > 0)
                Positioned(
                  right: 8,
                  top: 8,
                  child: Container(
                    padding: EdgeInsets.all(2),
                    decoration: BoxDecoration(
                      color: Colors.red,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    constraints: BoxConstraints(
                      minWidth: 16,
                      minHeight: 16,
                    ),
                    child: Text(
                      _pendingRequestsCount.toString(),
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 10,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
            ],
          ),
          // 添加好友按钮
          IconButton(
            icon: Icon(Icons.person_search),
            onPressed: () async {
              await Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => AddFriendScreen(),
                ),
              );
              // 刷新好友列表
              _loadFriends();
            },
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: [
            Tab(text: '好友'),
            Tab(text: '群聊'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // 好友列表选项卡
          _buildFriendsList(),
          
          // 群聊列表选项卡 (暂未实现)
          Center(
            child: Text('群聊功能即将推出...'),
          ),
        ],
      ),
    );
  }
  
  /// 构建好友列表
  Widget _buildFriendsList() {
    if (_isLoading) {
      return Center(child: CircularProgressIndicator());
    }
    
    if (_friends.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.people_outline, size: 64, color: Colors.grey),
            SizedBox(height: 16),
            Text('暂无好友', style: TextStyle(color: Colors.grey)),
            SizedBox(height: 16),
            ElevatedButton(
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (context) => AddFriendScreen()),
                );
              },
              child: Text('添加好友'),
            ),
          ],
        ),
      );
    }
    
    // 好友按首字母分组
    final Map<String, List<String>> groupedFriends = {};
    for (final friendId in _friends) {
      final friendInfo = _friendInfoCache[friendId];
      final username = friendInfo?.username ?? friendId;
      final firstLetter = username.toUpperCase()[0];
      
      if (!groupedFriends.containsKey(firstLetter)) {
        groupedFriends[firstLetter] = [];
      }
      groupedFriends[firstLetter]!.add(friendId);
    }
    
    // 按字母顺序排序
    final sortedKeys = groupedFriends.keys.toList()..sort();
    
    return ListView.builder(
      itemCount: sortedKeys.length,
      itemBuilder: (context, index) {
        final letter = sortedKeys[index];
        final friendIds = groupedFriends[letter]!;
        
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 字母分组标题
            Container(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: Colors.grey.shade100,
              width: double.infinity,
              child: Text(
                letter,
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: Colors.grey.shade700,
                ),
              ),
            ),
            // 好友列表项
            ...friendIds.map((friendId) => _buildFriendItem(friendId)).toList(),
          ],
        );
      },
    );
  }
  
  /// 构建好友列表项
  Widget _buildFriendItem(String friendId) {
    final friendInfo = _friendInfoCache[friendId];
    final username = friendInfo?.username ?? friendId;
    final avatarUrl = friendInfo?.avatarUrl;
    
    return ListTile(
      leading: CircleAvatar(
        backgroundImage: avatarUrl != null ? NetworkImage(avatarUrl) : null,
        child: avatarUrl == null ? Text(username[0].toUpperCase()) : null,
      ),
      title: Text(username),
      onTap: () {
        // 跳转到聊天页面或好友详情页面
        _showFriendOptions(friendId, username);
      },
    );
  }
  
  /// 显示好友操作选项
  void _showFriendOptions(String friendId, String username) {
    showModalBottomSheet(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: Icon(Icons.chat),
                title: Text('发送消息'),
                onTap: () {
                  Navigator.pop(context);
                  // 跳转到聊天页面
                  Navigator.pushNamed(
                    context, 
                    '/chat/detail',
                    arguments: {'otherUserId': friendId},
                  );
                },
              ),
              ListTile(
                leading: Icon(Icons.person),
                title: Text('查看资料'),
                onTap: () {
                  Navigator.pop(context);
                  // 查看用户资料
                  // TODO: 实现查看用户资料页面
                },
              ),
              ListTile(
                leading: Icon(Icons.delete, color: Colors.red),
                title: Text('删除好友', style: TextStyle(color: Colors.red)),
                onTap: () {
                  Navigator.pop(context);
                  _showDeleteFriendConfirmation(friendId, username);
                },
              ),
            ],
          ),
        );
      },
    );
  }
  
  /// 显示删除好友确认对话框
  void _showDeleteFriendConfirmation(String friendId, String username) {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text('删除好友'),
          content: Text('确定要删除好友 "$username" 吗？删除后将无法接收对方的消息。'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text('取消'),
            ),
            TextButton(
              onPressed: () async {
                Navigator.pop(context);
                await _deleteFriend(friendId);
              },
              child: Text('删除', style: TextStyle(color: Colors.red)),
            ),
          ],
        );
      },
    );
  }
  
  /// 删除好友
  Future<void> _deleteFriend(String friendId) async {
    try {
      final authService = Provider.of<AuthService>(context, listen: false);
      final friendService = Provider.of<FriendService>(context, listen: false);
      
      final userId = authService.currentUser?.userId;
      if (userId == null) return;
      
      final success = await friendService.removeFriend(userId, friendId);
      
      if (success) {
        // 刷新好友列表
        _loadFriends();
        
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('好友已删除')),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('删除好友失败')),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('删除好友出错: $e')),
      );
    }
  }
}
