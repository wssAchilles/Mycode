import 'package:firebase_data_connect/firebase_data_connect.dart';
import 'package:default_connector/default_connector.dart';

class DataConnectService {
  static final DataConnectService _instance = DataConnectService._internal();
  factory DataConnectService() => _instance;
  DataConnectService._internal();

  // Data Connect 实例
  late final DefaultConnector connector;

  Future<void> initialize() async {
    // 初始化 Data Connect
    connector = DefaultConnector.instance;
    print('DataConnectService 初始化完成');
  }

  // 创建帖子
  Future<bool> createPost({
    required String content,
    String postType = 'text',
    String? mediaUrl,
    String? caption,
  }) async {
    try {
      // 使用生成的 SDK 创建帖子
      final result = await connector.createPost().execute();
      print('创建帖子成功: ${result.data.post_insert.id}');
      return true;
    } catch (e) {
      print('创建帖子失败: $e');
      return false;
    }
  }

  // 获取所有帖子
  Future<List<Map<String, dynamic>>> getAllPosts() async {
    try {
      // 使用生成的 SDK 获取帖子
      final result = await connector.getAllPosts().execute();
      
      // 转换为 Map 格式以便于 UI 使用
      return result.data.posts.map((post) => {
        'id': post.id,
        'content': post.content,
        'postType': post.postType,
        'createdAt': post.createdAt.toDate().toIso8601String(),
        'mediaUrl': post.mediaUrl,
        'caption': post.caption,
        'author': {
          'id': post.author.id,
          'username': post.author.username,
          'displayName': post.author.displayName,
          'profilePictureUrl': post.author.profilePictureUrl,
        },
      }).toList();
    } catch (e) {
      print('获取帖子失败: $e');
      // 返回模拟数据作为备选
      return [
        {
          'id': '1',
          'content': '这是第一条帖子',
          'postType': 'text',
          'createdAt': DateTime.now().toIso8601String(),
          'author': {
            'id': '1',
            'username': 'user1',
            'displayName': '用户1',
            'profilePictureUrl': null,
          },
        },
        {
          'id': '2',
          'content': '这是第二条帖子',
          'postType': 'text',
          'createdAt': DateTime.now().subtract(const Duration(hours: 2)).toIso8601String(),
          'author': {
            'id': '2',
            'username': 'user2',
            'displayName': '用户2',
            'profilePictureUrl': null,
          },
        },
      ];
    }
  }

  // 点赞帖子
  Future<bool> likePost(String postId) async {
    try {
      // 使用生成的 SDK 点赞帖子
      await connector.likePost(postId: postId).execute();
      print('点赞帖子成功: $postId');
      return true;
    } catch (e) {
      print('点赞失败: $e');
      return false;
    }
  }

  // 创建评论
  Future<bool> createComment({
    required String postId,
    required String text,
  }) async {
    try {
      // 使用生成的 SDK 创建评论
      await connector.createComment(postId: postId, text: text).execute();
      print('创建评论成功: $text');
      return true;
    } catch (e) {
      print('创建评论失败: $e');
      return false;
    }
  }

  // 搜索用户
  Future<List<Map<String, dynamic>>> searchUsers(String username) async {
    try {
      // 使用生成的 SDK 搜索用户
      final result = await connector.searchUsers(username: username).execute();
      
      // 转换为 Map 格式
      return result.data.users.map((user) => {
        'id': user.id,
        'username': user.username,
        'displayName': user.displayName,
        'profilePictureUrl': user.profilePictureUrl,
      }).toList();
    } catch (e) {
      print('搜索用户失败: $e');
      return [];
    }
  }

  // 关注用户
  Future<bool> followUser(String followingId) async {
    try {
      // 使用生成的 SDK 关注用户
      await connector.followUser(followingId: followingId).execute();
      print('关注用户成功: $followingId');
      return true;
    } catch (e) {
      print('关注失败: $e');
      return false;
    }
  }

  // 创建用户资料
  Future<bool> createUser({
    required String username,
    required String email,
    String? displayName,
  }) async {
    try {
      // 使用生成的 SDK 创建用户
      await connector.createUser(
        username: username,
        email: email,
      ).execute();
      print('创建用户成功: $username');
      return true;
    } catch (e) {
      print('创建用户失败: $e');
      return false;
    }
  }

  // 获取用户资料
  Future<Map<String, dynamic>?> getUserProfile(String userId) async {
    try {
      final result = await connector.getUserProfile(userId: userId).execute();
      final user = result.data.user;
      
      if (user != null) {
        return {
          'id': user.id,
          'username': user.username,
          'displayName': user.displayName,
          'bio': user.bio,
          'profilePictureUrl': user.profilePictureUrl,
          'createdAt': user.createdAt.toDate().toIso8601String(),
        };
      }
      return null;
    } catch (e) {
      print('获取用户资料失败: $e');
      return null;
    }
  }

  // 获取帖子评论
  Future<List<Map<String, dynamic>>> getPostComments(String postId) async {
    try {
      final result = await connector.getPostComments(postId: postId).execute();
      
      return result.data.comments.map((comment) => {
        'id': comment.id,
        'text': comment.text,
        'createdAt': comment.createdAt.toDate().toIso8601String(),
        'author': {
          'id': comment.author.id,
          'username': comment.author.username,
          'displayName': comment.author.displayName,
          'profilePictureUrl': comment.author.profilePictureUrl,
        },
      }).toList();
    } catch (e) {
      print('获取评论失败: $e');
      return [];
    }
  }
}
