import '../models/message_model.dart';
import 'chat_service.dart';

/// 搜索服务
/// 
/// 负责在聊天消息中进行搜索
class SearchService {
  /// 聊天服务实例
  final ChatService _chatService;
  
  /// 构造函数
  SearchService(this._chatService);
  
  /// 在与特定用户的聊天中搜索消息
  /// 
  /// [currentUserId] - 当前用户ID
  /// [otherUserId] - 对方用户ID
  /// [query] - 搜索关键词
  /// [caseSensitive] - 是否区分大小写
  Future<List<MessageModel>> searchMessagesInChat({
    required String currentUserId,
    required String otherUserId,
    required String query,
    bool caseSensitive = false,
  }) async {
    if (query.isEmpty) return [];
    
    try {
      // 加载所有消息
      final messages = await _chatService.loadMessages(
        currentUserId: currentUserId,
        otherUserId: otherUserId,
      );
      
      // 转换查询关键词为小写（如果不区分大小写）
      final searchQuery = caseSensitive ? query : query.toLowerCase();
      
      // 搜索消息内容
      return messages.where((message) {
        // 只搜索文本消息
        if (message.messageType != MessageType.text) return false;
        
        final content = caseSensitive 
            ? message.content 
            : message.content.toLowerCase();
        
        // 检查消息内容是否包含查询关键词
        return content.contains(searchQuery);
      }).toList();
    } catch (e) {
      print('搜索消息失败: $e');
      return [];
    }
  }
  
  /// 在所有聊天中搜索消息
  /// 
  /// [currentUserId] - 当前用户ID
  /// [query] - 搜索关键词
  /// [caseSensitive] - 是否区分大小写
  Future<Map<String, List<MessageModel>>> searchAllMessages({
    required String currentUserId,
    required String query,
    bool caseSensitive = false,
  }) async {
    if (query.isEmpty) return {};
    
    try {
      // 获取聊天列表
      final chatList = await _chatService.getChatList(currentUserId);
      
      // 结果映射：用户ID -> 匹配的消息列表
      final Map<String, List<MessageModel>> results = {};
      
      // 遍历每个聊天
      for (final chat in chatList) {
        final otherUserId = chat['userId'] as String;
        
        // 在当前聊天中搜索
        final matches = await searchMessagesInChat(
          currentUserId: currentUserId,
          otherUserId: otherUserId,
          query: query,
          caseSensitive: caseSensitive,
        );
        
        // 如果有匹配结果，添加到结果映射
        if (matches.isNotEmpty) {
          results[otherUserId] = matches;
        }
      }
      
      return results;
    } catch (e) {
      print('搜索所有消息失败: $e');
      return {};
    }
  }
}
