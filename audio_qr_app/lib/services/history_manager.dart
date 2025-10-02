import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/history_item.dart';

/// 历史记录管理服务
class HistoryManager extends ChangeNotifier {
  static const String _historyKey = 'audio_qr_history';
  static const int _maxHistoryItems = 100;
  
  List<HistoryItem> _items = [];
  SharedPreferences? _prefs;
  bool _isLoading = false;
  final _loadCompleter = Completer<void>();
  
  List<HistoryItem> get items => List.unmodifiable(_items);
  List<HistoryItem> get favorites => _items.where((item) => item.isFavorite).toList();
  
  /// 初始化历史记录管理器
  Future<void> initialize() async {
    if (_isLoading) {
      return _loadCompleter.future;
    }
    
    if (_prefs != null) return; // 已经初始化
    
    _isLoading = true;
    try {
      _prefs = await SharedPreferences.getInstance();
      await _loadHistory();
      if (!_loadCompleter.isCompleted) {
        _loadCompleter.complete();
      }
    } catch (e) {
      if (!_loadCompleter.isCompleted) {
        _loadCompleter.completeError(e);
      }
      rethrow;
    } finally {
      _isLoading = false;
    }
  }
  
  /// 加载历史记录
  Future<void> _loadHistory() async {
    if (_prefs == null) return;
    
    try {
      final historyJson = _prefs!.getStringList(_historyKey) ?? [];
      _items = historyJson.map((json) {
        final map = jsonDecode(json) as Map<String, dynamic>;
        return HistoryItem.fromMap(map);
      }).toList();
      
      // 按创建时间排序（最新的在前）
      _items.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      
      notifyListeners();
    } catch (e) {
      debugPrint('加载历史记录失败: $e');
      _items = [];
    }
  }
  
  /// 确保已初始化
  Future<void> _ensureInitialized() async {
    if (_prefs == null) {
      await initialize();
    }
  }

  /// 保存历史记录
  Future<void> _saveHistory() async {
    await _ensureInitialized();
    if (_prefs == null) return;
    
    try {
      final historyJson = _items.map((item) => jsonEncode(item.toMap())).toList();
      await _prefs!.setStringList(_historyKey, historyJson);
    } catch (e) {
      debugPrint('保存历史记录失败: $e');
    }
  }
  
  /// 添加新的历史记录
  Future<void> addItem(HistoryItem item) async {
    await _ensureInitialized();
    // 检查是否已存在相同的记录
    final existingIndex = _items.indexWhere((existing) => 
        existing.downloadUrl == item.downloadUrl);
    
    if (existingIndex != -1) {
      // 更新现有记录的时间
      _items[existingIndex] = item.copyWith(createdAt: DateTime.now());
    } else {
      // 添加新记录
      _items.insert(0, item);
      
      // 限制历史记录数量
      if (_items.length > _maxHistoryItems) {
        _items = _items.take(_maxHistoryItems).toList();
      }
    }
    
    await _saveHistory();
    notifyListeners();
  }
  
  /// 删除历史记录
  Future<void> removeItem(String itemId) async {
    _items.removeWhere((item) => item.id == itemId);
    await _saveHistory();
    notifyListeners();
  }
  
  /// 清空所有历史记录
  Future<void> clearAll() async {
    _items.clear();
    await _saveHistory();
    notifyListeners();
  }
  
  /// 切换收藏状态
  Future<void> toggleFavorite(String itemId) async {
    final index = _items.indexWhere((item) => item.id == itemId);
    if (index != -1) {
      _items[index] = _items[index].copyWith(isFavorite: !_items[index].isFavorite);
      await _saveHistory();
      notifyListeners();
    }
  }
  
  /// 搜索历史记录
  List<HistoryItem> searchItems(String query) {
    if (query.isEmpty) return items;
    
    final lowerQuery = query.toLowerCase();
    return _items.where((item) {
      return item.fileName.toLowerCase().contains(lowerQuery) ||
             item.fileExtension.toLowerCase().contains(lowerQuery);
    }).toList();
  }
  
  /// 按日期分组历史记录
  Map<String, List<HistoryItem>> getGroupedByDate() {
    final grouped = <String, List<HistoryItem>>{};
    
    for (final item in _items) {
      final now = DateTime.now();
      final itemDate = item.createdAt;
      final today = DateTime(now.year, now.month, now.day);
      final yesterday = today.subtract(const Duration(days: 1));
      final itemDateOnly = DateTime(itemDate.year, itemDate.month, itemDate.day);
      
      String groupKey;
      if (itemDateOnly == today) {
        groupKey = '今天';
      } else if (itemDateOnly == yesterday) {
        groupKey = '昨天';
      } else if (now.difference(itemDate).inDays < 7) {
        groupKey = '本周';
      } else if (now.difference(itemDate).inDays < 30) {
        groupKey = '本月';
      } else {
        groupKey = '更早';
      }
      
      grouped[groupKey] ??= [];
      grouped[groupKey]!.add(item);
    }
    
    return grouped;
  }
  
  /// 获取统计信息
  Map<String, int> getStatistics() {
    return {
      'totalItems': _items.length,
      'favorites': favorites.length,
      'totalFileSize': _items.fold<int>(0, (sum, item) => sum + item.fileSize),
      'uniqueExtensions': _items.map((item) => item.fileExtension).toSet().length,
    };
  }
  
  /// 导出历史记录（用于备份）
  String exportHistory() {
    final exportData = {
      'version': '1.0',
      'exportTime': DateTime.now().toIso8601String(),
      'items': _items.map((item) => item.toMap()).toList(),
    };
    return jsonEncode(exportData);
  }
  
  /// 导入历史记录（从备份恢复）
  Future<bool> importHistory(String jsonString) async {
    try {
      final data = jsonDecode(jsonString) as Map<String, dynamic>;
      final itemsData = data['items'] as List<dynamic>;
      
      final importedItems = itemsData.map((item) => 
          HistoryItem.fromMap(item as Map<String, dynamic>)).toList();
      
      // 合并导入的记录和现有记录
      final allItems = [..._items, ...importedItems];
      final uniqueItems = <String, HistoryItem>{};
      
      for (final item in allItems) {
        uniqueItems[item.id] = item;
      }
      
      _items = uniqueItems.values.toList();
      _items.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      
      // 限制数量
      if (_items.length > _maxHistoryItems) {
        _items = _items.take(_maxHistoryItems).toList();
      }
      
      await _saveHistory();
      notifyListeners();
      return true;
    } catch (e) {
      debugPrint('导入历史记录失败: $e');
      return false;
    }
  }
}