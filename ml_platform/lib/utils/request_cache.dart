import 'dart:convert';
import 'package:crypto/crypto.dart';

/// 请求缓存管理器
class RequestCache {
  // 单例模式
  static final RequestCache _instance = RequestCache._internal();
  factory RequestCache() => _instance;
  RequestCache._internal();

  // 内存缓存
  final Map<String, CacheEntry> _cache = {};

  // 默认缓存时间（5分钟）
  static const Duration defaultCacheDuration = Duration(minutes: 5);

  // 最大缓存条目数
  static const int maxCacheSize = 100;

  /// 生成缓存键
  String _generateKey(String tool, Map<String, dynamic> arguments) {
    final data = json.encode({'tool': tool, 'arguments': arguments});
    return md5.convert(utf8.encode(data)).toString();
  }

  /// 获取缓存
  String? get(String tool, Map<String, dynamic> arguments) {
    final key = _generateKey(tool, arguments);
    final entry = _cache[key];

    if (entry == null) {
      return null;
    }

    // 检查是否过期
    if (entry.isExpired) {
      _cache.remove(key);
      return null;
    }

    entry.hitCount++;
    entry.lastAccessTime = DateTime.now();
    return entry.value;
  }

  /// 设置缓存
  void set(
    String tool,
    Map<String, dynamic> arguments,
    String value, {
    Duration? duration,
  }) {
    final key = _generateKey(tool, arguments);

    // 如果缓存已满，移除最少使用的条目
    if (_cache.length >= maxCacheSize) {
      _evictLeastUsed();
    }

    _cache[key] = CacheEntry(
      value: value,
      expireTime: DateTime.now().add(duration ?? defaultCacheDuration),
      createTime: DateTime.now(),
      lastAccessTime: DateTime.now(),
    );
  }

  /// 清除缓存
  void clear() {
    _cache.clear();
  }

  /// 清除过期缓存
  void clearExpired() {
    _cache.removeWhere((key, entry) => entry.isExpired);
  }

  /// 移除最少使用的缓存条目
  void _evictLeastUsed() {
    if (_cache.isEmpty) return;

    // 找到访问次数最少的条目
    String? keyToRemove;
    int minHitCount = double.maxFinite.toInt();

    _cache.forEach((key, entry) {
      if (entry.hitCount < minHitCount) {
        minHitCount = entry.hitCount;
        keyToRemove = key;
      }
    });

    if (keyToRemove != null) {
      _cache.remove(keyToRemove);
    }
  }

  /// 获取缓存统计信息
  CacheStats getStats() {
    int expired = 0;
    int valid = 0;

    _cache.forEach((key, entry) {
      if (entry.isExpired) {
        expired++;
      } else {
        valid++;
      }
    });

    return CacheStats(
      totalEntries: _cache.length,
      validEntries: valid,
      expiredEntries: expired,
    );
  }
}

/// 缓存条目
class CacheEntry {
  final String value;
  final DateTime expireTime;
  final DateTime createTime;
  DateTime lastAccessTime;
  int hitCount;

  CacheEntry({
    required this.value,
    required this.expireTime,
    required this.createTime,
    required this.lastAccessTime,
    this.hitCount = 0,
  });

  bool get isExpired => DateTime.now().isAfter(expireTime);
}

/// 缓存统计信息
class CacheStats {
  final int totalEntries;
  final int validEntries;
  final int expiredEntries;

  CacheStats({
    required this.totalEntries,
    required this.validEntries,
    required this.expiredEntries,
  });

  @override
  String toString() {
    return 'CacheStats(total: $totalEntries, valid: $validEntries, expired: $expiredEntries)';
  }
}
