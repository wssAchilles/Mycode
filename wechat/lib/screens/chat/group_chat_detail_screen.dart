import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../../models/message_model.dart';
import '../../models/group_model.dart';
import '../../models/emoji_model.dart';
import '../../services/auth_service.dart';
import '../../services/chat_service.dart';
import '../../services/group_service.dart';
import '../../services/emoji_service.dart';
import '../group/group_info_screen.dart';
import '../../widgets/animated_message_bubble.dart';
import '../../widgets/emoji_picker.dart';

/// 群聊消息详情页面
class GroupChatDetailScreen extends StatefulWidget {
  final String groupId;
  final String groupName;

  const GroupChatDetailScreen({
    Key? key,
    required this.groupId,
    required this.groupName,
  }) : super(key: key);

  @override
  State<GroupChatDetailScreen> createState() => _GroupChatDetailScreenState();
}

class _GroupChatDetailScreenState extends State<GroupChatDetailScreen> {
  // 消息列表
  final List<MessageModel> _messages = [];
  
  // 消息输入控制器
  final TextEditingController _messageController = TextEditingController();
  
  // 滚动控制器
  final ScrollController _scrollController = ScrollController();
  
  // 群组信息
  GroupModel? _groupInfo;
  
  // ChatService实例
  ChatService? _chatService;
  
  // 状态标记
  bool _isLoading = true;
  bool _isSendingMessage = false;
  bool _isSendingImage = false;
  bool _isShowingEmojiPicker = false; // 是否显示表情选择器
  String? _error;
  
  // 用户信息缓存
  final Map<String, String?> _userAvatars = {};
  final Map<String, String> _usernames = {};
  
  // 图片数据（Web平台使用）
  Uint8List? _imageBytes;
  
  // UUID生成器
  final _uuid = const Uuid();
  
