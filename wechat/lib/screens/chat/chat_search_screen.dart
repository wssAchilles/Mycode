import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/message_model.dart';
import '../../services/auth_service.dart';
import '../../services/chat_service.dart';
import '../../services/search_service.dart';
import 'chat_detail_screen.dart';

/// 聊天搜索界面
///
/// 用于搜索聊天消息
class ChatSearchScreen extends StatefulWidget {
  final String? otherUserId; // 可选参数，如果提供则只在特定聊天中搜索
  
  const ChatSearchScreen({Key? key, this.otherUserId}) : super(key: key);

  @override
  State<ChatSearchScreen> createState() => _ChatSearchScreenState();
}

class _ChatSearchScreenState extends State<ChatSearchScreen> {
  // 搜索控制器
  final TextEditingController _searchController = TextEditingController();
  
  // 是否正在搜索
  bool _isSearching = false;
  
  // 是否区分大小写
  bool _caseSensitive = false;
  
  // 单个聊天的搜索结果
  List<MessageModel>? _searchResults;
  
  // 全局搜索结果
  Map<String, List<MessageModel>>? _globalSearchResults;
  
  // 消息分组
  Map<String, List<MessageModel>> _groupedResults = {};
  
  @override
  void initState() {
    super.initState();
    // 初始化搜索服务
  }
  
  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }
  
  /// 执行搜索
  Future<void> _performSearch() async {
    final query = _searchController.text.trim();
    if (query.isEmpty) return;
    
    setState(() {
      _isSearching = true;
      _searchResults = null;
      _globalSearchResults = null;
      _groupedResults = {};
    });
    
    try {
      final authService = Provider.of<AuthService>(context, listen: false);
      final chatService = Provider.of<ChatService>(context, listen: false);
      final searchService = SearchService(chatService);
      
      final currentUser = authService.currentUser;
      if (currentUser == null) return;
      
      // 如果提供了otherUserId，则只在特定聊天中搜索
      if (widget.otherUserId != null) {
        final results = await searchService.searchMessagesInChat(
          currentUserId: currentUser.userId,
          otherUserId: widget.otherUserId!,
          query: query,
          caseSensitive: _caseSensitive,
        );
        
        setState(() {
          _searchResults = results;
          _isSearching = false;
        });
      } else {
        // 在所有聊天中搜索
        final results = await searchService.searchAllMessages(
          currentUserId: currentUser.userId,
          query: query,
          caseSensitive: _caseSensitive,
        );
        
        setState(() {
          _globalSearchResults = results;
          _groupedResults = results;
          _isSearching = false;
        });
      }
    } catch (e) {
      setState(() {
        _isSearching = false;
      });
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('搜索失败: $e')),
      );
    }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.otherUserId != null ? '搜索聊天消息' : '全局消息搜索'),
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
                      hintText: '搜索消息...',
                      prefixIcon: Icon(Icons.search),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(20),
                      ),
                      contentPadding: EdgeInsets.symmetric(vertical: 0),
                    ),
                    onSubmitted: (_) => _performSearch(),
                  ),
                ),
                SizedBox(width: 8),
                IconButton(
                  icon: Icon(Icons.search),
                  onPressed: _performSearch,
                ),
              ],
            ),
          ),
        ),
        actions: [
          // 区分大小写开关
          IconButton(
            icon: Icon(
              _caseSensitive ? Icons.spellcheck : Icons.spellcheck_outlined,
              color: _caseSensitive ? Colors.blue : null,
            ),
            tooltip: '区分大小写',
            onPressed: () {
              setState(() {
                _caseSensitive = !_caseSensitive;
              });
            },
          ),
        ],
      ),
      body: _buildSearchResults(),
    );
  }
  
  /// 构建搜索结果
  Widget _buildSearchResults() {
    if (_isSearching) {
      return Center(
        child: CircularProgressIndicator(),
      );
    }
    
    if (_searchController.text.isEmpty) {
      return Center(
        child: Text('请输入搜索关键词'),
      );
    }
    
    // 特定聊天搜索
    if (widget.otherUserId != null) {
      if (_searchResults == null) {
        return Center(child: Text('无搜索结果'));
      }
      
      if (_searchResults!.isEmpty) {
        return Center(child: Text('未找到匹配消息'));
      }
      
      return ListView.builder(
        padding: EdgeInsets.all(8),
        itemCount: _searchResults!.length,
        itemBuilder: (context, index) {
          final message = _searchResults![index];
          return _buildMessageItem(message, widget.otherUserId!);
        },
      );
    }
    
    // 全局搜索
    if (_globalSearchResults == null) {
      return Center(child: Text('无搜索结果'));
    }
    
    if (_globalSearchResults!.isEmpty) {
      return Center(child: Text('未找到匹配消息'));
    }
    
    // 构建分组列表
    final userIds = _groupedResults.keys.toList();
    
    return ListView.builder(
      padding: EdgeInsets.all(8),
      itemCount: userIds.length,
      itemBuilder: (context, index) {
        final userId = userIds[index];
        final messages = _groupedResults[userId]!;
        
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildUserHeader(userId, messages.length),
            ...messages.map((msg) => _buildMessageItem(msg, userId)).toList(),
            Divider(),
          ],
        );
      },
    );
  }
  
  /// 构建用户头部
  Widget _buildUserHeader(String userId, int messageCount) {
    return FutureBuilder(
      future: Provider.of<AuthService>(context, listen: false).getUserInfo(userId),
      builder: (context, snapshot) {
        final username = snapshot.data?.username ?? userId;
        
        return Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: [
              CircleAvatar(
                backgroundImage: snapshot.data?.avatarUrl != null
                    ? NetworkImage(snapshot.data!.avatarUrl!)
                    : null,
                child: snapshot.data?.avatarUrl == null
                    ? Text(username[0].toUpperCase())
                    : null,
              ),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  username,
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
              ),
              Text('$messageCount 条匹配'),
            ],
          ),
        );
      },
    );
  }
  
  /// 构建消息项
  Widget _buildMessageItem(MessageModel message, String otherUserId) {
    final query = _searchController.text;
    
    // 格式化时间
    final dateTime = message.timestamp;
    final formattedDate = '${dateTime.year}-${dateTime.month.toString().padLeft(2, '0')}-${dateTime.day.toString().padLeft(2, '0')}';
    final formattedTime = '${dateTime.hour.toString().padLeft(2, '0')}:${dateTime.minute.toString().padLeft(2, '0')}';
    
  /// 构建文本消息预览，包含关键词高亮
  Widget _buildTextMessagePreview(MessageModel message, String query) {
    final content = message.content;
    final spans = <InlineSpan>[];
    
    if (!_caseSensitive) {
      final lowerCaseContent = content.toLowerCase();
      final lowerCaseQuery = query.toLowerCase();
      
      int startIndex = 0;
      int matchIndex;
      
      while ((matchIndex = lowerCaseContent.indexOf(lowerCaseQuery, startIndex)) != -1) {
        if (matchIndex > startIndex) {
          spans.add(TextSpan(
            text: content.substring(startIndex, matchIndex),
          ));
        }
        
        spans.add(TextSpan(
          text: content.substring(matchIndex, matchIndex + query.length),
          style: TextStyle(
            backgroundColor: Colors.yellow,
            fontWeight: FontWeight.bold,
          ),
        ));
        
        startIndex = matchIndex + query.length;
      }
      
      if (startIndex < content.length) {
        spans.add(TextSpan(
          text: content.substring(startIndex),
        ));
      }
    } else {
      // 区分大小写
      int startIndex = 0;
      int matchIndex;
      
      while ((matchIndex = content.indexOf(query, startIndex)) != -1) {
        if (matchIndex > startIndex) {
          spans.add(TextSpan(
            text: content.substring(startIndex, matchIndex),
          ));
        }
        
        spans.add(TextSpan(
          text: content.substring(matchIndex, matchIndex + query.length),
          style: TextStyle(
            backgroundColor: Colors.yellow,
            fontWeight: FontWeight.bold,
          ),
        ));
        
        startIndex = matchIndex + query.length;
      }
      
      if (startIndex < content.length) {
        spans.add(TextSpan(
          text: content.substring(startIndex),
        ));
      }
    }
    
    return RichText(
      text: TextSpan(
        style: TextStyle(color: Colors.black87),
        children: spans,
      ),
    );
  }
  
  /// 构建图片消息预览
  Widget _buildImageMessagePreview(MessageModel message) {
    // 检查是否有图片URL
    if (message.imageUrl == null || message.imageUrl!.isEmpty) {
      return Text('[图片加载失败]');
    }
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 简短描述
        Text(
          '图片消息',
          style: TextStyle(color: Colors.black87, fontWeight: FontWeight.w500),
        ),
        SizedBox(height: 8),
        // 图片缩略图
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Image.network(
            message.imageUrl!,
            height: 120,
            width: double.infinity,
            fit: BoxFit.cover,
            loadingBuilder: (context, child, loadingProgress) {
              if (loadingProgress == null) return child;
              return Container(
                height: 120,
                width: double.infinity,
                color: Colors.grey.shade200,
                child: Center(
                  child: CircularProgressIndicator(
                    value: loadingProgress.expectedTotalBytes != null
                        ? loadingProgress.cumulativeBytesLoaded / loadingProgress.expectedTotalBytes!
                        : null,
                  ),
                ),
              );
            },
            errorBuilder: (context, error, stackTrace) {
              return Container(
                height: 120,
                width: double.infinity,
                color: Colors.grey.shade200,
                child: Center(
                  child: Icon(
                    Icons.broken_image,
                    color: Colors.grey,
                    size: 40,
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
    
    return Card(
      margin: EdgeInsets.symmetric(vertical: 4),
      child: InkWell(
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => ChatDetailScreen(
                otherUserId: otherUserId,
                initialMessageId: message.messageId,
              ),
            ),
          );
        },
        child: Padding(
          padding: EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 根据消息类型显示不同的内容
              if (message.messageType == MessageType.text)
                _buildTextMessagePreview(message, query)
              else if (message.messageType == MessageType.image)
                _buildImageMessagePreview(message),
              
              SizedBox(height: 4),
              // 时间
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '$formattedDate $formattedTime',
                    style: TextStyle(
                      color: Colors.grey,
                      fontSize: 12,
                    ),
                  ),
                  // 消息类型标签
                  Container(
                    padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: message.messageType == MessageType.image 
                          ? Colors.blue.withOpacity(0.1) 
                          : Colors.green.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      message.messageType == MessageType.image ? '图片' : '文本',
                      style: TextStyle(
                        color: message.messageType == MessageType.image 
                            ? Colors.blue 
                            : Colors.green,
                        fontSize: 10,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
