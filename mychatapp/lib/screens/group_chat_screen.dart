import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/models.dart';
import '../services/auth_service.dart';
import '../services/group_service.dart';
import '../services/media_service.dart';
import 'package:image_picker/image_picker.dart';

/// 群聊页面
/// 显示群组消息列表，支持发送文本和多媒体消息
class GroupChatScreen extends StatefulWidget {
  final GroupModel group;

  const GroupChatScreen({
    Key? key,
    required this.group,
  }) : super(key: key);

  @override
  State<GroupChatScreen> createState() => _GroupChatScreenState();
}

class _GroupChatScreenState extends State<GroupChatScreen> {
  final AuthService _authService = AuthService();
  final GroupService _groupService = GroupService();
  final MediaService _mediaService = MediaService();
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  
  late String _currentUserId;
  bool _isLoading = false;
  bool _isUploadingMedia = false;

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
  Future<void> _initializeChat() async {
    try {
      final currentUser = _authService.currentUser;
      if (currentUser == null) {
        throw Exception('用户未登录');
      }
      
      setState(() {
        _currentUserId = currentUser.uid;
      });
      
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('初始化失败：${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  /// 发送消息（支持文本和多媒体）
  Future<void> _sendMessage({MediaAttachmentModel? attachment}) async {
    final text = _messageController.text.trim();
    if (text.isEmpty && attachment == null) return;

    setState(() {
      _isLoading = true;
    });

    try {
      await _groupService.sendGroupMessage(
        groupId: widget.group.groupId,
        senderId: _currentUserId,
        text: text.isNotEmpty ? text : null,
        attachment: attachment,
      );
      
      _messageController.clear();
      _scrollToBottom();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('发送失败：${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
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
        await _sendMessage(attachment: attachment);
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

  /// 录制并发送语音
  Future<void> _recordAndSendAudio() async {
    setState(() {
      _isUploadingMedia = true;
    });

    try {
      final attachment = await _mediaService.recordAndUploadAudio();
      if (attachment != null) {
        await _sendMessage(attachment: attachment);
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

  /// 获取发送者姓名
  String _getSenderName(String senderId) {
    try {
      // 根据数据模型，GroupModel只包含participantIds，这里简化处理
      final isGroupMember = widget.group.participantIds.contains(senderId);
      return '发送者';
    } catch (e) {
      return '未知用户';
    }
  }

  /// 构建消息气泡
  Widget _buildMessageBubble(MessageModel message) {
    final isMe = message.senderId == _currentUserId;
    final senderName = _getSenderName(message.senderId);
    
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 16),
      child: Row(
        mainAxisAlignment: isMe ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!isMe) ...[
            // 发送者头像
            CircleAvatar(
              radius: 16,
              backgroundColor: Theme.of(context).primaryColor,
              child: Text(
                senderName.substring(0, 1).toUpperCase(),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                ),
              ),
            ),
            const SizedBox(width: 8),
          ],
          
          // 消息内容
          Flexible(
            child: Column(
              crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
              children: [
                // 发送者名称（群聊中显示）
                if (!isMe)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text(
                      senderName,
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.grey[600],
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                
                _buildMessageContent(message, isMe),
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
        maxHeight: 300,
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
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
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
            size: 24,
          ),
          const SizedBox(width: 8),
          Text(
            '文档',
            style: TextStyle(
              color: isMe ? Colors.white : Colors.black87,
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }

  /// 构建位置消息
  Widget _buildLocationMessage(MessageModel message, bool isMe) {
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
            Icons.location_on,
            color: isMe ? Colors.white : Colors.black87,
            size: 24,
          ),
          const SizedBox(width: 8),
          Text(
            '位置',
            style: TextStyle(
              color: isMe ? Colors.white : Colors.black87,
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
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

  /// 格式化消息时间
  String _formatMessageTime(Timestamp timestamp) {
    final messageTime = timestamp.toDate();
    final now = DateTime.now();
    final difference = now.difference(messageTime);
    
    if (difference.inDays > 0) {
      return '${messageTime.month}/${messageTime.day} ${messageTime.hour.toString().padLeft(2, '0')}:${messageTime.minute.toString().padLeft(2, '0')}';
    } else if (difference.inHours > 0) {
      return '${messageTime.hour.toString().padLeft(2, '0')}:${messageTime.minute.toString().padLeft(2, '0')}';
    } else {
      return '刚刚';
    }
  }

  /// 获取状态图标
  IconData _getStatusIcon(MessageStatus status) {
    switch (status) {
      case MessageStatus.sending:
        return Icons.schedule;
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

  /// 构建输入区域
  Widget _buildInputArea() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(
          top: BorderSide(color: Colors.grey[300]!),
        ),
      ),
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
                        color: Colors.white,
                        strokeWidth: 2,
                      ),
                    )
                  : const Icon(Icons.send, color: Colors.white),
              onPressed: _isLoading ? null : _sendMessage,
            ),
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
              backgroundColor: Theme.of(context).primaryColor.withOpacity(0.1),
              backgroundImage: widget.group.groupIconUrl != null 
                  ? NetworkImage(widget.group.groupIconUrl!) 
                  : null,
              child: widget.group.groupIconUrl == null
                  ? Icon(
                      Icons.group,
                      color: Theme.of(context).primaryColor,
                      size: 20,
                    )
                  : null,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.group.groupName,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    '${widget.group.participantIds.length} 成员',
                    style: const TextStyle(
                      fontSize: 12,
                      color: Colors.white70,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        backgroundColor: Theme.of(context).primaryColor,
        foregroundColor: Colors.white,
        elevation: 2,
        actions: [
          IconButton(
            icon: const Icon(Icons.info_outline),
            onPressed: () {
              // TODO: 导航到群组详情页面
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('群组详情功能即将推出')),
              );
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // 消息列表
          Expanded(
            child: StreamBuilder<List<MessageModel>>(
              stream: _groupService.getGroupMessagesStream(widget.group.groupId),
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }

                if (snapshot.hasError) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.error_outline, size: 64, color: Colors.grey[400]),
                        const SizedBox(height: 16),
                        Text('加载消息失败', style: TextStyle(fontSize: 16, color: Colors.grey[600])),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: () => setState(() {}),
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
                        Icon(Icons.chat_bubble_outline, size: 64, color: Colors.grey[400]),
                        const SizedBox(height: 16),
                        Text('暂无群组消息', style: TextStyle(fontSize: 16, color: Colors.grey[600])),
                        const SizedBox(height: 8),
                        Text('发送第一条消息开始群聊吧！', style: TextStyle(fontSize: 14, color: Colors.grey[500])),
                      ],
                    ),
                  );
                }

                return ListView.builder(
                  controller: _scrollController,
                  reverse: true,
                  itemCount: messages.length,
                  itemBuilder: (context, index) => _buildMessageBubble(messages[index]),
                );
              },
            ),
          ),
          
          // 输入区域
          _buildInputArea(),
        ],
      ),
    );
  }
}
