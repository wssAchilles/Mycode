import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/friend_model.dart';
import '../../models/user_model.dart';
import '../../services/auth_service.dart';
import '../../services/friend_service.dart';

/// 好友请求屏幕
class FriendRequestScreen extends StatefulWidget {
  const FriendRequestScreen({Key? key}) : super(key: key);

  @override
  State<FriendRequestScreen> createState() => _FriendRequestScreenState();
}

class _FriendRequestScreenState extends State<FriendRequestScreen> with SingleTickerProviderStateMixin {
  /// Tab控制器
  late TabController _tabController;
  
  /// 是否正在加载
  bool _isLoading = true;
  
  /// 收到的好友请求
  List<FriendRequestModel> _receivedRequests = [];
  
  /// 发送的好友请求
  List<FriendRequestModel> _sentRequests = [];
  
  /// 用户信息缓存
  final Map<String, UserModel?> _userInfoCache = {};
  
  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadFriendRequests();
  }
  
  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }
  
  /// 加载好友请求
  Future<void> _loadFriendRequests() async {
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
      
      // 获取收到的好友请求
      final receivedRequests = await friendService.getFriendRequests(userId, received: true);
      
      // 获取发送的好友请求
      final sentRequests = await friendService.getFriendRequests(userId, received: false);
      
      // 预加载用户信息
      final allUserIds = <String>{};
      for (final request in receivedRequests) {
        allUserIds.add(request.senderId);
      }
      for (final request in sentRequests) {
        allUserIds.add(request.receiverId);
      }
      
      for (final userId in allUserIds) {
        if (!_userInfoCache.containsKey(userId)) {
          final userInfo = await authService.getUserInfo(userId);
          _userInfoCache[userId] = userInfo;
        }
      }
      
      if (mounted) {
        setState(() {
          _receivedRequests = receivedRequests;
          _sentRequests = sentRequests;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
        
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('加载好友请求失败: $e')),
        );
      }
    }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('好友请求'),
        bottom: TabBar(
          controller: _tabController,
          tabs: [
            Tab(
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('收到的请求'),
                  SizedBox(width: 8),
                  if (_receivedRequests.any((req) => req.status == FriendRequestStatus.pending))
                    Container(
                      padding: EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        color: Colors.red,
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        _receivedRequests.where((req) => req.status == FriendRequestStatus.pending).length.toString(),
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 10,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Tab(text: '发送的请求'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // 收到的好友请求
          _buildRequestsList(_receivedRequests, isReceived: true),
          
          // 发送的好友请求
          _buildRequestsList(_sentRequests, isReceived: false),
        ],
      ),
    );
  }
  
  /// 构建请求列表
  Widget _buildRequestsList(List<FriendRequestModel> requests, {required bool isReceived}) {
    if (_isLoading) {
      return Center(child: CircularProgressIndicator());
    }
    
    if (requests.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.person_outline, size: 64, color: Colors.grey),
            SizedBox(height: 16),
            Text(
              isReceived ? '暂无收到的好友请求' : '暂无发送的好友请求',
              style: TextStyle(color: Colors.grey),
            ),
          ],
        ),
      );
    }
    
    // 按状态和时间排序
    final sortedRequests = List<FriendRequestModel>.from(requests);
    sortedRequests.sort((a, b) {
      // 首先按状态排序：未处理的在前面
      if (a.status == FriendRequestStatus.pending && b.status != FriendRequestStatus.pending) {
        return -1;
      }
      if (a.status != FriendRequestStatus.pending && b.status == FriendRequestStatus.pending) {
        return 1;
      }
      // 然后按时间排序：新的在前面
      return b.updatedAt.compareTo(a.updatedAt);
    });
    
    return ListView.builder(
      itemCount: sortedRequests.length,
      itemBuilder: (context, index) {
        final request = sortedRequests[index];
        return _buildRequestItem(request, isReceived);
      },
    );
  }
  
  /// 构建请求项
  Widget _buildRequestItem(FriendRequestModel request, bool isReceived) {
    // 获取对方ID
    final otherUserId = isReceived ? request.senderId : request.receiverId;
    final otherUser = _userInfoCache[otherUserId];
    final username = otherUser?.username ?? otherUserId;
    final avatarUrl = otherUser?.avatarUrl;
    
    // 请求状态标签
    Widget statusTag;
    Color? itemColor;
    
    switch (request.status) {
      case FriendRequestStatus.pending:
        statusTag = Container(
          padding: EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: Colors.orange,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(
            '待处理',
            style: TextStyle(color: Colors.white, fontSize: 12),
          ),
        );
        itemColor = Colors.orange.withOpacity(0.05);
        break;
      case FriendRequestStatus.accepted:
        statusTag = Container(
          padding: EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: Colors.green,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(
            '已接受',
            style: TextStyle(color: Colors.white, fontSize: 12),
          ),
        );
        break;
      case FriendRequestStatus.rejected:
        statusTag = Container(
          padding: EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: Colors.red,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(
            '已拒绝',
            style: TextStyle(color: Colors.white, fontSize: 12),
          ),
        );
        break;
    }
    
    // 格式化时间
    final createdAt = request.createdAt;
    final formattedDate = '${createdAt.year}-${createdAt.month.toString().padLeft(2, '0')}-${createdAt.day.toString().padLeft(2, '0')}';
    final formattedTime = '${createdAt.hour.toString().padLeft(2, '0')}:${createdAt.minute.toString().padLeft(2, '0')}';
    
    return Container(
      color: itemColor,
      child: Column(
        children: [
          ListTile(
            leading: CircleAvatar(
              backgroundImage: avatarUrl != null ? NetworkImage(avatarUrl) : null,
              child: avatarUrl == null ? Text(username[0].toUpperCase()) : null,
            ),
            title: Text(username),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (request.message != null && request.message!.isNotEmpty)
                  Text(request.message!),
                Text(
                  '$formattedDate $formattedTime',
                  style: TextStyle(fontSize: 12, color: Colors.grey),
                ),
              ],
            ),
            trailing: statusTag,
          ),
          
          // 操作按钮（仅对收到的待处理请求显示）
          if (isReceived && request.status == FriendRequestStatus.pending)
            Padding(
              padding: EdgeInsets.only(left: 16, right: 16, bottom: 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  // 拒绝按钮
                  OutlinedButton(
                    onPressed: () => _respondToFriendRequest(request.requestId, false),
                    child: Text('拒绝'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.red,
                      side: BorderSide(color: Colors.red),
                    ),
                  ),
                  SizedBox(width: 8),
                  // 接受按钮
                  ElevatedButton(
                    onPressed: () => _respondToFriendRequest(request.requestId, true),
                    child: Text('接受'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green,
                      foregroundColor: Colors.white,
                    ),
                  ),
                ],
              ),
            ),
          
          Divider(height: 1),
        ],
      ),
    );
  }
  
  /// 处理好友请求
  Future<void> _respondToFriendRequest(String requestId, bool accept) async {
    try {
      final authService = Provider.of<AuthService>(context, listen: false);
      final friendService = Provider.of<FriendService>(context, listen: false);
      
      final userId = authService.currentUser?.userId;
      if (userId == null) return;
      
      bool success;
      if (accept) {
        success = await friendService.acceptFriendRequest(requestId, userId);
      } else {
        success = await friendService.rejectFriendRequest(requestId, userId);
      }
      
      if (success) {
        // 刷新列表
        await _loadFriendRequests();
        
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(accept ? '已接受好友请求' : '已拒绝好友请求')),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('处理好友请求失败')),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('处理好友请求出错: $e')),
      );
    }
  }
}
