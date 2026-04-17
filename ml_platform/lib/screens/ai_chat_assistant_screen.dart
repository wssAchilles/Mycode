import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/services/mcp_chat_service.dart';
import 'package:ml_platform/utils/error_handler.dart';
import 'package:ml_platform/widgets/common/responsive_container.dart';

/// AI 学习助手界面
/// 提供与 MCP 服务器的交互界面
class AIChatAssistantScreen extends StatefulWidget {
  const AIChatAssistantScreen({super.key});

  @override
  State<AIChatAssistantScreen> createState() => _AIChatAssistantScreenState();
}

class _AIChatAssistantScreenState extends State<AIChatAssistantScreen> {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<ChatMessage> _messages = [];
  final List<Map<String, String>> _conversationHistory = [];
  bool _isLoading = false;
  
  // 防抖Timer，避免快速连续发送
  Timer? _debounceTimer;

  @override
  void initState() {
    super.initState();
    // 添加欢迎消息
    _messages.add(
      ChatMessage(
        text: '你好!我是 AI 学习助手,可以帮你:\n\n'
            '1. 解释算法原理和复杂度\n'
            '2. 生成可视化代码\n'
            '3. 分析机器学习实验结果\n'
            '4. 提供超参数调优建议\n'
            '5. 比较不同算法\n\n'
            '你想了解什么?',
        isUser: false,
        timestamp: DateTime.now(),
      ),
    );
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    _debounceTimer?.cancel();
    super.dispose();
  }

  /// 发送消息
  void _sendMessage() async {
    final text = _messageController.text.trim();
    
    // 输入验证
    if (text.isEmpty) {
      _showErrorSnackBar('消息不能为空');
      return;
    }
    
    if (text.length > 2000) {
      _showErrorSnackBar('消息过长，请限制在2000字以内');
      return;
    }
    
    // 防止重复发送
    if (_isLoading) {
      return;
    }
    
    // 清空输入框（先清空，避免重复提交）
    _messageController.clear();

    // 添加用户消息
    final userMessage = ChatMessage(
      text: text,
      isUser: true,
      timestamp: DateTime.now(),
    );
    
    setState(() {
      _messages.add(userMessage);
      _isLoading = true;
    });
    
    // 更新对话历史
    _conversationHistory.add({
      'role': 'user',
      'content': text,
    });

    // 滚动到底部
    _scrollToBottom();

    try {
      // 调用 MCP 服务（带对话历史）
      final response = await MCPChatService.chat(
        message: text,
        conversationHistory: _conversationHistory.length > 1 
          ? _conversationHistory.sublist(0, _conversationHistory.length - 1)
          : null,
      );

      // 添加到对话历史
      _conversationHistory.add({
        'role': 'assistant',
        'content': response,
      });

      // 添加 AI 回复
      if (mounted) {
        setState(() {
          _messages.add(
            ChatMessage(
              text: response,
              isUser: false,
              timestamp: DateTime.now(),
            ),
          );
          _isLoading = false;
        });
        
        _scrollToBottom();
      }
    } catch (e) {
      if (mounted) {
        // 记录错误
        ErrorHandler.logError('AI聊天', e, StackTrace.current);
        
        setState(() {
          _messages.add(
            ChatMessage(
              text: ErrorHandler.getErrorMessage(e),
              isUser: false,
              timestamp: DateTime.now(),
              isError: true,
            ),
          );
          _isLoading = false;
        });
        
        // 如果可以重试，显示重试按钮
        if (ErrorHandler.canRetry(e)) {
          _showRetrySnackBar(text);
        }
      }
    }
  }
  
