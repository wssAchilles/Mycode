import 'dart:io';
import 'dart:typed_data'; // Added for Uint8List
import 'package:flutter/foundation.dart'; // Added for kIsWeb
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';
import '../../widgets/animated_message_bubble.dart';
import '../../widgets/emoji_picker.dart';

import '../../models/message_model.dart';
import '../../models/user_model.dart';
import '../../models/emoji_model.dart';
import '../../services/auth_service.dart';
import '../../services/chat_service.dart';
import '../../services/emoji_service.dart';

/// 聊天详情页面
///
/// 显示与特定联系人的完整聊天历史，并提供消息发送功能
class ChatDetailScreen extends StatefulWidget {
  /// 对方用户ID
  final String otherUserId;

  /// 对方用户名
  final String otherUsername;

  /// 对方头像URL
  final String? otherUserAvatarUrl;

  const ChatDetailScreen({
    Key? key,
    required this.otherUserId,
    required this.otherUsername,
    this.otherUserAvatarUrl,
  }) : super(key: key);

  @override
  _ChatDetailScreenState createState() => _ChatDetailScreenState();
}

class _ChatDetailScreenState extends State<ChatDetailScreen> {
  // 消息列表
  List<MessageModel> _messages = [];
  
  // 消息输入控制器
  final TextEditingController _textController = TextEditingController();
  
  // 滚动控制器，用于自动滚动到底部
  final ScrollController _scrollController = ScrollController();
  
  // 状态标志
  bool _isLoading = true;
  bool _isSendingMessage = false;
  bool _isShowingEmojiPicker = false; // 是否显示表情选择器
  String? _errorMessage;
  
  // 图片选择器
  final ImagePicker _imagePicker = ImagePicker();

  @override
  void initState() {
    super.initState();
    _loadMessages();
    
    // 监听聊天服务的消息更新
    final chatService = Provider.of<ChatService>(context, listen: false);
    chatService.addListener(_onChatServiceUpdate);
  }

