import 'package:flutter/foundation.dart';
import '../models/emoji_model.dart';
import 'filebase_service.dart';
import '../config/filebase_config.dart';
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// 表情包服务
class EmojiService extends ChangeNotifier {
  // 表情包列表
  final List<EmojiModel> _emojis = [];
  
  // 表情包分类
  final Map<String, List<EmojiModel>> _categories = {};
  
  // 是否已初始化
  bool _initialized = false;
  
  // Filebase服务
  final FilebaseService _filebaseService;
  
  // 当前用户ID
  String? _currentUserId;
  
  // 构造函数
  EmojiService(this._filebaseService);
  
  // 初始化用户表情包
  Future<void> initializeForUser(String userId) async {
    // 如果是不同的用户，清空之前的数据
    if (_currentUserId != userId) {
      print('切换到用户: $userId，清空之前的表情包数据');
      _emojis.clear();
      _categories.clear();
      _initialized = false;
    }
    
    _currentUserId = userId;
    await _initializeEmojis();
    
    print('用户 $userId 的表情包初始化完成，共有 ${_emojis.length} 个表情包');
  }
  
  // 清理表情包数据（用户登出时调用）
  void clearUserData() {
    print('清理表情包服务数据');
    _currentUserId = null;
    _emojis.clear();
    _categories.clear();
    _initialized = false;
    notifyListeners();
  }
  
  // 获取用户专属的存储键名
  String get _customEmojisKey {
    if (_currentUserId == null) {
      throw Exception('用户未初始化，请先调用 initializeForUser');
    }
    final key = 'custom_emojis_$_currentUserId';
    print('使用用户专属存储键: $key');
    return key;
  }
  
  // 获取所有表情包
  List<EmojiModel> get emojis => List.unmodifiable(_emojis);
  
  // 获取表情包分类
  Map<String, List<EmojiModel>> get categories => Map.unmodifiable(_categories);
  
  // 是否已初始化
  bool get isInitialized => _initialized;
  
  // 获取指定分类的表情包
  List<EmojiModel> getEmojisByCategory(String category) {
    return _categories[category] ?? [];
  }
  
  // 通过ID获取表情包
  EmojiModel? getEmojiById(String id) {
    try {
      return _emojis.firstWhere((emoji) => emoji.id == id);
    } catch (e) {
      return null;
    }
  }
  
  // 初始化表情包数据
  Future<void> _initializeEmojis() async {
    if (_initialized) return;
    
    try {
      // 1. 加载本地基础表情包
      _loadLocalEmojis();
      
      // 2. 加载保存在SharedPreferences中的自定义表情包
      await _loadCustomEmojis();
      
      // 3. 尝试加载远程表情包
      await _loadRemoteEmojis();
      
      _initialized = true;
      notifyListeners();
    } catch (e) {
      print('初始化表情包失败: $e');
      // 即使远程加载失败，也标记为已初始化，因为基础表情已加载
      _initialized = true;
    }
  }
  
  // 加载本地表情包
  void _loadLocalEmojis() {
    // 基础表情包 - 使用表情文本而非图片URL (临时解决方案)
    final basicEmojis = [
      EmojiModel(
        id: 'smile',
        name: '微笑',
        category: '基础',
        isLocal: true,
        assetPath: '😊', // 直接使用表情符号
      ),
      EmojiModel(
        id: 'laugh',
        name: '大笑',
        category: '基础',
        isLocal: true,
        assetPath: '😄', // 直接使用表情符号
      ),
      EmojiModel(
        id: 'cry',
        name: '哭泣',
        category: '基础',
        isLocal: true,
        assetPath: '😢', // 直接使用表情符号
      ),
      EmojiModel(
        id: 'angry',
        name: '生气',
        category: '基础',
        isLocal: true,
        assetPath: '😠', // 直接使用表情符号
      ),
      EmojiModel(
        id: 'love',
        name: '爱心',
        category: '基础',
        isLocal: true,
        assetPath: '❤️', // 直接使用表情符号
      ),
      EmojiModel(
        id: 'thumbs_up',
        name: '点赞',
        category: '基础',
        isLocal: true,
        assetPath: '👍', // 直接使用表情符号
      ),
      EmojiModel(
        id: 'ok',
        name: 'OK',
        category: '基础',
        isLocal: true,
        assetPath: '👌', // 直接使用表情符号
      ),
      EmojiModel(
        id: 'think',
        name: '思考',
        category: '基础',
        isLocal: true,
        assetPath: '🤔', // 直接使用表情符号
      ),
    ];
    
    // 添加到列表和分类
    for (final emoji in basicEmojis) {
      _emojis.add(emoji);
      
      if (!_categories.containsKey(emoji.category)) {
        _categories[emoji.category] = [];
      }
      
      _categories[emoji.category]!.add(emoji);
    }
  }
  
