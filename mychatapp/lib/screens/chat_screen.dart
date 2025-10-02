import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:image_picker/image_picker.dart';
import '../models/models.dart';
import '../services/chat_service.dart';
import '../services/user_service.dart';
import '../services/presence_service.dart';
import '../services/location_service.dart';
import '../services/media_service.dart';
import '../widgets/message_bubble.dart';
import '../widgets/typing_indicator.dart';
import '../models/media_attachment_model.dart';
import 'map_screen.dart';

/// 聊天页面
/// 接收对方用户信息，显示消息记录和提供消息输入功能
/// 使用StreamBuilder实时监听消息变化
class ChatScreen extends StatefulWidget {
  final UserModel otherUser;

  const ChatScreen({
    Key? key,
    required this.otherUser,
  }) : super(key: key);

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final ChatService _chatService = ChatService();
  final MediaService _mediaService = MediaService();
  final LocationService _locationService = LocationService();
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  
  late String _chatRoomId;
  late String _currentUserId;
  bool _isLoading = false;
  bool _isUploadingMedia = false;
  MessageModel? _replyToMessage; // 回复的消息
  final List<String> _commonEmojis = ['👍', '❤️', '😂', '😮', '😢', '😡']; // 常用表情

  @override
  void initState() {
    super.initState();
    _initializeChat();
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  /// 初始化聊天
  void _initializeChat() {
    final currentUser = FirebaseAuth.instance.currentUser;
    if (currentUser == null) return;
    
    _currentUserId = currentUser.uid;
    _chatRoomId = ChatRoomModel.generateChatRoomId(_currentUserId, widget.otherUser.uid);
    
    // 标记消息为已读
    _markMessagesAsRead();
  }

  /// 标记消息为已读
  Future<void> _markMessagesAsRead() async {
    try {
      await _chatService.markMessagesAsRead(
        chatRoomId: _chatRoomId,
        userId: _currentUserId,
      );
    } catch (e) {
      // 标记已读失败不影响聊天功能
      print('标记已读失败：$e');
    }
  }

  /// 发送消息
  Future<void> _sendMessage() async {
    final text = _messageController.text.trim();
    
    if (text.isEmpty) return;

    try {
      setState(() {
        _isLoading = true;
      });

      if (_replyToMessage != null) {
        // 发送回复消息
        await _chatService.sendReplyMessage(
          receiverId: widget.otherUser.uid,
          senderId: _currentUserId,
          replyToMessageId: _replyToMessage!.messageId,
          text: text.isNotEmpty ? text : null,
        );
      } else {
        // 发送普通消息
        await _chatService.sendMessage(
          receiverId: widget.otherUser.uid,
          senderId: _currentUserId,
          text: text.isNotEmpty ? text : null,
        );
      }

      _messageController.clear();
      _clearReply(); // 清除回复状态
      _scrollController.animateTo(
        0,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    } catch (e) {
      _showError('发送消息失败：${e.toString()}');
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  /// 发送多媒体消息
  Future<void> _sendMediaMessage(MediaAttachmentModel attachment) async {
    try {
      setState(() {
        _isLoading = true;
      });

      if (_replyToMessage != null) {
        // 发送回复消息（包含附件）
        await _chatService.sendReplyMessage(
          receiverId: widget.otherUser.uid,
          senderId: _currentUserId,
          replyToMessageId: _replyToMessage!.messageId,
          attachment: attachment,
        );
      } else {
        // 发送普通多媒体消息
        await _chatService.sendMessage(
          receiverId: widget.otherUser.uid,
          senderId: _currentUserId,
          attachment: attachment,
        );
      }

      _clearReply(); // 清除回复状态
      _scrollController.animateTo(
        0,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    } catch (e) {
      _showError('发送消息失败：${e.toString()}');
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  /// 清除回复状态
  void _clearReply() {
    setState(() {
      _replyToMessage = null;
    });
  }

  /// 设置回复消息
  void _setReplyMessage(MessageModel message) {
    setState(() {
      _replyToMessage = message;
    });
  }

  /// 显示附件选择菜单
  void _showAttachmentOptions() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => Container(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              '选择附件类型',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _buildAttachmentOption(
                  icon: Icons.photo_camera,
                  label: '拍照',
                  onTap: () {
                    Navigator.pop(context);
                    _pickAndSendImage(ImageSource.camera);
                  },
                ),
                _buildAttachmentOption(
                  icon: Icons.photo_library,
                  label: '相册',
                  onTap: () {
                    Navigator.pop(context);
                    _pickAndSendImage(ImageSource.gallery);
                  },
                ),
                _buildAttachmentOption(
                  icon: Icons.mic,
                  label: '语音',
                  onTap: () {
                    Navigator.pop(context);
                    _recordAndSendAudio();
                  },
                ),
                _buildAttachmentOption(
                  icon: Icons.location_on,
                  label: '位置',
                  onTap: () {
                    Navigator.pop(context);
                    _sendLocationMessage();
                  },
                ),
              ],
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }

  /// 构建附件选择选项
  Widget _buildAttachmentOption({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Container(
            width: 60,
            height: 60,
            decoration: BoxDecoration(
              color: Theme.of(context).primaryColor.withOpacity(0.1),
              borderRadius: BorderRadius.circular(30),
            ),
            child: Icon(
              icon,
              color: Theme.of(context).primaryColor,
              size: 30,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: Colors.grey[600],
            ),
          ),
        ],
      ),
    );
  }

  /// 选择并发送图片
  Future<void> _pickAndSendImage(ImageSource source) async {
    setState(() {
      _isUploadingMedia = true;
    });

    try {
      final attachment = await _mediaService.pickAndUploadImage(source: source);
      if (attachment != null) {
        await _sendMediaMessage(attachment);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('图片发送失败：${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isUploadingMedia = false;
        });
      }
    }
  }

  /// 发送位置消息
  void _sendLocationMessage() {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => MapScreen(
          mode: MapMode.send,
          chatRoomId: _chatRoomId,
          senderId: _currentUserId,
        ),
      ),
    );
  }

  /// 录制并发送语音
  Future<void> _recordAndSendAudio() async {
    setState(() {
      _isUploadingMedia = true;
    });

    try {
      final attachment = await _mediaService.recordAndUploadAudio();
      if (attachment != null) {
        await _sendMediaMessage(attachment);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('语音发送失败：${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isUploadingMedia = false;
        });
      }
    }
  }