  @override
  void dispose() {
    // 停止消息轮询
    final chatService = Provider.of<ChatService>(context, listen: false);
    chatService.stopMessagePolling();
    chatService.removeListener(_onChatServiceUpdate);
    
    // 释放控制器
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  /// 加载消息
  Future<void> _loadMessages() async {
    final authService = Provider.of<AuthService>(context, listen: false);
    final chatService = Provider.of<ChatService>(context, listen: false);

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

      // 加载消息
      final messages = await chatService.loadMessages(
        currentUserId: currentUser.userId,
        otherUserId: widget.otherUserId,
      );

      setState(() {
        _messages = messages;
        _isLoading = false;
      });

      // 消息加载后，等待多个帧的渲染完成再滚动
      WidgetsBinding.instance.addPostFrameCallback((_) {
        Future.delayed(Duration(milliseconds: 100), () {
          _scrollToBottom(animated: false);
        });
      });

      // 开始消息轮询
      chatService.startMessagePolling(
        userId: widget.otherUserId,
      );

      // 标记收到的消息为已读
      _markReceivedMessagesAsRead(currentUser.userId);
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = '加载消息失败: $e';
      });
      print('加载消息错误: $e');
    }
  }

  /// 标记收到的消息为已读
  void _markReceivedMessagesAsRead(String currentUserId) {
    final chatService = Provider.of<ChatService>(context, listen: false);
    
    // 收集所有接收到的消息ID
    final receivedMessageIds = _messages
        .where((msg) => msg.receiverId == currentUserId && msg.status != MessageStatus.read)
        .map((msg) => msg.messageId)
        .toList();
    
    if (receivedMessageIds.isNotEmpty) {
      chatService.markMessagesAsRead(
        messageIds: receivedMessageIds,
        currentUserId: currentUserId,
        otherUserId: widget.otherUserId,
      );
    }
  }
  
  /// 处理聊天服务的消息更新
  void _onChatServiceUpdate() async {
    // 检查widget是否已经被销毁
    if (!mounted) return;
    
    final authService = Provider.of<AuthService>(context, listen: false);
    final chatService = Provider.of<ChatService>(context, listen: false);
    
    final currentUser = authService.currentUser;
    if (currentUser == null) return;
    
    try {
      // 获取缓存的消息
      final cachedMessages = await chatService.getCachedMessages(
        currentUserId: currentUser.userId,
        otherUserId: widget.otherUserId,
      );
      
      // 如果有缓存消息且与当前消息不同，则更新UI
      if (cachedMessages.isNotEmpty) {
        final currentMessageIds = _messages.map((m) => m.messageId).toSet();
        final cachedMessageIds = cachedMessages.map((m) => m.messageId).toSet();
        
        // 如果消息ID不同或数量不同，则更新
        if (!currentMessageIds.containsAll(cachedMessageIds) || 
            currentMessageIds.length != cachedMessageIds.length) {
          setState(() {
            _messages = List.from(cachedMessages);
          });
          
          // 滚动到底部（使用动画）
          _scrollToBottom(animated: true);
        }
      }
    } catch (e) {
      print('处理消息更新错误: $e');
    }
  }

  /// 发送文本消息
  Future<void> _sendTextMessage() async {
    final text = _textController.text.trim();
    if (text.isEmpty) return;

    final authService = Provider.of<AuthService>(context, listen: false);
    final chatService = Provider.of<ChatService>(context, listen: false);

    final currentUser = authService.currentUser;
    if (currentUser == null) return;

    try {
      setState(() {
        _isSendingMessage = true;
      });

      // 清空输入框
      _textController.clear();

      // 发送文本消息
      final message = await chatService.sendTextMessage(
        senderId: currentUser.userId,
        receiverId: widget.otherUserId,
        content: text,
      );

      setState(() {
        _isSendingMessage = false;
      });

      // 确保消息成功发送
      if (message != null) {
        // 消息发送成功，等待轮询机制更新消息列表
        // 不立即添加到本地列表，避免重复显示
        
        // 滚动到底部
        _scrollToBottom();
      }
    } catch (e) {
      setState(() {
        _isSendingMessage = false;
      });
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('发送消息失败: $e')),
      );
      print('发送消息错误: $e');
    }
  }

  /// 选择并发送图片
  Future<void> _pickAndSendImage() async {
    try {
      // 显示图片选择选项（在Web平台上限制相机功能）
      final choice = await showDialog<String>(
        context: context,
        builder: (context) => SimpleDialog(
          title: const Text('选择图片来源'),
          children: [
            if (!kIsWeb) // 仅在非Web平台显示相机选项
              SimpleDialogOption(
                onPressed: () => Navigator.pop(context, 'camera'),
                child: ListTile(
                  leading: Icon(Icons.camera_alt, color: Colors.blue),
                  title: Text('拍照'),
                  dense: true,
                ),
              ),
            SimpleDialogOption(
              onPressed: () => Navigator.pop(context, 'gallery'),
              child: ListTile(
                leading: Icon(Icons.photo_library, color: Colors.green),
                title: Text(kIsWeb ? '选择图片' : '从相册选择'),
                dense: true,
              ),
            ),
          ],
        ),
      );
      
      if (choice == null) return;
      
      // 选择图片（在Web平台上限制相机功能）
      final ImageSource source = choice == 'camera' ? ImageSource.camera : ImageSource.gallery;
      final ImageSource actualSource = kIsWeb && source == ImageSource.camera ? ImageSource.gallery : source;
      final pickedFile = await _imagePicker.pickImage(
        source: actualSource,
        imageQuality: 70, // 压缩图片质量，减小文件大小
      );
      
      if (pickedFile == null) return;
      
      // 显示图片预览并确认发送
      final shouldSend = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('确认发送图片'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                constraints: BoxConstraints(maxHeight: 300),
                child: kIsWeb 
                  ? FutureBuilder<Uint8List>(
                      future: pickedFile.readAsBytes(),
                      builder: (context, snapshot) {
                        if (snapshot.hasData) {
                          return Image.memory(
                            snapshot.data!,
                            fit: BoxFit.contain,
                          );
                        } else if (snapshot.hasError) {
                          return Container(
                            height: 200,
                            child: Center(
                              child: Text('无法加载图片预览'),
                            ),
                          );
                        } else {
                          return Container(
                            height: 200,
                            child: Center(
                              child: CircularProgressIndicator(),
                            ),
                          );
                        }
                      },
                    )
                  : Image.file(
                      File(pickedFile.path),
                      fit: BoxFit.contain,
                    ),
              ),
              SizedBox(height: 16),
              Text('确认发送这张图片吗？', style: TextStyle(fontSize: 16)),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('发送'),
            ),
          ],
        ),
      ) ?? false;
      
      if (!shouldSend) return;
      
      // 获取当前用户
      final authService = Provider.of<AuthService>(context, listen: false);
      final chatService = Provider.of<ChatService>(context, listen: false);
      
      final currentUser = authService.currentUser;
      if (currentUser == null) return;
      
      // 显示发送中状态
      setState(() {
        _isSendingMessage = true;
      });
      
      // 发送图片消息
      final message = await chatService.sendImageMessage(
        senderId: currentUser.userId,
        receiverId: widget.otherUserId,
        imageFilePath: pickedFile.path,
      );
      
      setState(() {
        _isSendingMessage = false;
      });
      
      // 确保消息成功发送
      if (message != null) {
        // 更新本地消息列表
        setState(() {
          _messages = [..._messages, message];
        });
        
        // 滚动到底部
        _scrollToBottom();
      }
    } catch (e) {
      setState(() {
        _isSendingMessage = false;
      });
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('发送图片失败: $e')),
      );
      print('发送图片错误: $e');
    }
  }
  
  /// 发送表情包
  Future<void> _sendEmoji(EmojiModel emoji) async {
    try {
      // 获取当前用户
      final authService = Provider.of<AuthService>(context, listen: false);
      final chatService = Provider.of<ChatService>(context, listen: false);
      
      final currentUser = authService.currentUser;
      if (currentUser == null) return;
      
      // 显示发送中状态
      setState(() {
        _isSendingMessage = true;
        _isShowingEmojiPicker = false; // 关闭表情选择器
      });
      
      // 发送表情包消息
      final message = await chatService.sendEmojiMessage(
        senderId: currentUser.userId,
        receiverId: widget.otherUserId,
        emojiId: emoji.id, // 表情包ID
      );
      
      setState(() {
        _isSendingMessage = false;
      });
      
      // 确保消息成功发送
      if (message != null) {
        // 更新本地消息列表
        setState(() {
          _messages = [..._messages, message];
        });
        
        // 滚动到底部
        _scrollToBottom();
      }
    } catch (e) {
      setState(() {
        _isSendingMessage = false;
      });
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('发送表情包失败: $e')),
      );
      print('发送表情包错误: $e');
    }
  }
  
  /// 拍照创建表情包
  Future<void> _takePhotoAsEmoji() async {
    await _createImageEmoji(ImageSource.camera);
  }
  
  /// 从相册选择图片创建表情包
  Future<void> _pickImageAsEmoji() async {
    await _createImageEmoji(ImageSource.gallery);
  }
  
  /// 使用图片创建表情包的通用方法
  Future<void> _createImageEmoji(ImageSource source) async {
    try {
      // 在Web平台上，如果选择了相机，则改为相册
      final actualSource = kIsWeb && source == ImageSource.camera ? ImageSource.gallery : source;
      
      // 选择或拍照获取图片
      final pickedFile = await _imagePicker.pickImage(
        source: actualSource,
        maxWidth: 512,
        maxHeight: 512,
        imageQuality: 85,
      );
      
      if (pickedFile == null) return;
      
      // 获取表情包名称
      final emojiName = await _showNameDialog();
      if (emojiName == null || emojiName.isEmpty) return;
      
      // 读取图片文件（兼容Web平台）
      final Uint8List imageBytes = await pickedFile.readAsBytes();
      
      // 获取EmojiService
      final emojiService = Provider.of<EmojiService>(context, listen: false);
      
      // 显示上传中提示
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('正在创建表情包...')),
      );
      
      // 上传并添加到表情库
      final newEmoji = await emojiService.uploadNewEmoji(
        imageBytes: imageBytes,
        name: emojiName,
        category: '自定义', // 默认添加到自定义分类
      );
      
      if (newEmoji != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('表情包"$emojiName"创建成功')),
        );
        
        // 立即发送这个表情包
        _sendEmoji(newEmoji);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('创建表情包失败')),
        );
      }
    } catch (e) {
      print('创建表情包失败: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('创建表情包失败: $e')),
      );
    }
  }

  /// 创建文本表情
  Future<void> _createTextEmoji() async {
    try {
      // 获取表情包名称
      final emojiName = await _showNameDialog();
      if (emojiName == null || emojiName.isEmpty) return;
      
      // 获取EmojiService
      final emojiService = Provider.of<EmojiService>(context, listen: false);
      
      // 创建一个简单的占位图像数据
      final List<int> placeholderImageBytes = List.generate(10, (index) => 0);
      
      // 显示上传中提示
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('正在创建表情包...')),
      );
      
      // 上传并添加到表情库
      final newEmoji = await emojiService.uploadNewEmoji(
        imageBytes: placeholderImageBytes, // 这里传入什么已经不重要了
        name: emojiName,
        category: '自定义', // 默认添加到自定义分类
      );
      
      if (newEmoji != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('表情包"$emojiName"创建成功')),
        );
        
        // 立即发送这个表情包
        _sendEmoji(newEmoji);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('创建表情包失败')),
        );
      }
    } catch (e) {
      print('创建文本表情失败: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('创建表情包失败: $e')),
      );
    }
  }
  
  /// 显示表情包名称输入对话框
  Future<String?> _showNameDialog() async {
    final TextEditingController controller = TextEditingController();
    
    try {
      return await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('表情包名称'),
          content: TextField(
            controller: controller,
            autofocus: true,
            decoration: const InputDecoration(
              labelText: '请输入表情包名称',
              hintText: '例如：微笑、点赞',
            ),
          ),
          actions: [
            TextButton(
              child: const Text('取消'),
              onPressed: () => Navigator.pop(context),
            ),
            TextButton(
              child: const Text('确定'),
              onPressed: () => Navigator.pop(context, controller.text),
            ),
          ],
        ),
      );
    } finally {
      controller.dispose();
    }
  }
  
  /// 切换表情选择器的显示状态
  void _toggleEmojiPicker() {
    setState(() {
      _isShowingEmojiPicker = !_isShowingEmojiPicker;
    });
  }

  /// 滚动到消息列表底部
  void _scrollToBottom({bool animated = true}) {
    if (!_scrollController.hasClients) return;
    
    // 使用 WidgetsBinding.instance.addPostFrameCallback 确保在渲染完成后执行
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        final maxScroll = _scrollController.position.maxScrollExtent;
        if (animated) {
          _scrollController.animateTo(
            maxScroll,
            duration: Duration(milliseconds: 300),
            curve: Curves.easeOut,
          );
        } else {
          // 立即跳转，不动画
          _scrollController.jumpTo(maxScroll);
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    // 获取当前用户
    final authService = Provider.of<AuthService>(context);
    final currentUser = authService.currentUser;
    
    // 使用专门的消息更新监听器，不需要Consumer
    return Scaffold(
      appBar: _buildAppBar(),
      body: _buildBody(currentUser),
    );
  }

  /// 构建顶部应用栏
  AppBar _buildAppBar() {
    return AppBar(
      title: Text(widget.otherUsername),
      leading: IconButton(
        icon: Icon(Icons.arrow_back),
        onPressed: () => Navigator.pop(context),
      ),
      actions: [
        // 头像
        Padding(
          padding: EdgeInsets.symmetric(horizontal: 8.0),
          child: CircleAvatar(
            backgroundImage: widget.otherUserAvatarUrl != null
                ? NetworkImage(widget.otherUserAvatarUrl!)
                : null,
            child: widget.otherUserAvatarUrl == null
                ? Text(widget.otherUsername[0].toUpperCase())
                : null,
            radius: 16,
          ),
        ),
      ],
    );
  }

  /// 构建页面主体
  Widget _buildBody(UserModel? currentUser) {
    if (_isLoading) {
      return Center(child: CircularProgressIndicator());
    }

    if (_errorMessage != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(_errorMessage!, style: TextStyle(color: Colors.red)),
            SizedBox(height: 16),
            ElevatedButton(
              onPressed: _loadMessages,
              child: Text('重试'),
            ),
          ],
        ),
      );
    }

    return Column(
      children: [
        // 消息列表
        Expanded(
          child: _messages.isEmpty
              ? _buildEmptyChatView()
              : _buildMessageList(currentUser),
        ),
        
        // 输入区域
        _buildMessageInput(),
      ],
    );
  }

  /// 构建空聊天视图
  Widget _buildEmptyChatView() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.chat_bubble_outline, size: 64, color: Colors.grey),
          SizedBox(height: 16),
          Text(
            '没有消息',
            style: TextStyle(fontSize: 18, color: Colors.grey),
          ),
          SizedBox(height: 8),
          Text(
            '开始与${widget.otherUsername}聊天吧',
            style: TextStyle(color: Colors.grey),
          ),
        ],
      ),
    );
  }

  /// 构建消息列表
  Widget _buildMessageList(UserModel? currentUser) {
    if (currentUser == null) return Container();
    
    return ListView.builder(
      controller: _scrollController,
      padding: EdgeInsets.all(8.0),
      itemCount: _messages.length,
      itemBuilder: (context, index) {
        final message = _messages[index];
        final isMe = message.senderId == currentUser.userId;
        
        // 计算是否需要显示时间
        final showTime = index == 0 || 
            _shouldShowTimestamp(_messages[index], index > 0 ? _messages[index - 1] : null);
        
        return Column(
          children: [
            // 显示时间戳
            if (showTime)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8.0),
                child: Text(
                  _formatTimestamp(message.timestamp),
                  style: TextStyle(
                    color: Colors.grey,
                    fontSize: 12,
                  ),
                ),
              ),
            
            // 消息气泡
            _buildMessageBubble(message, isMe),
          ],
        );
      },
    );
  }

  /// 判断是否应该显示时间戳
  bool _shouldShowTimestamp(MessageModel current, MessageModel? previous) {
    if (previous == null) return true;
    
    // 如果两条消息之间的时间间隔超过5分钟，则显示时间戳
    return current.timestamp.difference(previous.timestamp).inMinutes > 5;
  }

  /// 格式化时间戳
  String _formatTimestamp(DateTime time) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final yesterday = DateTime(now.year, now.month, now.day - 1);
    final messageDate = DateTime(time.year, time.month, time.day);
    
    String dateStr;
    if (messageDate == today) {
      dateStr = '今天';
    } else if (messageDate == yesterday) {
      dateStr = '昨天';
    } else {
      dateStr = '${time.year}-${time.month}-${time.day}';
    }
    
    return '$dateStr ${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';
  }

  /// 构建消息气泡
  Widget _buildMessageBubble(MessageModel message, bool isMe) {
    // 使用AnimatedBuilder为消息气泡添加动画效果
    return AnimatedMessageBubble(
      message: message,
      isMe: isMe,
      child: Row(
        mainAxisAlignment: isMe ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          // 已读状态（仅显示在自己发送的消息上）
          if (isMe)
            Padding(
              padding: EdgeInsets.only(right: 4.0),
              child: Text(
                message.status == MessageStatus.read ? '已读' : 
                message.status == MessageStatus.delivered ? '送达' : 
                message.status == MessageStatus.sent ? '发送中' : '',
                style: TextStyle(
                  fontSize: 10,
                  color: Colors.grey[600],
                ),
              ),
            ),

          // 消息内容
          Container(
            constraints: BoxConstraints(
              maxWidth: MediaQuery.of(context).size.width * 0.7,
            ),
            padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            margin: EdgeInsets.symmetric(vertical: 4),
            decoration: BoxDecoration(
              color: isMe 
                ? Theme.of(context).colorScheme.primary.withOpacity(0.1) 
                : Theme.of(context).colorScheme.tertiary,
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(isMe ? 16 : 4),
                topRight: Radius.circular(isMe ? 4 : 16),
                bottomLeft: Radius.circular(16),
                bottomRight: Radius.circular(16),
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.05),
                  offset: Offset(0, 1),
                  blurRadius: 2,
                ),
              ],
            ),
            child: _buildMessageContent(message),
          ),
        ],
      ),
    );
  }
  


  /// 构建消息内容
  Widget _buildMessageContent(MessageModel message) {
    if (message.isTextMessage) {
      // 文本消息
      return Text(
        message.content,
        style: TextStyle(fontSize: 16),
      );
    } else if (message.isImageMessage) {
      // 图片消息
      return GestureDetector(
        onTap: () {
          // 点击查看大图
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => Scaffold(
                appBar: AppBar(
                  leading: IconButton(
                    icon: Icon(Icons.arrow_back),
                    onPressed: () => Navigator.pop(context),
                  ),
                  title: Text('查看图片'),
                ),
                body: Center(
                  child: InteractiveViewer(
                    minScale: 0.5,
                    maxScale: 4.0,
                    child: Image.network(
                      message.imageUrl!,
                      loadingBuilder: (context, child, loadingProgress) {
                        if (loadingProgress == null) return child;
                        return Center(
                          child: CircularProgressIndicator(
                            value: loadingProgress.expectedTotalBytes != null
                                ? loadingProgress.cumulativeBytesLoaded /
                                    loadingProgress.expectedTotalBytes!
                                : null,
                          ),
                        );
                      },
                      errorBuilder: (context, error, stackTrace) => 
                        Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.error, color: Colors.red, size: 48),
                              SizedBox(height: 16),
                              Text('图片加载失败'),
                            ],
                          ),
                        ),
                    ),
                  ),
                ),
              ),
            ),
          );
        },
        child: ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Image.network(
            message.imageUrl!,
            height: 200,
            fit: BoxFit.cover,
            loadingBuilder: (context, child, loadingProgress) {
              if (loadingProgress == null) return child;
              return Container(
                width: 200,
                height: 200,
                child: Center(
                  child: CircularProgressIndicator(
                    value: loadingProgress.expectedTotalBytes != null
                        ? loadingProgress.cumulativeBytesLoaded /
                            loadingProgress.expectedTotalBytes!
                        : null,
                  ),
                ),
              );
            },
            errorBuilder: (context, error, stackTrace) => Container(
              width: 200,
              height: 150,
              color: Colors.grey[300],
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.error, color: Colors.red),
                    Text('图片加载失败', style: TextStyle(fontSize: 12)),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    } else if (message.isEmojiMessage) {
      // 表情包消息
      final emojiService = Provider.of<EmojiService>(context, listen: false);
      final emoji = emojiService.getEmojiById(message.emojiSource!);
      
      if (emoji != null) {
        // 检查是否为文本表情
        if (emoji.isLocal && emoji.assetPath != null && emoji.assetPath!.length <= 2) {
          // 文本表情直接显示
          return Container(
            padding: EdgeInsets.all(16),
            child: Text(
              emoji.assetPath!,
              style: const TextStyle(fontSize: 50),
            ),
          );
        } else {
          // 图片表情
          return Container(
            width: 120,
            height: 120,
            padding: EdgeInsets.all(8),
            child: emoji.isLocal
              ? Image.asset(
                  emoji.assetPath!,
                  fit: BoxFit.contain,
                  errorBuilder: (context, error, stackTrace) {
                    print('表情加载失败: ${emoji.assetPath}: $error');
                    return Center(
                      child: Container(
                        padding: EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: Colors.grey.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          emoji.name,
                          style: TextStyle(fontSize: 16),
                        ),
                      ),
                    );
                  },
                )
              : Image.network(
                  emoji.remoteUrl!,
                  fit: BoxFit.contain,
                  loadingBuilder: (context, child, loadingProgress) {
                    if (loadingProgress == null) return child;
                    return Center(
                      child: CircularProgressIndicator(
                        value: loadingProgress.expectedTotalBytes != null
                            ? loadingProgress.cumulativeBytesLoaded /
                                loadingProgress.expectedTotalBytes!
                            : null,
                        strokeWidth: 2.0,
                      ),
                    );
                  },
                  errorBuilder: (context, error, stackTrace) {
                    print('表情加载失败: ${emoji.remoteUrl}: $error');
                    return Center(
                      child: Container(
                        padding: EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: Colors.grey.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          emoji.name,
                          style: TextStyle(fontSize: 16),
                        ),
                      ),
                    );
                  },
                ),
          );
        }
      } else {
        // 表情包不在本地库中，尝试作为URL加载
        return Container(
          width: 120,
          height: 120,
          padding: EdgeInsets.all(8),
          child: Image.network(
            message.content,
            fit: BoxFit.contain,
            errorBuilder: (context, error, stackTrace) => Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.error, color: Colors.red),
                  Text('表情加载失败', style: TextStyle(fontSize: 12)),
                ],
              ),
            ),
          ),
        );
      }
    } else {
      // 未知消息类型
      return Text(
        '[未知消息类型]',
        style: TextStyle(fontStyle: FontStyle.italic),
      );
    }
  }

  /// 构建消息输入区域
  Widget _buildMessageInput() {
    return Column(
      children: [
        // 表情选择器
        if (_isShowingEmojiPicker)
          Container(
            height: 300,
            child: EmojiPicker(
              onEmojiSelected: (emoji) => _sendEmoji(emoji),
            ),
          ),
          
        // 输入框和按钮区域
        Container(
      padding: EdgeInsets.symmetric(horizontal: 8.0, vertical: 4.0),
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Colors.black12,
            offset: Offset(0, -1),
            blurRadius: 4,
          ),
        ],
      ),
      child: SafeArea(
        child: Row(
          children: [
                // 表情按钮
                IconButton(
                  icon: Icon(
                    _isShowingEmojiPicker
                        ? Icons.keyboard
                        : Icons.emoji_emotions,
                  ),
                  onPressed: _toggleEmojiPicker,
                  color: _isShowingEmojiPicker ? Theme.of(context).primaryColor : Colors.grey,
                ),
                
            // 图片选择按钮
            IconButton(
              icon: Icon(Icons.image),
              onPressed: _isSendingMessage ? null : _pickAndSendImage,
              color: Colors.blue,
              tooltip: '发送图片',
            ),
                
                // 表情包创建按钮 - 显示更多选项
                PopupMenuButton<String>(
                  icon: Icon(Icons.face_retouching_natural, color: Colors.orange),
                  tooltip: '创建表情包',
                  enabled: !_isSendingMessage,
                  onSelected: (String choice) {
                    switch (choice) {
                      case 'text':
                        _createTextEmoji();
                        break;
                      case 'photo':
                        _takePhotoAsEmoji();
                        break;
                      case 'gallery':
                        _pickImageAsEmoji();
                        break;
                    }
                  },
                  itemBuilder: (BuildContext context) => [
                    PopupMenuItem<String>(
                      value: 'text',
                      child: ListTile(
                        leading: Icon(Icons.text_fields, color: Colors.green),
                        title: Text('输入文字创建表情'),
                        dense: true,
                      ),
                    ),
                    PopupMenuItem<String>(
                      value: 'photo',
                      child: ListTile(
                        leading: Icon(Icons.camera_alt, color: Colors.blue),
                        title: Text('拍照创建表情'),
                        dense: true,
                      ),
                    ),
                    PopupMenuItem<String>(
                      value: 'gallery',
                      child: ListTile(
                        leading: Icon(Icons.photo_library, color: Colors.purple),
                        title: Text('从相册选择图片'),
                        dense: true,
                      ),
                    ),
                  ],
                ),
            
            // 文本输入框
            Expanded(
              child: TextField(
                controller: _textController,
                decoration: InputDecoration(
                  hintText: '输入消息...',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24.0),
                    borderSide: BorderSide.none,
                  ),
                  filled: true,
                  fillColor: Colors.grey[200],
                  contentPadding: EdgeInsets.symmetric(
                    horizontal: 16.0,
                    vertical: 8.0,
                  ),
                ),
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _sendTextMessage(),
              ),
            ),
            
            SizedBox(width: 8),
            
            // 发送按钮
            _isSendingMessage
                ? SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : IconButton(
                    icon: Icon(Icons.send),
                    onPressed: _sendTextMessage,
                    color: Colors.blue,
                  ),
          ],
        ),
      ),
        ),
      ],
    );
  }
}
