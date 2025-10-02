import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/user_model.dart';
import '../../models/friend_model.dart';
import '../../services/auth_service.dart';
import '../../services/friend_service.dart';

/// 添加好友屏幕
class AddFriendScreen extends StatefulWidget {
  const AddFriendScreen({Key? key}) : super(key: key);

  @override
  State<AddFriendScreen> createState() => _AddFriendScreenState();
}

class _AddFriendScreenState extends State<AddFriendScreen> {
  /// 搜索控制器
  final TextEditingController _searchController = TextEditingController();
  
  /// 是否正在搜索
  bool _isSearching = false;
  
  /// 搜索到的用户
  UserModel? _foundUser;
  
  /// 是否已经是好友
  bool _isFriend = false;
  
  /// 是否已发送好友请求
  bool _requestSent = false;
  
  /// 当前发送请求的状态
  bool _isSendingRequest = false;

  @override
  void initState() {
    super.initState();
  }
  
  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }
  
  /// 搜索用户
  Future<void> _searchUser() async {
    final query = _searchController.text.trim();
    if (query.isEmpty) return;
    
    setState(() {
      _isSearching = true;
      _foundUser = null;
      _isFriend = false;
      _requestSent = false;
    });
    
    try {
      final authService = Provider.of<AuthService>(context, listen: false);
      final friendService = Provider.of<FriendService>(context, listen: false);
      
      // 搜索用户
      final user = await authService.findUserByUsername(query);
      
      if (user != null) {
        // 检查是否是自己
        if (user.userId == authService.currentUser?.userId) {
          setState(() {
            _isSearching = false;
            _foundUser = null;
          });
          
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('这是您自己的账号')),
          );
          return;
        }
        
        // 检查是否已经是好友
        final areFriends = await friendService.areFriends(
          authService.currentUser!.userId, 
          user.userId
        );
        
        // 检查是否已经发送过请求
        final sentRequests = await friendService.getFriendRequests(
          authService.currentUser!.userId,
          received: false,
        );
        
        final requestSent = sentRequests.any((req) => 
          req.receiverId == user.userId && req.status == FriendRequestStatus.pending
        );
        
        setState(() {
          _isSearching = false;
          _foundUser = user;
          _isFriend = areFriends;
          _requestSent = requestSent;
        });
      } else {
        setState(() {
          _isSearching = false;
          _foundUser = null;
        });
        
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('未找到用户: $query')),
        );
      }
    } catch (e) {
      setState(() {
        _isSearching = false;
      });
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('搜索用户失败: $e')),
      );
    }
  }
  
  /// 发送好友请求
  Future<void> _sendFriendRequest() async {
    if (_foundUser == null || _isFriend || _requestSent || _isSendingRequest) return;
    
    setState(() {
      _isSendingRequest = true;
    });
    
    try {
      final authService = Provider.of<AuthService>(context, listen: false);
      final friendService = Provider.of<FriendService>(context, listen: false);
      
      final currentUserId = authService.currentUser!.userId;
      final message = '我是${authService.currentUser!.username}，请求添加您为好友';
      
      final success = await friendService.sendFriendRequest(
        currentUserId, 
        _foundUser!.userId,
        message: message,
      );
      
      setState(() {
        _isSendingRequest = false;
        _requestSent = success;
      });
      
      if (success) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('好友请求已发送')),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('发送好友请求失败')),
        );
      }
    } catch (e) {
      setState(() {
        _isSendingRequest = false;
      });
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('发送好友请求出错: $e')),
      );
    }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('添加好友'),
        bottom: PreferredSize(
          preferredSize: Size.fromHeight(60),
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _searchController,
                    decoration: InputDecoration(
                      hintText: '输入用户名搜索',
                      prefixIcon: Icon(Icons.search),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(20),
                      ),
                      contentPadding: EdgeInsets.symmetric(vertical: 0),
                    ),
                    onSubmitted: (_) => _searchUser(),
                  ),
                ),
                SizedBox(width: 8),
                IconButton(
                  icon: Icon(Icons.search),
                  onPressed: _searchUser,
                ),
              ],
            ),
          ),
        ),
      ),
      body: _buildSearchResult(),
    );
  }
  
  /// 构建搜索结果
  Widget _buildSearchResult() {
    if (_isSearching) {
      return Center(
        child: CircularProgressIndicator(),
      );
    }
    
    if (_foundUser == null) {
      if (_searchController.text.isEmpty) {
        return Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.person_search, size: 64, color: Colors.grey),
              SizedBox(height: 16),
              Text('搜索用户名添加好友', style: TextStyle(color: Colors.grey)),
            ],
          ),
        );
      } else {
        return Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.person_off, size: 64, color: Colors.grey),
              SizedBox(height: 16),
              Text('未找到用户: ${_searchController.text}', style: TextStyle(color: Colors.grey)),
            ],
          ),
        );
      }
    }
    
    return Padding(
      padding: EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // 头像
          CircleAvatar(
            radius: 50,
            backgroundImage: _foundUser!.avatarUrl != null
                ? NetworkImage(_foundUser!.avatarUrl!)
                : null,
            child: _foundUser!.avatarUrl == null
                ? Text(
                    _foundUser!.username[0].toUpperCase(),
                    style: TextStyle(fontSize: 32),
                  )
                : null,
          ),
          SizedBox(height: 16),
          
          // 用户名
          Text(
            _foundUser!.username,
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
          ),
          SizedBox(height: 8),
          
          // 用户ID
          Text(
            'ID: ${_foundUser!.userId}',
            style: TextStyle(
              color: Colors.grey,
            ),
          ),
          SizedBox(height: 32),
          
          // 操作按钮
          if (_isFriend)
            ElevatedButton.icon(
              icon: Icon(Icons.check),
              label: Text('已是好友'),
              onPressed: null,
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.green,
                foregroundColor: Colors.white,
                minimumSize: Size(200, 45),
              ),
            )
          else if (_requestSent)
            ElevatedButton.icon(
              icon: Icon(Icons.pending),
              label: Text('请求已发送'),
              onPressed: null,
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.orange,
                foregroundColor: Colors.white,
                minimumSize: Size(200, 45),
              ),
            )
          else
            ElevatedButton.icon(
              icon: Icon(_isSendingRequest ? null : Icons.person_add),
              label: _isSendingRequest
                  ? SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        color: Colors.white,
                        strokeWidth: 2,
                      ),
                    )
                  : Text('添加好友'),
              onPressed: _isSendingRequest ? null : _sendFriendRequest,
              style: ElevatedButton.styleFrom(
                minimumSize: Size(200, 45),
              ),
            ),
        ],
      ),
    );
  }
}
