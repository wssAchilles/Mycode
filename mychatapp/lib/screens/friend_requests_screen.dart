import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/models.dart';
import '../services/friend_service.dart';
import '../services/user_service.dart';

/// 好友请求页面
/// 
/// 显示收到和发送的好友请求，支持接受、拒绝操作
class FriendRequestsScreen extends StatefulWidget {
  const FriendRequestsScreen({super.key});

  @override
  State<FriendRequestsScreen> createState() => _FriendRequestsScreenState();
}

class _FriendRequestsScreenState extends State<FriendRequestsScreen>
    with SingleTickerProviderStateMixin {
  final FriendService _friendService = FriendService();
  final UserService _userService = UserService();
  late TabController _tabController;
  String? _currentUserId;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
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
  void dispose() {
    _tabController.dispose();
    super.dispose();
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
        title: const Text('好友请求'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(
              icon: Icon(Icons.inbox),
              text: '收到的请求',
            ),
            Tab(
              icon: Icon(Icons.send),
              text: '发送的请求',
            ),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildReceivedRequests(),
          _buildSentRequests(),
        ],
      ),
    );
  }

  /// 构建收到的请求页面
  Widget _buildReceivedRequests() {
    return StreamBuilder<List<FriendRequestModel>>(
      stream: _friendService.getReceivedRequestsStream(_currentUserId!),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(
            child: CircularProgressIndicator(),
          );
        }

        if (snapshot.hasError) {
          return _buildErrorWidget('加载请求失败');
        }

        final requests = snapshot.data ?? [];

        if (requests.isEmpty) {
          return _buildEmptyWidget(
            icon: Icons.inbox_outlined,
            title: '暂无收到的请求',
            subtitle: '当有人向你发送好友请求时，会在这里显示',
          );
        }

        return ListView.builder(
          itemCount: requests.length,
          padding: const EdgeInsets.symmetric(vertical: 8),
          itemBuilder: (context, index) {
            final request = requests[index];
            return _buildReceivedRequestTile(request);
          },
        );
      },
    );
  }

  /// 构建发送的请求页面
  Widget _buildSentRequests() {
    return StreamBuilder<List<FriendRequestModel>>(
      stream: _friendService.getSentRequestsStream(_currentUserId!),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(
            child: CircularProgressIndicator(),
          );
        }

        if (snapshot.hasError) {
          return _buildErrorWidget('加载请求失败');
        }

        final requests = snapshot.data ?? [];

        if (requests.isEmpty) {
          return _buildEmptyWidget(
            icon: Icons.send_outlined,
            title: '暂无发送的请求',
            subtitle: '你发送的好友请求会在这里显示',
          );
        }

        return ListView.builder(
          itemCount: requests.length,
          padding: const EdgeInsets.symmetric(vertical: 8),
          itemBuilder: (context, index) {
            final request = requests[index];
            return _buildSentRequestTile(request);
          },
        );
      },
    );
  }

  /// 构建收到的请求列表项
  Widget _buildReceivedRequestTile(FriendRequestModel request) {
    return FutureBuilder<UserModel?>(
      future: _userService.getUserById(request.senderId),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Card(
            margin: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ListTile(
              leading: CircleAvatar(
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              title: Text('加载中...'),
            ),
          );
        }

        final sender = snapshot.data;
        if (sender == null) {
          return const Card(
            margin: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: Colors.grey,
                child: Icon(Icons.person, color: Colors.white),
              ),
              title: Text('用户不存在'),
              subtitle: Text('此用户可能已删除账户'),
            ),
          );
        }

        return Card(
          margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: CircleAvatar(
              radius: 24,
              backgroundColor: Colors.blue.shade100,
              backgroundImage: sender.photoUrl != null
                  ? NetworkImage(sender.photoUrl!)
                  : null,
              child: sender.photoUrl == null
                  ? Text(
                      _getInitials(sender.displayName),
                      style: TextStyle(
                        color: Colors.blue.shade800,
                        fontWeight: FontWeight.bold,
                      ),
                    )
                  : null,
            ),
            title: Text(
              sender.displayName,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 16,
              ),
            ),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  sender.email,
                  style: TextStyle(
                    color: Colors.grey[600],
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '发送时间：${_formatDateTime(request.createdAt)}',
                  style: TextStyle(
                    color: Colors.grey[500],
                    fontSize: 12,
                  ),
                ),
              ],
            ),
            trailing: request.isPending
                ? Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      TextButton(
                        onPressed: () => _declineRequest(request),
                        style: TextButton.styleFrom(
                          foregroundColor: Colors.red,
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                        ),
                        child: const Text('拒绝'),
                      ),
                      const SizedBox(width: 8),
                      ElevatedButton(
                        onPressed: () => _acceptRequest(request),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.green,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                        ),
                        child: const Text('接受'),
                      ),
                    ],
                  )
                : _buildStatusChip(request.status),
          ),
        );
      },
    );
  }

  /// 构建发送的请求列表项
  Widget _buildSentRequestTile(FriendRequestModel request) {
    return FutureBuilder<UserModel?>(
      future: _userService.getUserById(request.receiverId),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Card(
            margin: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ListTile(
              leading: CircleAvatar(
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              title: Text('加载中...'),
            ),
          );
        }

        final receiver = snapshot.data;
        if (receiver == null) {
          return const Card(
            margin: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: Colors.grey,
                child: Icon(Icons.person, color: Colors.white),
              ),
              title: Text('用户不存在'),
              subtitle: Text('此用户可能已删除账户'),
            ),
          );
        }

        return Card(
          margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: CircleAvatar(
              radius: 24,
              backgroundColor: Colors.blue.shade100,
              backgroundImage: receiver.photoUrl != null
                  ? NetworkImage(receiver.photoUrl!)
                  : null,
              child: receiver.photoUrl == null
                  ? Text(
                      _getInitials(receiver.displayName),
                      style: TextStyle(
                        color: Colors.blue.shade800,
                        fontWeight: FontWeight.bold,
                      ),
                    )
                  : null,
            ),
            title: Text(
              receiver.displayName,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 16,
              ),
            ),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  receiver.email,
                  style: TextStyle(
                    color: Colors.grey[600],
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '发送时间：${_formatDateTime(request.createdAt)}',
                  style: TextStyle(
                    color: Colors.grey[500],
                    fontSize: 12,
                  ),
                ),
              ],
            ),
            trailing: _buildStatusChip(request.status),
          ),
        );
      },
    );
  }

  /// 构建状态标签
  Widget _buildStatusChip(FriendRequestStatus status) {
    Color backgroundColor;
    Color textColor;
    String text;

    switch (status) {
      case FriendRequestStatus.pending:
        backgroundColor = Colors.orange[100]!;
        textColor = Colors.orange[700]!;
        text = '待处理';
        break;
      case FriendRequestStatus.accepted:
        backgroundColor = Colors.green[100]!;
        textColor = Colors.green[700]!;
        text = '已接受';
        break;
      case FriendRequestStatus.declined:
        backgroundColor = Colors.red[100]!;
        textColor = Colors.red[700]!;
        text = '已拒绝';
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 12,
          color: textColor,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }

  /// 构建空状态组件
  Widget _buildEmptyWidget({
    required IconData icon,
    required String title,
    required String subtitle,
  }) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            icon,
            size: 64,
            color: Colors.grey[400],
          ),
          const SizedBox(height: 16),
          Text(
            title,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
              color: Colors.grey[600],
            ),
          ),
          const SizedBox(height: 8),
          Text(
            subtitle,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: Colors.grey[500],
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  /// 构建错误组件
  Widget _buildErrorWidget(String message) {
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
            message,
            style: Theme.of(context).textTheme.titleLarge,
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

  /// 格式化日期时间
  String _formatDateTime(Timestamp timestamp) {
    final dateTime = timestamp.toDate();
    final now = DateTime.now();
    final difference = now.difference(dateTime);

    if (difference.inDays > 0) {
      return '${difference.inDays}天前';
    } else if (difference.inHours > 0) {
      return '${difference.inHours}小时前';
    } else if (difference.inMinutes > 0) {
      return '${difference.inMinutes}分钟前';
    } else {
      return '刚刚';
    }
  }

  /// 接受好友请求
  Future<void> _acceptRequest(FriendRequestModel request) async {
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
              Text('正在接受好友请求...'),
            ],
          ),
        ),
      );

      await _friendService.acceptFriendRequest(
        requestId: request.requestId,
        currentUserId: _currentUserId!,
      );

      // 关闭加载对话框
      if (mounted) Navigator.of(context).pop();

      // 显示成功消息
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('已接受好友请求'),
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
            content: Text('接受好友请求失败：${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  /// 拒绝好友请求
  Future<void> _declineRequest(FriendRequestModel request) async {
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
              Text('正在拒绝好友请求...'),
            ],
          ),
        ),
      );

      await _friendService.declineFriendRequest(
        requestId: request.requestId,
        currentUserId: _currentUserId!,
      );

      // 关闭加载对话框
      if (mounted) Navigator.of(context).pop();

      // 显示成功消息
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('已拒绝好友请求'),
            backgroundColor: Colors.orange,
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
            content: Text('拒绝好友请求失败：${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }
}