  /// 显示消息操作菜单
  void _showMessageMenu(MessageModel message) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => Container(
        padding: const EdgeInsets.symmetric(vertical: 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.reply),
              title: const Text('回复'),
              onTap: () {
                Navigator.pop(context);
                _setReplyMessage(message);
              },
            ),
            const Divider(),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Text(
                '表情回应',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: _commonEmojis.map((emoji) {
                  return GestureDetector(
                    onTap: () {
                      Navigator.pop(context);
                      _addReaction(message.messageId, emoji);
                    },
                    child: Container(
                      padding: const EdgeInsets.all(8),
                      child: Text(
                        emoji,
                        style: const TextStyle(fontSize: 24),
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  /// 添加表情回应
  Future<void> _addReaction(String messageId, String emoji) async {
    try {
      await _chatService.addReaction(
        chatRoomId: _chatRoomId,
        messageId: messageId,
        userId: _currentUserId,
        emoji: emoji,
      );
    } catch (e) {
      _showError('添加表情回应失败：${e.toString()}');
    }
  }

  /// 显示错误信息
  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.red,
      ),
    );
  }

  /// 滚动到底部
  void _scrollToBottom() {
    if (_scrollController.hasClients) {
      _scrollController.animateTo(
        0.0,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    }
  }

  /// 构建消息气泡
  Widget _buildMessageBubble(MessageModel message) {
    final isMe = message.senderId == _currentUserId;
    
    return GestureDetector(
      onLongPress: () => _showMessageMenu(message),
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 16),
        child: Row(
          mainAxisAlignment: isMe ? MainAxisAlignment.end : MainAxisAlignment.start,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            if (!isMe) ...[
              // 对方头像
              CircleAvatar(
                radius: 16,
                backgroundColor: Theme.of(context).primaryColor,
                backgroundImage: widget.otherUser.photoUrl != null 
                    ? NetworkImage(widget.otherUser.photoUrl!) 
                    : null,
                child: widget.otherUser.photoUrl == null
                    ? Text(
                        widget.otherUser.displayName.substring(0, 1).toUpperCase(),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                        ),
                      )
                    : null,
              ),
              const SizedBox(width: 8),
            ],
            
            // 消息内容
            Flexible(
              child: Column(
                crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                children: [
                  Column(
                    crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                    children: [
                      // 回复预览
                      if (message.replyToMessageId != null)
                        _buildReplyPreview(message.replyToMessageId!, isMe),
                      
                      // 主消息内容
                      _buildMessageContent(message, isMe),
                      
                      // 表情回应
                      if (message.reactions.isNotEmpty)
                        _buildReactions(message),
                    ],
                  ),
                  const SizedBox(height: 4),
                  
                  // 时间和状态
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        _formatMessageTime(message.timestamp),
                        style: TextStyle(
                          color: Colors.grey[600],
                          fontSize: 12,
                        ),
                      ),
                      if (isMe) ...[
                        const SizedBox(width: 4),
                        Icon(
                          _getStatusIcon(message.status),
                          size: 16,
                          color: message.status == MessageStatus.failed 
                              ? Colors.red 
                              : Colors.grey[600],
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            
            if (isMe) ...[
              const SizedBox(width: 8),
              // 自己的头像占位，保持对齐
              const SizedBox(width: 32),
            ],
          ],
        ),
      ),
    );
  }

  /// 构建消息内容（根据消息类型）
  Widget _buildMessageContent(MessageModel message, bool isMe) {
    switch (message.messageType) {
      case MessageType.text:
        return _buildTextMessage(message, isMe);
      case MessageType.image:
        return _buildImageMessage(message, isMe);
      case MessageType.audio:
        return _buildAudioMessage(message, isMe);
      case MessageType.video:
        return _buildVideoMessage(message, isMe);
      case MessageType.document:
        return _buildDocumentMessage(message, isMe);
      case MessageType.location:
        return _buildLocationMessage(message, isMe);
    }
  }

  /// 构建位置消息
  Widget _buildLocationMessage(MessageModel message, bool isMe) {
    if (message.attachmentId == null) {
      return _buildErrorMessage('位置信息缺失', isMe);
    }

    return FutureBuilder<LocationModel?>(
      future: _locationService.getLocationById(message.attachmentId!),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return _buildLoadingMessage(isMe);
        }

        if (!snapshot.hasData || snapshot.data == null) {
          return _buildErrorMessage('位置信息已失效', isMe);
        }

        final location = snapshot.data!;
        return GestureDetector(
          onTap: () => _viewLocationOnMap(location),
          child: Container(
            constraints: const BoxConstraints(
              maxWidth: 280,
            ),
            decoration: BoxDecoration(
              color: isMe 
                  ? Theme.of(context).primaryColor 
                  : Colors.grey[200],
              borderRadius: BorderRadius.only(
                topLeft: const Radius.circular(18),
                topRight: const Radius.circular(18),
                bottomLeft: Radius.circular(isMe ? 18 : 4),
                bottomRight: Radius.circular(isMe ? 4 : 18),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 静态地图预览
                Container(
                  height: 120,
                  width: double.infinity,
                  decoration: BoxDecoration(
                    color: Colors.grey[300],
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(18),
                      topRight: Radius.circular(18),
                    ),
                  ),
                  child: ClipRRect(
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(18),
                      topRight: Radius.circular(18),
                    ),
                    child: Image.network(
                      _locationService.generateStaticMapUrl(
                        latitude: location.latitude,
                        longitude: location.longitude,
                      ),
                      fit: BoxFit.cover,
                      errorBuilder: (context, error, stackTrace) {
                        return Container(
                          color: Colors.grey[300],
                          child: const Center(
                            child: Icon(
                              Icons.map,
                              size: 40,
                              color: Colors.grey,
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                ),
                // 位置信息
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(
                            _getLocationTypeIcon(location.type),
                            size: 16,
                            color: isMe ? Colors.white70 : Colors.grey[600],
                          ),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              location.name ?? '未知位置',
                              style: TextStyle(
                                color: isMe ? Colors.white : Colors.black87,
                                fontSize: 14,
                                fontWeight: FontWeight.bold,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                      if (location.address != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          location.address!,
                          style: TextStyle(
                            color: isMe ? Colors.white70 : Colors.grey[600],
                            fontSize: 12,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                      const SizedBox(height: 4),
                      Text(
                        '点击查看详细地图',
                        style: TextStyle(
                          color: isMe ? Colors.white60 : Colors.grey[500],
                          fontSize: 11,
                          fontStyle: FontStyle.italic,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  /// 构建加载消息
  Widget _buildLoadingMessage(bool isMe) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: isMe 
            ? Theme.of(context).primaryColor 
            : Colors.grey[200],
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(18),
          topRight: const Radius.circular(18),
          bottomLeft: Radius.circular(isMe ? 18 : 4),
          bottomRight: Radius.circular(isMe ? 4 : 18),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: isMe ? Colors.white : Colors.grey[600],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '加载中...',
            style: TextStyle(
              color: isMe ? Colors.white : Colors.black87,
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }

  /// 构建错误消息
  Widget _buildErrorMessage(String errorText, bool isMe) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: isMe 
            ? Theme.of(context).primaryColor 
            : Colors.grey[200],
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(18),
          topRight: const Radius.circular(18),
          bottomLeft: Radius.circular(isMe ? 18 : 4),
          bottomRight: Radius.circular(isMe ? 4 : 18),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.error_outline,
            size: 16,
            color: isMe ? Colors.white70 : Colors.grey[600],
          ),
          const SizedBox(width: 8),
          Text(
            errorText,
            style: TextStyle(
              color: isMe ? Colors.white : Colors.black87,
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }

  /// 获取位置类型图标
  IconData _getLocationTypeIcon(LocationType type) {
    switch (type) {
      case LocationType.currentLocation:
        return Icons.my_location;
      case LocationType.pointOfInterest:
        return Icons.place;
      case LocationType.liveLocation:
        return Icons.share_location;
    }
  }

  /// 在地图上查看位置
  void _viewLocationOnMap(LocationModel location) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => MapScreen(
          mode: MapMode.view,
          viewLocation: location,
        ),
      ),
    );
  }

  /// 构建文本消息
  Widget _buildTextMessage(MessageModel message, bool isMe) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: isMe 
            ? Theme.of(context).primaryColor 
            : Colors.grey[200],
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(18),
          topRight: const Radius.circular(18),
          bottomLeft: Radius.circular(isMe ? 18 : 4),
          bottomRight: Radius.circular(isMe ? 4 : 18),
        ),
      ),
      child: Text(
        message.text ?? '',
        style: TextStyle(
          color: isMe ? Colors.white : Colors.black87,
          fontSize: 16,
        ),
      ),
    );
  }

  /// 构建图片消息
  Widget _buildImageMessage(MessageModel message, bool isMe) {
    return Container(
      constraints: const BoxConstraints(
        maxWidth: 250,
        maxHeight: 400,
      ),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(18),
          topRight: const Radius.circular(18),
          bottomLeft: Radius.circular(isMe ? 18 : 4),
          bottomRight: Radius.circular(isMe ? 4 : 18),
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 图片预览
          if (message.mediaUrl != null)
            GestureDetector(
              onTap: () => _showImagePreview(message.mediaUrl!),
              child: Image.network(
                message.mediaUrl!,
                fit: BoxFit.cover,
                loadingBuilder: (context, child, loadingProgress) {
                  if (loadingProgress == null) return child;
                  return Container(
                    height: 200,
                    color: Colors.grey[300],
                    child: const Center(
                      child: CircularProgressIndicator(),
                    ),
                  );
                },
                errorBuilder: (context, error, stackTrace) {
                  return Container(
                    height: 200,
                    color: Colors.grey[300],
                    child: const Center(
                      child: Icon(Icons.error, color: Colors.red),
                    ),
                  );
                },
              ),
            )
          else
            Container(
              height: 200,
              color: Colors.grey[300],
              child: const Center(
                child: Icon(Icons.image, size: 50),
              ),
            ),
          
          // 用户添加的文本说明
          if ((message.text?.isNotEmpty ?? false) && message.text != '[图片]')
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              color: isMe ? Theme.of(context).primaryColor : Colors.grey[200],
              child: Text(
                message.text!,
                style: TextStyle(
                  color: isMe ? Colors.white : Colors.black87,
                  fontSize: 14,
                ),
              ),
            ),
        ],
      ),
    );
  }


  /// 构建语音消息
  Widget _buildAudioMessage(MessageModel message, bool isMe) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 280),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(18),
          topRight: const Radius.circular(18),
          bottomLeft: Radius.circular(isMe ? 18 : 4),
          bottomRight: Radius.circular(isMe ? 4 : 18),
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 语音播放控件
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: isMe 
                  ? Theme.of(context).primaryColor 
                  : Colors.grey[200],
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.play_arrow,
                  color: isMe ? Colors.white : Colors.black87,
                  size: 24,
                ),
                const SizedBox(width: 8),
                Icon(
                  Icons.graphic_eq,
                  color: isMe ? Colors.white : Colors.black87,
                  size: 20,
                ),
                const SizedBox(width: 8),
                Text(
                  '语音消息',
                  style: TextStyle(
                    color: isMe ? Colors.white : Colors.black87,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// 构建视频消息
  Widget _buildVideoMessage(MessageModel message, bool isMe) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isMe 
            ? Theme.of(context).primaryColor 
            : Colors.grey[200],
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(18),
          topRight: const Radius.circular(18),
          bottomLeft: Radius.circular(isMe ? 18 : 4),
          bottomRight: Radius.circular(isMe ? 4 : 18),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.videocam,
            color: isMe ? Colors.white : Colors.black87,
          ),
          const SizedBox(width: 8),
          Text(
            '视频消息',
            style: TextStyle(
              color: isMe ? Colors.white : Colors.black87,
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }

  /// 构建文档消息
  Widget _buildDocumentMessage(MessageModel message, bool isMe) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isMe 
            ? Theme.of(context).primaryColor 
            : Colors.grey[200],
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(18),
          topRight: const Radius.circular(18),
          bottomLeft: Radius.circular(isMe ? 18 : 4),
          bottomRight: Radius.circular(isMe ? 4 : 18),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.description,
            color: isMe ? Colors.white : Colors.black87,
          ),
          const SizedBox(width: 8),
          Text(
            '文档消息',
            style: TextStyle(
              color: isMe ? Colors.white : Colors.black87,
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }

  /// 构建回复预览
  Widget _buildReplyPreview(String replyToMessageId, bool isMe) {
    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.grey[300],
        borderRadius: BorderRadius.circular(8),
        border: Border(
          left: BorderSide(color: Theme.of(context).primaryColor, width: 3),
        ),
      ),
      child: FutureBuilder<MessageModel?>(
        future: _getMessageById(replyToMessageId),
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const Text(
              '正在加载回复消息...',
              style: TextStyle(
                fontSize: 12,
                fontStyle: FontStyle.italic,
                color: Colors.grey,
              ),
            );
          }
          
          final replyMessage = snapshot.data!;
          return Text(
            _getMessagePreviewText(replyMessage),
            style: const TextStyle(
              fontSize: 12,
              fontStyle: FontStyle.italic,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          );
        },
      ),
    );
  }

  /// 根据消息ID获取消息
  Future<MessageModel?> _getMessageById(String messageId) async {
    try {
      return await _chatService.getMessageById(messageId);
    } catch (e) {
      print('获取消息失败: $e');
      return null;
    }
  }


  /// 格式化消息时间
  String _formatMessageTime(Timestamp timestamp) {
    final messageTime = timestamp.toDate();
    final now = DateTime.now();
    final difference = now.difference(messageTime);
    
    if (difference.inDays > 0) {
      return '${messageTime.month}/${messageTime.day} ${messageTime.hour.toString().padLeft(2, '0')}:${messageTime.minute.toString().padLeft(2, '0')}';
    } else if (difference.inHours > 0) {
      return '${messageTime.hour.toString().padLeft(2, '0')}:${messageTime.minute.toString().padLeft(2, '0')}';
    } else if (difference.inMinutes > 0) {
      return '${difference.inMinutes}分钟前';
    } else {
      return '刚刚';
    }
  }

  /// 获取消息状态图标
  IconData _getStatusIcon(MessageStatus status) {
    switch (status) {
      case MessageStatus.sending:
        return Icons.access_time;
      case MessageStatus.sent:
        return Icons.done;
      case MessageStatus.delivered:
        return Icons.done_all;
      case MessageStatus.read:
        return Icons.done_all;
      case MessageStatus.failed:
        return Icons.error;
    }
  }

  /// 获取消息预览文本
  String _getMessagePreviewText(MessageModel message) {
    switch (message.messageType) {
      case MessageType.text:
        return message.text ?? '';
      case MessageType.image:
        return '[图片]';
      case MessageType.audio:
        return '[语音]';
      case MessageType.video:
        return '[视频]';
      case MessageType.document:
        return '[文档]';
      case MessageType.location:
        return '[位置]';
    }
  }

  /// 显示图片预览
  void _showImagePreview(String imageUrl) {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        backgroundColor: Colors.black,
        child: Stack(
          children: [
            Center(
              child: InteractiveViewer(
                child: Image.network(
                  imageUrl,
                  fit: BoxFit.contain,
                ),
              ),
            ),
            Positioned(
              top: 40,
              right: 20,
              child: IconButton(
                icon: const Icon(Icons.close, color: Colors.white, size: 30),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// 构建表情回应
  Widget _buildReactions(MessageModel message) {
    if (message.reactions.isEmpty) return const SizedBox.shrink();
    
    return Container(
      margin: const EdgeInsets.only(top: 4),
      child: Wrap(
        spacing: 4,
        runSpacing: 4,
        children: message.reactions.map((reaction) {
          final emoji = reaction['emoji'] as String;
          final count = reaction['count'] as int;
          final userIds = List<String>.from(reaction['userIds'] ?? []);
          final hasCurrentUserReacted = userIds.contains(_currentUserId);
          
          return GestureDetector(
            onTap: () => _addReaction(message.messageId, emoji),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: hasCurrentUserReacted 
                    ? Theme.of(context).primaryColor.withOpacity(0.2)
                    : Colors.grey[200],
                borderRadius: BorderRadius.circular(12),
                border: hasCurrentUserReacted
                    ? Border.all(color: Theme.of(context).primaryColor, width: 1)
                    : null,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(emoji, style: const TextStyle(fontSize: 14)),
                  if (count > 1) ...[
                    const SizedBox(width: 4),
                    Text(
                      count.toString(),
                      style: TextStyle(
                        fontSize: 12,
                        color: hasCurrentUserReacted 
                            ? Theme.of(context).primaryColor 
                            : Colors.grey[600],
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          );
        }).toList(),
      ),
    );
  }


  /// 构建输入区域
  Widget _buildInputArea() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(
          top: BorderSide(color: Colors.grey[300]!),
        ),
      ),
      child: Column(
        children: [
          // 回复预览区域
          if (_replyToMessage != null)
            _buildReplyInputPreview(),
          
          // 输入区域
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                // 附件按钮
                Container(
                  decoration: BoxDecoration(
                    color: Colors.grey[300],
                    shape: BoxShape.circle,
                  ),
                  child: IconButton(
                    icon: _isUploadingMedia
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                            ),
                          )
                        : const Icon(Icons.attach_file, color: Colors.grey),
                    onPressed: _isUploadingMedia ? null : _showAttachmentOptions,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Container(
                    decoration: BoxDecoration(
                      color: Colors.grey[100],
                      borderRadius: BorderRadius.circular(25),
                    ),
                    child: TextField(
                      controller: _messageController,
                      decoration: const InputDecoration(
                        hintText: '输入消息...',
                        border: InputBorder.none,
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: 20,
                          vertical: 10,
                        ),
                      ),
                      maxLines: null,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _sendMessage(),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                // 发送按钮
                Container(
                  decoration: BoxDecoration(
                    color: Theme.of(context).primaryColor,
                    shape: BoxShape.circle,
                  ),
                  child: IconButton(
                    icon: _isLoading
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.send, color: Colors.white),
                    onPressed: _isLoading ? null : _sendMessage,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// 构建输入区域的回复预览
  Widget _buildReplyInputPreview() {
    if (_replyToMessage == null) return const SizedBox.shrink();
    
    final isReplyFromMe = _replyToMessage!.senderId == _currentUserId;
    
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      decoration: BoxDecoration(
        color: Colors.grey[50],
        border: Border(
          left: BorderSide(
            color: Theme.of(context).primaryColor,
            width: 3,
          ),
        ),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.reply,
            size: 16,
            color: Colors.grey,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '回复给 ${isReplyFromMe ? "你" : widget.otherUser.displayName}',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).primaryColor,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _getMessagePreviewText(_replyToMessage!),
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.grey[600],
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.close, size: 18),
            onPressed: _clearReply,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
            color: Colors.grey[600],
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            CircleAvatar(
              radius: 18,
              backgroundColor: Theme.of(context).primaryColor,
              backgroundImage: widget.otherUser.photoUrl != null 
                  ? NetworkImage(widget.otherUser.photoUrl!) 
                  : null,
              child: widget.otherUser.photoUrl == null
                  ? Text(
                      widget.otherUser.displayName.substring(0, 1).toUpperCase(),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                      ),
                    )
                  : null,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.otherUser.displayName,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    '在线',
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.grey[400],
                    ),
                    ),
                ],
              ),
            ),
          ],
        ),
        backgroundColor: Theme.of(context).primaryColor,
        foregroundColor: Colors.white,
        elevation: 1,
        actions: [
          PopupMenuButton<String>(
            onSelected: (value) async {
              switch (value) {
                case 'clear':
                  final confirm = await showDialog<bool>(
                    context: context,
                    builder: (context) => AlertDialog(
                      title: const Text('清除聊天记录'),
                      content: const Text('确定要清除所有聊天记录吗？此操作不可撤销。'),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.of(context).pop(false),
                          child: const Text('取消'),
                        ),
                        TextButton(
                          onPressed: () => Navigator.of(context).pop(true),
                          child: const Text('清除'),
                        ),
                      ],
                    ),
                  );
                  
                  if (confirm == true) {
                    try {
                      await _chatService.clearChatHistory(_chatRoomId);
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('聊天记录已清除')),
                        );
                      }
                    } catch (e) {
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text('清除失败：${e.toString()}'),
                            backgroundColor: Colors.red,
                          ),
                        );
                      }
                    }
                  }
                  break;
              }
            },
            itemBuilder: (context) => [
              const PopupMenuItem(
                value: 'clear',
                child: Row(
                  children: [
                    Icon(Icons.clear_all),
                    SizedBox(width: 8),
                    Text('清除聊天记录'),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          // 消息列表
          Expanded(
            child: StreamBuilder<List<MessageModel>>(
              stream: _chatService.getMessagesStream(chatRoomId: _chatRoomId),
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
                        Icon(
                          Icons.error_outline,
                          size: 64,
                          color: Colors.grey[400],
                        ),
                        const SizedBox(height: 16),
                        Text(
                          '加载消息失败',
                          style: TextStyle(
                            fontSize: 16,
                            color: Colors.grey[600],
                          ),
                        ),
                        const SizedBox(height: 8),
                        ElevatedButton(
                          onPressed: () {
                            setState(() {}); // 触发重建
                          },
                          child: const Text('重试'),
                        ),
                      ],
                    ),
                  );
                }

                final messages = snapshot.data ?? [];

                if (messages.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.chat_bubble_outline,
                          size: 64,
                          color: Colors.grey[400],
                        ),
                        const SizedBox(height: 16),
                        Text(
                          '还没有消息',
                          style: TextStyle(
                            fontSize: 16,
                            color: Colors.grey[600],
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '发送第一条消息开始聊天吧！',
                          style: TextStyle(
                            fontSize: 14,
                            color: Colors.grey[500],
                          ),
                        ),
                      ],
                    ),
                  );
                }

                // 消息按时间倒序排列，最新消息在底部
                return ListView.builder(
                  controller: _scrollController,
                  reverse: true, // 反向排列，最新消息在底部
                  itemCount: messages.length,
                  itemBuilder: (context, index) {
                    return _buildMessageBubble(messages[index]);
                  },
                );
              },
            ),
          ),
          
          // 消息输入区域
          _buildInputArea(),
        ],
      ),
    );
  }
}
