import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../models/message_model.dart';
import '../../services/auth_service.dart';
import '../../services/chat_service.dart';
import '../../services/group_service.dart';
import '../../services/emoji_service.dart';
import '../../models/user_model.dart';
import '../../models/group_model.dart';
import '../../widgets/animated_list_item.dart';
import 'chat_detail_screen.dart';
import 'group_chat_detail_screen.dart';
import '../group/create_group_screen.dart';

/// 聊天列表页面
/// 
/// 显示当前用户的所有聊天会话
class ChatListScreen extends StatefulWidget {
  const ChatListScreen({Key? key}) : super(key: key);

  @override
  _ChatListScreenState createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  // 聊天列表
  List<Map<String, dynamic>> _chatList = [];
  
  // 加载状态
  bool _isLoading = true;
  
  // 错误信息
  String? _errorMessage;
  
  @override
  void initState() {
    super.initState();
    print('ChatListScreen 初始化');
    
    // 延迟一帧再加载，确保 context 已完全初始化
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadChatList();
    });
  }
  
  /// 加载聊天列表
  Future<void> _loadChatList() async {
    final authService = Provider.of<AuthService>(context, listen: false);
    final chatService = Provider.of<ChatService>(context, listen: false);
    
    // 确保用户已登录
    final currentUser = authService.currentUser;
    if (currentUser == null) {
      setState(() {
        _isLoading = false;
        _errorMessage = '未登录，请先登录';
      });
      return;
    }
    
    try {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
      
      print('开始在界面中加载聊天列表...');
      
      // 获取聊天列表
      final chatList = await chatService.getChatList(currentUser.userId);
      
      print('界面成功获取聊天列表，共 ${chatList.length} 个聊天');
      
      // 即使列表为空也设置为成功状态
      setState(() {
        _chatList = chatList;
        _isLoading = false;
      });
    } catch (e) {
      print('界面加载聊天列表错误: $e');
      
      // 出错时也停止加载状态，显示空列表
      setState(() {
        _isLoading = false;
        _chatList = []; // 确保使用空列表
        _errorMessage = '加载聊天列表失败: $e';
      });
    }
  }
  
  @override
  Widget build(BuildContext context) {
    // 获取当前用户
    final authService = Provider.of<AuthService>(context);
    final currentUser = authService.currentUser;
    
    // 监听聊天服务变化
    return Consumer<ChatService>(
      builder: (context, chatService, child) {
        return Scaffold(
          appBar: AppBar(
            title: Text('微聊'),
            actions: [
              // 创建群聊按钮
              IconButton(
                icon: Icon(Icons.group_add),
                tooltip: '创建群组',
                onPressed: () {
                  // 跳转到创建群组页面
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (context) => CreateGroupScreen(),
                    ),
                  ).then((_) {
                    // 创建群组后刷新聊天列表
                    _loadChatList();
                  });
                },
              ),
              // 通讯录按钮
              IconButton(
                icon: Icon(Icons.people),
                tooltip: '好友列表',
                onPressed: () {
                  // 跳转到好友列表页面
                  Navigator.of(context).pushNamed('/friends');
                },
              ),
              // 个人资料按钮
              IconButton(
                icon: Icon(Icons.person),
                tooltip: '个人资料',
                onPressed: () {
                  // 跳转到个人资料页面
                  Navigator.of(context).pushNamed('/profile');
                },
              ),
              // 退出登录按钮
              IconButton(
                icon: Icon(Icons.exit_to_app),
                tooltip: '退出登录',
                onPressed: () async {
                  // 获取表情包服务并清理数据
                  final emojiService = Provider.of<EmojiService>(context, listen: false);
                  emojiService.clearUserData();
                  
                  // 登出用户
                  authService.logout(); // Method returns void so don't await it
                  
                  // 退出后返回到登录页
                  Navigator.of(context).pushReplacementNamed('/login');
                },
              ),
            ],
          ),
          body: _buildBody(currentUser),
        );
      },
    );
  }
  
  /// 构建页面主体
  Widget _buildBody(UserModel? currentUser) {
    if (_isLoading) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text('加载聊天列表...', style: TextStyle(color: Colors.grey)),
          ],
        ),
      );
    }
    
    if (_errorMessage != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline, size: 48, color: Colors.red),
            SizedBox(height: 16),
            Text(_errorMessage!, style: TextStyle(color: Colors.red)),
            SizedBox(height: 16),
            ElevatedButton(
              onPressed: _loadChatList,
              child: Text('重试'),
            ),
          ],
        ),
      );
    }
    
    if (_chatList.isEmpty) {
      return RefreshIndicator(
        onRefresh: _loadChatList,
        child: ListView(
          children: [
            SizedBox(height: MediaQuery.of(context).size.height / 3),
            Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.chat_bubble_outline, size: 64, color: Colors.grey),
                  SizedBox(height: 16),
                  Text(
                    '暂无聊天记录',
                    style: TextStyle(fontSize: 18, color: Colors.grey),
                  ),
                  SizedBox(height: 16),
                  Text(
                    '开始与其他用户聊天吧',
                    style: TextStyle(color: Colors.grey),
                  ),
                  SizedBox(height: 24),
                  ElevatedButton.icon(
                    icon: Icon(Icons.people),
                    label: Text('查看好友列表'),
                    onPressed: () {
                      Navigator.of(context).pushNamed('/friends');
                    },
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }
    
    // 显示聊天列表
    return RefreshIndicator(
      onRefresh: _loadChatList,
      child: ListView.builder(
        padding: EdgeInsets.all(8.0),
        itemCount: _chatList.length,
        itemBuilder: (context, index) {
          final chat = _chatList[index];
          final lastMessage = chat['lastMessage'] as MessageModel?; // 允许为null
          final isGroup = chat['isGroup'] == true;
          
          // 根据是否为群聊获取不同的字段
          String displayName;
          String? avatarUrl;
          String itemId; // 用户ID或群组ID
          
          if (isGroup) {
            // 群聊信息
            displayName = chat['groupName'] as String? ?? '未命名群组';
            avatarUrl = chat['avatarUrl'] as String?;
            itemId = chat['groupId'] as String;
          } else {
            // 私聊信息
            displayName = chat['username'] as String? ?? '未知用户';
            avatarUrl = chat['avatarUrl'] as String?;
            itemId = chat['userId'] as String;
          }
          
          final groupId = isGroup ? itemId : null;
          final groupName = isGroup ? displayName : null;
          
          return AnimatedListItem(
            index: index,
            child: Card(
              elevation: 0.8,
              margin: EdgeInsets.symmetric(vertical: 4, horizontal: 2),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              child: ListTile(
                // 头像 - 根据是否为群聊显示不同样式
                leading: CircleAvatar(
                  backgroundImage: avatarUrl != null ? NetworkImage(avatarUrl) : null,
                  child: avatarUrl == null 
                    ? isGroup 
                      ? Icon(Icons.group, color: Colors.white)
                      : Text(displayName.isNotEmpty ? displayName[0].toUpperCase() : '?')
                    : null,
                  backgroundColor: isGroup ? Theme.of(context).primaryColor : null,
                ),
                
                // 用户名/群名和最新消息
                title: Row(
                  children: [
                    if (isGroup)
                      Icon(Icons.group, size: 16, color: Theme.of(context).primaryColor, semanticLabel: '群聊'),
                    if (isGroup)
                      SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        displayName,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                subtitle: lastMessage != null 
                  ? _buildLastMessagePreview(lastMessage)
                  : Text('暂无消息', style: TextStyle(fontStyle: FontStyle.italic, color: Colors.grey)),
                
                // 最新消息时间
                trailing: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    lastMessage != null 
                      ? Text(
                          _formatMessageTime(lastMessage.timestamp),
                          style: TextStyle(fontSize: 12, color: Colors.grey),
                        )
                      : SizedBox.shrink(), // 如果没有消息，则不显示时间
                    // 未读消息数（暂时不显示）
                    // SizedBox(height: 4),
                    // if (chat['unreadCount'] > 0)
                    //   Container(
                    //     padding: EdgeInsets.all(4),
                    //     decoration: BoxDecoration(
                    //       color: Colors.red,
                    //       shape: BoxShape.circle,
                    //     ),
                    //     child: Text(
                    //       chat['unreadCount'].toString(),
                    //       style: TextStyle(color: Colors.white, fontSize: 12),
                    //     ),
                    //   ),
                  ],
                ),
                
                // 点击进入聊天详情页 - 区分普通聊天和群聊
                onTap: () {
                  if (currentUser != null) {
                    if (isGroup && groupId != null) {
                      // 导航到群聊详情页面
              print('点击进入群聊: $groupName (ID: $groupId)');
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (context) => GroupChatDetailScreen(
                            groupId: groupId,
                            groupName: groupName ?? '群聊',
                          ),
                        ),
              ).then((_) {
                // 从群聊页面返回时刷新聊天列表以更新头像等信息
                _loadChatList();
              });
                    } else {
                      // 导航到普通聊天详情页面
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (context) => ChatDetailScreen(
                            otherUserId: itemId,
                            otherUsername: displayName,
                            otherUserAvatarUrl: avatarUrl,
                          ),
                        ),
                      ).then((_) {
                        // 从私聊页面返回时刷新聊天列表以更新信息
                        _loadChatList();
                      });
                    }
                  }
                },
              ),
            ),
          );
        },
      ),
    );
  }
  
  /// 构建最新消息预览
  Widget _buildLastMessagePreview(MessageModel message) {
    if (message.isTextMessage) {
      // 文本消息直接显示内容
      return Text(
        message.content,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      );
    } else if (message.isImageMessage) {
      // 图片消息显示[图片]
      return Row(
        children: [
          Icon(Icons.image, size: 16, color: Colors.grey),
          SizedBox(width: 4),
          Text('[图片]'),
        ],
      );
    } else {
      // 其他类型消息
      return Text('[未知消息类型]');
    }
  }
  
  /// 格式化消息时间
  String _formatMessageTime(DateTime time) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final messageDate = DateTime(time.year, time.month, time.day);
    
    if (messageDate == today) {
      // 今天的消息只显示时间
      return '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';
    } else if (messageDate == today.subtract(Duration(days: 1))) {
      // 昨天的消息
      return '昨天';
    } else if (now.difference(messageDate).inDays < 7) {
      // 本周内的消息显示星期
      final weekdays = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
      // weekday从1开始，1表示星期一
      return weekdays[time.weekday - 1];
    } else {
      // 更早的消息显示日期
      return '${time.month}月${time.day}日';
    }
  }
}