  // 加载自定义表情包
  Future<void> _loadCustomEmojis() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final customEmojisJson = prefs.getString(_customEmojisKey);
      
      if (customEmojisJson != null) {
        final List<dynamic> decodedList = jsonDecode(customEmojisJson);
        final List<EmojiModel> customEmojis = decodedList
            .map((data) => EmojiModel.fromJson(data))
            .toList();
        
        // 添加到列表和分类
        for (final emoji in customEmojis) {
          // 避免重复ID
          if (_emojis.any((e) => e.id == emoji.id)) {
            continue;
          }
          
          _emojis.add(emoji);
          
          if (!_categories.containsKey(emoji.category)) {
            _categories[emoji.category] = [];
          }
          
          _categories[emoji.category]!.add(emoji);
        }
        
        print('加载了 ${customEmojis.length} 个自定义表情包');
      }
    } catch (e) {
      print('加载自定义表情包失败: $e');
    }
  }
  
  // 保存自定义表情包
  Future<void> _saveCustomEmojis() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      
      // 筛选出自定义表情包(非基础分类)
      final customEmojis = _emojis.where((emoji) => emoji.category != '基础').toList();
      
      // 转换为JSON字符串
      final jsonString = jsonEncode(customEmojis.map((e) => e.toJson()).toList());
      
      // 保存到SharedPreferences
      await prefs.setString(_customEmojisKey, jsonString);
      
      print('保存了 ${customEmojis.length} 个自定义表情包');
    } catch (e) {
      print('保存自定义表情包失败: $e');
    }
  }
  
  // 加载远程表情包
  Future<void> _loadRemoteEmojis() async {
    try {
      // 从 Filebase 获取远程表情包配置
      final emojiData = await _filebaseService.getJson(
        'mediafiles', 
        'emojis/emoji_config.json'
      );
      
      if (emojiData != null && emojiData['emojis'] is List) {
        final remoteEmojis = (emojiData['emojis'] as List)
            .map((data) => EmojiModel.fromJson(data))
            .toList();
        
        // 添加到列表和分类
        for (final emoji in remoteEmojis) {
          // 避免重复ID
          if (_emojis.any((e) => e.id == emoji.id)) {
            continue;
          }
          
          _emojis.add(emoji);
          
          if (!_categories.containsKey(emoji.category)) {
            _categories[emoji.category] = [];
          }
          
          _categories[emoji.category]!.add(emoji);
        }
      }
    } catch (e) {
      print('加载远程表情包失败: $e');
      // 失败不阻止应用继续使用本地表情
    }
  }
  
  // 上传新表情包
  Future<EmojiModel?> uploadNewEmoji({
    required List<int> imageBytes,
    required String name,
    required String category,
  }) async {
    try {
      // 生成唯一ID (使用时间戳和名称)
      final id = '${DateTime.now().millisecondsSinceEpoch}_${name.replaceAll(' ', '_')}';
      
      // 检查是否提供了有效的图片数据
      bool isUsingImage = imageBytes.length > 100;
      String emojiText = '';
      String? remoteUrl;
      
      if (isUsingImage) {
        print('创建图片表情包: $name');
        try {
          // 使用用户级别的存储路径
          final objectKey = 'emojis/users/$_currentUserId/$id.png';
          print('为用户 $_currentUserId 上传表情包到路径: $objectKey');
          
          remoteUrl = await _filebaseService.uploadData(
            FilebaseConfig.mediaFilesBucket,
            objectKey,
            Uint8List.fromList(imageBytes),
            'image/png',
          );
          
          if (remoteUrl == null) {
            print('表情图片上传失败，回退到文本表情');
            isUsingImage = false;
          } else {
            print('表情图片上传成功: $remoteUrl');
          }
        } catch (e) {
          print('表情图片上传错误: $e，回退到文本表情');
          isUsingImage = false;
        }
      }
      
      // 如果没有使用图片或图片上传失败，使用文本表情
      if (!isUsingImage) {
        // 根据名称选择一个默认表情符号
        switch (name.toLowerCase()) {
          case '微笑':
            emojiText = '😊';
            break;
          case '大笑':
            emojiText = '😄';
            break;
          case '哭泣':
            emojiText = '😢';
            break;
          case '生气':
            emojiText = '😠';
            break;
          case '爱心':
            emojiText = '❤️';
            break;
          case '点赞':
            emojiText = '👍';
            break;
          case 'ok':
          case 'OK':
            emojiText = '👌';
            break;
          case '思考':
            emojiText = '🤔';
            break;
          case '开心':
            emojiText = '😁';
            break;
          case '害羞':
            emojiText = '😳';
            break;
          case '惊讶':
            emojiText = '😮';
            break;
          case '滴滴':
          case '滴答':
            emojiText = '💧';
            break;
          default:
            // 如果没有匹配的名称，使用名称的第一个字
            emojiText = name.isNotEmpty ? name[0] : '🙂';
        }
      }
      
      // 创建新表情模型
      final newEmoji = EmojiModel(
        id: id,
        assetPath: isUsingImage ? null : emojiText,
        remoteUrl: isUsingImage ? remoteUrl : null,
        name: name,
        category: category,
        isLocal: !isUsingImage,
      );
      
      // 添加到列表和分类
      _emojis.add(newEmoji);
      
      if (!_categories.containsKey(category)) {
        _categories[category] = [];
      }
      
      _categories[category]!.add(newEmoji);
      
      // 保存到本地存储
      await _saveCustomEmojis();
      
      // 通知监听者
      notifyListeners();
      
      return newEmoji;
    } catch (e) {
      print('创建表情包失败: $e');
      return null;
    }
  }
  
  // 删除表情包
  Future<bool> deleteEmoji(String emojiId) async {
    try {
      // 查找表情包
      final emojiIndex = _emojis.indexWhere((e) => e.id == emojiId);
      if (emojiIndex < 0) {
        return false;
      }
      
      final emoji = _emojis[emojiIndex];
      
      // 如果是基础表情包，不允许删除
      if (emoji.category == '基础') {
        return false;
      }
      
      // 从列表中移除
      _emojis.removeAt(emojiIndex);
      
      // 从分类中移除
      if (_categories.containsKey(emoji.category)) {
        _categories[emoji.category]!.removeWhere((e) => e.id == emojiId);
      }
      
      // 保存到本地存储
      await _saveCustomEmojis();
      
      // 通知监听者
      notifyListeners();
      
      return true;
    } catch (e) {
      print('删除表情包失败: $e');
      return false;
    }
  }
  
  // 清除所有自定义表情包
  Future<bool> clearCustomEmojis() async {
    try {
      // 保留基础表情包
      final basicEmojis = _emojis.where((e) => e.category == '基础').toList();
      
      // 清空列表
      _emojis.clear();
      
      // 重新添加基础表情包
      _emojis.addAll(basicEmojis);
      
      // 重置分类
      _categories.clear();
      if (basicEmojis.isNotEmpty) {
        _categories['基础'] = List.from(basicEmojis);
      }
      
      // 清除本地存储
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_customEmojisKey);
      
      // 通知监听者
      notifyListeners();
      
      return true;
    } catch (e) {
      print('清除自定义表情包失败: $e');
      return false;
    }
  }
} 