  @override
  void initState() {
    super.initState();
    _loadGroupInfo();
    _loadMessages();
    
    // 创建方法引用，用于ChatService回调
    final chatService = Provider.of<ChatService>(context, listen: false);
    chatService.groupChatHistoryCallback = _loadMessages;
    
    // 添加消息更新监听器
    chatService.addListener(_onChatServiceUpdate);
  }
  
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // 仅在首次依赖改变时获取实例
    if (_chatService == null) {
      _chatService = Provider.of<ChatService>(context, listen: false);
      // 如果有需要使用_chatService的初始化逻辑，可以放在这里
    }
  }
  
  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    
    // 移除回调引用和监听器，使用保存的_chatService实例
    if (_chatService != null) {
      if (_chatService!.onGroupChatHistoryRefresh == _loadMessages) {
        _chatService!.groupChatHistoryCallback = null;
      }
      _chatService!.removeListener(_onChatServiceUpdate);
    }
    
    super.dispose();
  }
  
  /// 加载群组信息
  Future<void> _loadGroupInfo() async {
    try {
      final groupService = Provider.of<GroupService>(context, listen: false);
      final group = await groupService.getGroup(widget.groupId);
      
      if (mounted) {
        setState(() {
          _groupInfo = group;
        });
      }
    } catch (e) {
      print('加载群组信息错误: $e');
      if (mounted) {
        setState(() {
          _error = '无法加载群组信息';
        });
      }
    }
  }
  
  /// 加载消息
  Future<void> _loadMessages() async {
    try {
      if (mounted) {
        setState(() {
          _isLoading = true;
          _error = null;
        });
      }
      
      final chatService = Provider.of<ChatService>(context, listen: false);
      
      // 加载群聊消息
      final messages = await chatService.loadGroupMessages(widget.groupId);
      
      // 预加载消息发送者信息
      final authService = Provider.of<AuthService>(context, listen: false);
      final userIds = <String>{};
      for (final message in messages) {
        if (!userIds.contains(message.senderId)) {
          userIds.add(message.senderId);
        }
      }
      
      for (final userId in userIds) {
        final user = await authService.getUserInfo(userId);
        if (user != null) {
          _userAvatars[userId] = user.avatarUrl;
          _usernames[userId] = user.username;
        }
      }
      
      if (mounted) {
        setState(() {
          _messages.clear();
          _messages.addAll(messages);
          _isLoading = false;
        });
        
        // 消息加载后，等待多个帧的渲染完成再滚动
        WidgetsBinding.instance.addPostFrameCallback((_) {
          Future.delayed(Duration(milliseconds: 100), () {
            _scrollToBottom(animated: false);
          });
        });
      }
    } catch (e) {
      print('加载消息错误: $e');
      if (mounted) {
        setState(() {
          _error = '无法加载聊天记录';
          _isLoading = false;
        });
      }
    }
  }
  
  /// 滚动到底部
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
  
  /// 处理聊天服务的消息更新
  void _onChatServiceUpdate() async {
    // 检查widget是否已经被销毁
    if (!mounted) return;
    
    final authService = Provider.of<AuthService>(context, listen: false);
    final chatService = Provider.of<ChatService>(context, listen: false);
    
    final currentUser = authService.currentUser;
    if (currentUser == null) return;
    
    try {
      // 重新加载群聊消息
      final newMessages = await chatService.loadGroupMessages(widget.groupId);
      
      // 检查是否有新消息（通过消息ID或数量对比）
      bool hasNewMessages = newMessages.length != _messages.length;
      if (!hasNewMessages && newMessages.isNotEmpty && _messages.isNotEmpty) {
        // 检查最后一条消息是否不同
        final lastNewMessageId = newMessages.last.messageId;
        final lastCurrentMessageId = _messages.last.messageId;
        hasNewMessages = lastNewMessageId != lastCurrentMessageId;
      }
      
      if (hasNewMessages) {
        setState(() {
          _messages.clear();
          _messages.addAll(newMessages);
        });
        
        // 滚动到底部（使用动画）
        _scrollToBottom(animated: true);
        
        // TODO: 实现群聊消息已读状态管理
        // _markReceivedMessagesAsRead(currentUser.userId);
      }
    } catch (e) {
      print('群聊消息更新错误: $e');
    }
  }
  
  /// 发送文本消息
  Future<void> _sendTextMessage() async {
    final text = _messageController.text.trim();
    if (text.isEmpty || _isSendingMessage) return;
    
    setState(() {
      _isSendingMessage = true;
    });
    
    try {
      final chatService = Provider.of<ChatService>(context, listen: false);
      
      // 清空输入框
      _messageController.clear();
      
      // 发送消息
      final message = await chatService.sendGroupTextMessage(
        groupId: widget.groupId,
        content: text,
      );
      
      if (message != null && mounted) {
        // 消息发送成功，等待轮询机制更新消息列表
        // 不立即添加到本地列表，避免重复显示
        setState(() {
          _isSendingMessage = false;
        });
        _scrollToBottom();
      } else {
        setState(() {
          _isSendingMessage = false;
        });
      }
    } catch (e) {
      print('发送消息错误: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('发送消息失败: $e')),
      );
      
      if (mounted) {
        setState(() {
          _isSendingMessage = false;
        });
      }
    }
  }
  
  /// 选择并发送图片
  Future<void> _pickAndSendImage() async {
    try {
      final ImagePicker picker = ImagePicker();
      final XFile? image = await picker.pickImage(source: ImageSource.gallery);
      
      if (image != null) {
        final chatService = Provider.of<ChatService>(context, listen: false);
        final messageId = _uuid.v4();
        
        // 显示发送中提示
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('正在发送图片...')),
        );
        
        setState(() {
          _isSendingImage = true;
        });
        
        MessageModel? message;
        
        if (kIsWeb) {
          // Web平台：使用字节数据
          final bytes = await image.readAsBytes();
          message = await chatService.sendGroupImageMessageWithBytes(
            groupId: widget.groupId,
            imageBytes: bytes,
            messageId: messageId,
          );
        } else {
          // 非Web平台：使用文件
          message = await chatService.sendGroupImageMessage(
            groupId: widget.groupId,
            imageFile: File(image.path),
            messageId: messageId,
          );
        }
        
        if (message != null && mounted) {
          // 消息发送成功，等待轮询机制更新消息列表
          setState(() {
            _isSendingImage = false;
          });
          _scrollToBottom();
          
          // 清除提示
          ScaffoldMessenger.of(context).hideCurrentSnackBar();
        } else {
          setState(() {
            _isSendingImage = false;
          });
        }
      }
    } catch (e) {
      print('发送图片错误: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('发送图片失败: $e')),
      );
      
      if (mounted) {
        setState(() {
          _isSendingImage = false;
        });
      }
    }
  }
  
  /// 发送表情包
  Future<void> _sendEmoji(EmojiModel emoji) async {
    try {
      final chatService = Provider.of<ChatService>(context, listen: false);
      
      // 关闭表情选择器
      setState(() {
        _isShowingEmojiPicker = false;
        _isSendingMessage = true;
      });
      
      // 发送表情包消息
      final message = await chatService.sendGroupEmojiMessage(
        groupId: widget.groupId,
        emojiId: emoji.id,
      );
      
      if (message != null && mounted) {
        // 消息发送成功，等待轮询机制更新消息列表
        setState(() {
          _isSendingMessage = false;
        });
        _scrollToBottom();
      } else {
        setState(() {
          _isSendingMessage = false;
        });
      }
    } catch (e) {
      print('发送表情包错误: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('发送表情包失败: $e')),
      );
      
      if (mounted) {
        setState(() {
          _isSendingMessage = false;
        });
      }
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
      final pickedFile = await ImagePicker().pickImage(
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
      
      if (newEmoji != null && mounted) {
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
        imageBytes: placeholderImageBytes,
        name: emojiName,
        category: '自定义', // 默认添加到自定义分类
      );
      
      if (newEmoji != null && mounted) {
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
  
  /// 获取用户名
  String _getUsernameById(String userId) {
    if (_usernames.containsKey(userId)) {
      return _usernames[userId]!;
    }
    return '群成员';
  }

  @override
  Widget build(BuildContext context) {
    final authService = Provider.of<AuthService>(context);
    final currentUserId = authService.currentUser?.userId;
    final theme = Theme.of(context);
    
    return Scaffold(
      appBar: AppBar(
        title: GestureDetector(
          onTap: () {
            if (_groupInfo != null) {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (context) => GroupInfoScreen(group: _groupInfo!),
                ),
              );
            }
          },
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                widget.groupName,
                style: const TextStyle(fontSize: 16),
              ),
              if (_groupInfo != null)
                Text(
                  '${_groupInfo!.members.length}人',
                  style: TextStyle(
                    fontSize: 12,
                    color: theme.colorScheme.onSurface.withOpacity(0.7),
                  ),
                ),
            ],
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.info_outline),
            onPressed: () {
              if (_groupInfo != null) {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (context) => GroupInfoScreen(group: _groupInfo!),
                  ),
                );
              }
            },
          ),
        ],
      ),
      body: _error != null
          ? Center(child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)))
          : Column(
              children: [
                // 消息列表
                Expanded(
                  child: _isLoading && _messages.isEmpty
                      ? const Center(child: CircularProgressIndicator())
                      : ListView.builder(
                          controller: _scrollController,
                          padding: const EdgeInsets.all(8.0),
                          itemCount: _messages.length,
                          itemBuilder: (context, index) {
                            final message = _messages[index];
                            final isMe = message.senderId == currentUserId;
                            final previousMessage = index > 0 ? _messages[index - 1] : null;
                            
                            // 判断是否需要显示日期分隔符
                            bool showDateSeparator = true;
                            if (previousMessage != null) {
                              final previousDate = previousMessage.formattedDate;
                              showDateSeparator = message.formattedDate != previousDate;
                            }
                            
                            // 是否需要显示发送者名称
                            final showSenderName = !isMe && 
                                (index == 0 || 
                                 _messages[index - 1].senderId != message.senderId || 
                                 showDateSeparator);
                            
                            return Column(
                              children: [
                                // 日期分隔符
                                if (showDateSeparator)
                                  Padding(
                                    padding: const EdgeInsets.symmetric(vertical: 16.0),
                                    child: Text(
                                      message.formattedDate,
                                      style: TextStyle(
                                        fontSize: 12,
                                        color: theme.colorScheme.onSurface.withOpacity(0.6),
                                      ),
                                    ),
                                  ),
                                
                                // 消息气泡
                                _buildMessageItem(message, isMe, showSenderName),
                              ],
                            );
                          },
                        ),
                ),
                
                // 输入区域
                Column(
                  children: [
                    // 表情选择器
                    if (_isShowingEmojiPicker)
                      Container(
                        height: 300,
                        child: EmojiPicker(
                          onEmojiSelected: (emoji) => _sendEmoji(emoji),
                        ),
                      ),
                    
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8.0, vertical: 4.0),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surface,
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.05),
                        blurRadius: 3,
                        offset: const Offset(0, -1),
                      ),
                    ],
                  ),
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
                            color: _isShowingEmojiPicker 
                                ? theme.primaryColor 
                                : Colors.grey,
                          ),
                      
                      // 图片选择按钮
                      IconButton(
                        icon: _isSendingImage 
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.photo),
                        onPressed: _isSendingImage ? null : _pickAndSendImage,
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
                      
                      // 消息输入框
                      Expanded(
                        child: TextField(
                          controller: _messageController,
                          decoration: InputDecoration(
                            hintText: '发送消息...',
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(24.0),
                              borderSide: BorderSide.none,
                            ),
                            filled: true,
                            fillColor: theme.colorScheme.surfaceVariant,
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 16.0, 
                              vertical: 8.0,
                            ),
                          ),
                          textInputAction: TextInputAction.send,
                              onSubmitted: (_) => _sendTextMessage(),
                          maxLines: null,
                        ),
                      ),
                      
                      // 发送按钮
                      IconButton(
                        icon: _isSendingMessage 
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.send),
                            onPressed: _isSendingMessage ? null : _sendTextMessage,
                      ),
                    ],
                  ),
                    ),
                  ],
                ),
              ],
            ),
    );
  }
  
  /// 构建消息项
  Widget _buildMessageItem(MessageModel message, bool isMe, bool showSenderName) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8.0),
      child: Column(
        crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          // 显示发送者名称（如果需要）
          if (showSenderName && !isMe)
            Padding(
              padding: const EdgeInsets.only(left: 50.0, bottom: 2.0),
              child: Text(
                _getUsernameById(message.senderId),
                style: TextStyle(
                  fontSize: 12,
                  color: Theme.of(context).colorScheme.onSurface.withOpacity(0.7),
                ),
              ),
            ),
          
          // 消息内容
          Row(
            mainAxisAlignment: isMe ? MainAxisAlignment.end : MainAxisAlignment.start,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              // 头像（非自己的消息显示）
              if (!isMe)
                Padding(
                  padding: const EdgeInsets.only(right: 8.0),
                  child: CircleAvatar(
                    radius: 20,
                    backgroundImage: _userAvatars[message.senderId] != null
                        ? NetworkImage(_userAvatars[message.senderId]!)
                        : null,
                    child: _userAvatars[message.senderId] == null
                        ? Text(_getUsernameById(message.senderId).isNotEmpty 
                            ? _getUsernameById(message.senderId)[0] 
                            : '?')
                        : null,
                  ),
                ),
              
              // 消息气泡
              Flexible(
                child: AnimatedMessageBubble(
                  message: message,
                  isMe: isMe,
                  child: _buildMessageContent(message, isMe),
                ),
              ),
              
              // 头像（自己的消息不显示）
              if (isMe)
                const SizedBox(width: 40), // 占位，保持对称
            ],
          ),
        ],
      ),
    );
  }
  
  /// 构建消息内容
  Widget _buildMessageContent(MessageModel message, bool isMe) {
    final theme = Theme.of(context);
    
    // 根据消息类型选择不同的显示方式
    if (message.messageType == MessageType.emoji) {
      // 表情包消息
      final emojiService = Provider.of<EmojiService>(context, listen: false);
      final emoji = emojiService.getEmojiById(message.content);
      
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
    } else if (message.messageType == MessageType.image) {
      // 图片消息
      return GestureDetector(
        onTap: () {
          // TODO: 实现图片预览
        },
        child: ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: Image.network(
            message.content,
            width: 200,
            fit: BoxFit.cover,
            loadingBuilder: (context, child, loadingProgress) {
              if (loadingProgress == null) return child;
              return Container(
                width: 200,
                height: 150,
                padding: const EdgeInsets.all(8.0),
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
                width: 200,
                height: 100,
                padding: const EdgeInsets.all(8.0),
                color: theme.colorScheme.errorContainer,
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.error_outline, color: theme.colorScheme.error),
                      const SizedBox(height: 4),
                      Text('图片加载失败',
                        style: TextStyle(color: theme.colorScheme.error),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      );
    } else if (message.messageType == 'file') {
      // 文件类型消息
      return Container(
        padding: const EdgeInsets.all(12.0),
        decoration: BoxDecoration(
          color: isMe ? theme.colorScheme.primaryContainer.withOpacity(0.6) : theme.colorScheme.surfaceVariant,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.insert_drive_file, color: isMe ? theme.colorScheme.primary : theme.colorScheme.secondary),
            const SizedBox(width: 8),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('文件',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: isMe ? theme.colorScheme.primary : theme.colorScheme.secondary,
                    ),
                  ),
                  Text(message.content,
                    style: TextStyle(
                      fontSize: 12,
                      color: isMe ? theme.colorScheme.onPrimaryContainer : theme.colorScheme.onSurfaceVariant,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    } else {
      // 默认文本消息
      return Container(
        padding: const EdgeInsets.all(12.0),
        decoration: BoxDecoration(
          color: isMe ? theme.colorScheme.primaryContainer : theme.colorScheme.surfaceVariant,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          message.content,
          style: TextStyle(
            color: isMe ? theme.colorScheme.onPrimaryContainer : theme.colorScheme.onSurfaceVariant,
            fontSize: 16,
          ),
        ),
      );
    }
  }
}