  /// 显示错误提示
  void _showErrorSnackBar(String message) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: Theme.of(context).colorScheme.error,
          duration: const Duration(seconds: 2),
        ),
      );
    }
  }
  
  /// 显示重试提示
  void _showRetrySnackBar(String originalMessage) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('请求失败，点击重试'),
          action: SnackBarAction(
            label: '重试',
            onPressed: () {
              _messageController.text = originalMessage;
              _sendMessage();
            },
          ),
          duration: const Duration(seconds: 5),
        ),
      );
    }
  }

  /// 滚动到底部
  void _scrollToBottom() {
    // 使用 WidgetsBinding 确保在下一帧渲染后滚动
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  /// 快捷操作按钮
  Widget _buildQuickAction(String title, String action, IconData icon) {
    return ElevatedButton.icon(
      onPressed: _isLoading ? null : () {
        _messageController.text = action;
        _sendMessage();
      },
      icon: Icon(icon, size: 18),
      label: Text(title),
      style: ElevatedButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI 学习助手'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go('/home');
            }
          },
          tooltip: '返回',
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: '清空对话',
            onPressed: _isLoading ? null : () {
              setState(() {
                _messages.clear();
                _conversationHistory.clear();
                _messages.add(
                  ChatMessage(
                    text: '对话已清空。有什么我可以帮你的吗?',
                    isUser: false,
                    timestamp: DateTime.now(),
                  ),
                );
              });
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // 快捷操作栏
          Container(
            padding: const EdgeInsets.all(8),
            color: AppTheme.surfaceHighlight,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _buildQuickAction(
                    '解释算法',
                    '解释快速排序算法的原理',
                    Icons.school,
                  ),
                  const SizedBox(width: 8),
                  _buildQuickAction(
                    '生成代码',
                    '为冒泡排序生成 Flutter 可视化代码',
                    Icons.code,
                  ),
                  const SizedBox(width: 8),
                  _buildQuickAction(
                    '分析结果',
                    '分析我的机器学习实验结果',
                    Icons.analytics,
                  ),
                  const SizedBox(width: 8),
                  _buildQuickAction(
                    '比较算法',
                    '比较冒泡排序和快速排序',
                    Icons.compare_arrows,
                  ),
                ],
              ),
            ),
          ),

          // 消息列表
          Expanded(
            child: ResponsiveContainer(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: ListView.builder(
                controller: _scrollController,
                padding: const EdgeInsets.all(16),
                itemCount: _messages.length,
                itemBuilder: (context, index) {
                  return _ChatBubble(message: _messages[index]);
                },
              ),
            ),
          ),

          // 加载指示器
          if (_isLoading)
            Padding(
              padding: const EdgeInsets.all(8.0),
              child: Row(
                children: [
                  const SizedBox(width: 16),
                  SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(
                        Theme.of(context).colorScheme.primary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'AI 正在思考…',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),

          // 输入框
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppTheme.surface,
              boxShadow: AppShadows.soft,
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _messageController,
                    enabled: !_isLoading,
                    decoration: InputDecoration(
                      labelText: '你的问题',
                      hintText: _isLoading ? 'AI 正在回复…' : '输入你的问题…',
                      border: const OutlineInputBorder(),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                      counterText: '', // 隐藏计数器
                    ),
                    maxLines: null,
                    maxLength: 2000,
                    textInputAction: TextInputAction.send,
                    onSubmitted: _isLoading ? null : (_) => _sendMessage(),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  onPressed: _isLoading ? null : _sendMessage,
                  icon: const Icon(Icons.send),
                  tooltip: '发送',
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// 聊天消息模型
class ChatMessage {
  final String text;
  final bool isUser;
  final DateTime timestamp;
  final bool isError;

  ChatMessage({
    required this.text,
    required this.isUser,
    required this.timestamp,
    this.isError = false,
  });
}

/// 聊天气泡组件
class _ChatBubble extends StatelessWidget {
  final ChatMessage message;

  const _ChatBubble({required this.message});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        mainAxisAlignment:
            message.isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!message.isUser) ...[
            CircleAvatar(
              backgroundColor: Theme.of(context).colorScheme.primaryContainer,
              child: Icon(
                Icons.smart_toy,
                color: Theme.of(context).colorScheme.onPrimaryContainer,
              ),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: message.isUser
                    ? Theme.of(context).colorScheme.primaryContainer
                    : message.isError
                        ? Theme.of(context).colorScheme.errorContainer
                        : AppTheme.surfaceHighlight,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: message.isError
                      ? Theme.of(context)
                          .colorScheme
                          .error
                          .withOpacity(0.3)
                      : AppTheme.borderSubtle,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    message.text,
                    style: TextStyle(
                      color: message.isUser
                          ? Theme.of(context).colorScheme.onPrimaryContainer
                          : message.isError
                              ? Theme.of(context).colorScheme.onErrorContainer
                              : Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _formatTime(message.timestamp),
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: message.isUser
                              ? Theme.of(context)
                                  .colorScheme
                                  .onPrimaryContainer
                                  .withOpacity(0.7)
                              : Theme.of(context)
                                  .colorScheme
                                  .onSurface
                                  .withOpacity(0.5),
                        ),
                  ),
                ],
              ),
            ),
          ),
          if (message.isUser) ...[
            const SizedBox(width: 8),
            CircleAvatar(
              backgroundColor: Theme.of(context).colorScheme.primary,
              child: Icon(
                Icons.person,
                color: Theme.of(context).colorScheme.onPrimary,
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _formatTime(DateTime time) {
    return DateFormat.Hm().format(time);
  }
}
