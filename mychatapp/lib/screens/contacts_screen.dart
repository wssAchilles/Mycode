import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../models/models.dart';
import '../services/friend_service.dart';
import '../services/auth_service.dart';
import 'chat_screen.dart';
import 'add_friend_screen.dart';
import 'friend_requests_screen.dart';

/// 联系人页面
/// 
/// 显示用户的好友列表，支持：
/// - 查看所有好友
/// - 直接进入聊天
/// - 添加新好友
/// - 管理好友请求
class ContactsScreen extends StatefulWidget {
  const ContactsScreen({super.key});

  @override
  State<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<ContactsScreen> {
  final FriendService _friendService = FriendService();
  final AuthService _authService = AuthService();
  String? _currentUserId;

  @override
  void initState() {
    super.initState();
    _getCurrentUser();
  }

  void _getCurrentUser() {
    final user = FirebaseAuth.instance.currentUser;
    if (user != null) {
      setState(() {
        _currentUserId = user.uid;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_currentUserId == null) {
      return const Scaffold(
        body: Center(
          child: CircularProgressIndicator(),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('联系人'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
        actions: [
          // 好友请求按钮
          StreamBuilder<List<FriendRequestModel>>(
            stream: _friendService.getReceivedRequestsStream(_currentUserId!),
            builder: (context, snapshot) {
              final requestCount = snapshot.hasData ? snapshot.data!.length : 0;
              return Stack(
                children: [
                  IconButton(
                    icon: const Icon(Icons.person_add_alt_1),
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (context) => const FriendRequestsScreen(),
                        ),
                      );
                    },
                  ),
                  if (requestCount > 0)
                    Positioned(
                      right: 8,
                      top: 8,
                      child: Container(
                        padding: const EdgeInsets.all(2),
                        decoration: BoxDecoration(
                          color: Colors.red,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        constraints: const BoxConstraints(
                          minWidth: 16,
                          minHeight: 16,
                        ),
                        child: Text(
                          '$requestCount',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ),
                ],
              );
            },
          ),
          // 添加好友按钮
          IconButton(
            icon: const Icon(Icons.person_add),
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (context) => const AddFriendScreen(),
                ),
              );
            },
          ),
        ],
      ),
      body: StreamBuilder<List<UserModel>>(
        stream: _friendService.getFriendsStream(_currentUserId!),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(
              child: CircularProgressIndicator(),
            );
          }

          if (snapshot.hasError) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(
                    Icons.error_outline,
                    size: 64,
                    color: Colors.grey,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    '加载好友列表失败',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '请检查网络连接后重试',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Colors.grey[600],
                    ),
                  ),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () {
                      setState(() {});
                    },
                    child: const Text('重试'),
                  ),
                ],
              ),
            );
          }

          final friends = snapshot.data ?? [];

          if (friends.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(
                    Icons.people_outline,
                    size: 64,
                    color: Colors.grey,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    '还没有好友',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '点击右上角添加好友开始聊天吧',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Colors.grey[600],
                    ),
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton.icon(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (context) => const AddFriendScreen(),
                        ),
                      );
                    },
                    icon: const Icon(Icons.person_add),
                    label: const Text('添加好友'),
                  ),
                ],
              ),
            );
          }

          return ListView.builder(
            itemCount: friends.length,
            padding: const EdgeInsets.symmetric(vertical: 8),
            itemBuilder: (context, index) {
              final friend = friends[index];
              return _buildFriendTile(friend);
            },
          );
        },
      ),
    );
  }

  /// 构建好友列表项
  Widget _buildFriendTile(UserModel friend) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: CircleAvatar(
          radius: 24,
          backgroundColor: Colors.blue.shade100,
          backgroundImage: friend.photoUrl != null
              ? NetworkImage(friend.photoUrl!)
              : null,
          child: friend.photoUrl == null
              ? Text(
                  _getInitials(friend.displayName),
                  style: TextStyle(
                    color: Colors.blue.shade800,
                    fontWeight: FontWeight.bold,
                  ),
                )
              : null,
        ),
        title: Text(
          friend.displayName,
          style: const TextStyle(
            fontWeight: FontWeight.w600,
            fontSize: 16,
          ),
        ),
        subtitle: Text(
          friend.email,
          style: TextStyle(
            color: Colors.grey[600],
            fontSize: 14,
          ),
        ),
        trailing: PopupMenuButton<String>(
          icon: const Icon(Icons.more_vert),
          onSelected: (value) {
            switch (value) {
              case 'chat':
                _startChat(friend);
                break;
              case 'remove':
                _showRemoveFriendDialog(friend);
                break;
            }
          },
          itemBuilder: (context) => [
            const PopupMenuItem(
              value: 'chat',
              child: ListTile(
                leading: Icon(Icons.chat),
                title: Text('发送消息'),
                contentPadding: EdgeInsets.zero,
              ),
            ),
            const PopupMenuItem(
              value: 'remove',
              child: ListTile(
                leading: Icon(Icons.person_remove, color: Colors.red),
                title: Text('删除好友', style: TextStyle(color: Colors.red)),
                contentPadding: EdgeInsets.zero,
              ),
            ),
          ],
        ),
        onTap: () => _startChat(friend),
      ),
    );
  }

  /// 获取用户名首字母
  String _getInitials(String name) {
    if (name.isEmpty) return '?';
    final names = name.trim().split(' ');
    if (names.length == 1) {
      return names[0][0].toUpperCase();
    } else {
      return '${names[0][0]}${names[names.length - 1][0]}'.toUpperCase();
    }
  }

  /// 开始聊天
  void _startChat(UserModel friend) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => ChatScreen(
          otherUser: friend,
        ),
      ),
    );
  }

  /// 显示删除好友确认对话框
  void _showRemoveFriendDialog(UserModel friend) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('删除好友'),
        content: Text('确定要删除好友"${friend.displayName}"吗？\n\n删除后将无法直接聊天，需要重新添加好友。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () async {
              Navigator.of(context).pop();
              await _removeFriend(friend);
            },
            style: TextButton.styleFrom(
              foregroundColor: Colors.red,
            ),
            child: const Text('删除'),
          ),
        ],
      ),
    );
  }

  /// 删除好友
  Future<void> _removeFriend(UserModel friend) async {
    try {
      // 显示加载对话框
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (context) => const AlertDialog(
          content: Row(
            children: [
              CircularProgressIndicator(),
              SizedBox(width: 20),
              Text('正在删除好友...'),
            ],
          ),
        ),
      );

      await _friendService.removeFriend(
        currentUserId: _currentUserId!,
        friendId: friend.uid,
      );

      // 关闭加载对话框
      if (mounted) Navigator.of(context).pop();

      // 显示成功消息
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('已删除好友"${friend.displayName}"'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      // 关闭加载对话框
      if (mounted) Navigator.of(context).pop();

      // 显示错误消息
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('删除好友失败：${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }
}
