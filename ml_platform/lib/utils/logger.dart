import 'dart:developer' as developer;
import 'package:flutter/foundation.dart';

/// 日志级别
enum LogLevel {
  verbose,
  debug,
  info,
  warning,
  error,
  fatal,
}

/// 应用日志工具
class Logger {
  static const String _defaultTag = 'MLPlatform';
  static LogLevel _minLevel = kDebugMode ? LogLevel.debug : LogLevel.info;
  static final List<LogEntry> _logHistory = [];
  static const int _maxHistorySize = 500;

  /// 设置最小日志级别
  static void setMinLevel(LogLevel level) {
    _minLevel = level;
  }

  /// 记录详细日志
  static void v(String message, {String? tag, dynamic error, StackTrace? stackTrace}) {
    _log(LogLevel.verbose, message, tag: tag, error: error, stackTrace: stackTrace);
  }

  /// 记录调试日志
  static void d(String message, {String? tag, dynamic error, StackTrace? stackTrace}) {
    _log(LogLevel.debug, message, tag: tag, error: error, stackTrace: stackTrace);
  }

  /// 记录信息日志
  static void i(String message, {String? tag, dynamic error, StackTrace? stackTrace}) {
    _log(LogLevel.info, message, tag: tag, error: error, stackTrace: stackTrace);
  }

  /// 记录警告日志
  static void w(String message, {String? tag, dynamic error, StackTrace? stackTrace}) {
    _log(LogLevel.warning, message, tag: tag, error: error, stackTrace: stackTrace);
  }

  /// 记录错误日志
  static void e(String message, {String? tag, dynamic error, StackTrace? stackTrace}) {
    _log(LogLevel.error, message, tag: tag, error: error, stackTrace: stackTrace);
  }

  /// 记录严重错误日志
  static void f(String message, {String? tag, dynamic error, StackTrace? stackTrace}) {
    _log(LogLevel.fatal, message, tag: tag, error: error, stackTrace: stackTrace);
  }

  /// 核心日志记录方法
  static void _log(
    LogLevel level,
    String message, {
    String? tag,
    dynamic error,
    StackTrace? stackTrace,
  }) {
    // 检查是否应该记录此级别的日志
    if (level.index < _minLevel.index) return;

    final logTag = tag ?? _defaultTag;
    final timestamp = DateTime.now();
    final logEntry = LogEntry(
      level: level,
      message: message,
      tag: logTag,
      timestamp: timestamp,
      error: error,
      stackTrace: stackTrace,
    );

    // 添加到历史记录
    _addToHistory(logEntry);

    // 构建日志消息
    final logMessage = _formatLogMessage(logEntry);

    // 输出到控制台
    if (kDebugMode) {
      switch (level) {
        case LogLevel.verbose:
        case LogLevel.debug:
        case LogLevel.info:
          debugPrint(logMessage);
          break;
        case LogLevel.warning:
          debugPrint('\x1B[33m$logMessage\x1B[0m'); // 黄色
          break;
        case LogLevel.error:
          debugPrint('\x1B[31m$logMessage\x1B[0m'); // 红色
          if (error != null) {
            debugPrint('Error: $error');
          }
          if (stackTrace != null) {
            debugPrintStack(stackTrace: stackTrace, label: 'Stack trace');
          }
          break;
        case LogLevel.fatal:
          debugPrint('\x1B[31;1m$logMessage\x1B[0m'); // 红色加粗
          if (error != null) {
            debugPrint('Fatal Error: $error');
          }
          if (stackTrace != null) {
            debugPrintStack(stackTrace: stackTrace, label: 'Stack trace');
          }
          break;
      }
    }

    // 在开发模式下同时输出到系统日志
    if (kDebugMode) {
      developer.log(
        message,
        time: timestamp,
        name: logTag,
        level: _mapToSystemLevel(level),
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  /// 格式化日志消息
  static String _formatLogMessage(LogEntry entry) {
    final levelStr = _getLevelString(entry.level);
    final timeStr = _formatTimestamp(entry.timestamp);
    return '[$timeStr] [$levelStr] [${entry.tag}] ${entry.message}';
  }

  /// 获取级别字符串
  static String _getLevelString(LogLevel level) {
    switch (level) {
      case LogLevel.verbose:
        return 'V';
      case LogLevel.debug:
        return 'D';
      case LogLevel.info:
        return 'I';
      case LogLevel.warning:
        return 'W';
      case LogLevel.error:
        return 'E';
      case LogLevel.fatal:
        return 'F';
    }
  }

  /// 格式化时间戳
  static String _formatTimestamp(DateTime timestamp) {
    return '${timestamp.hour.toString().padLeft(2, '0')}:'
        '${timestamp.minute.toString().padLeft(2, '0')}:'
        '${timestamp.second.toString().padLeft(2, '0')}.'
        '${timestamp.millisecond.toString().padLeft(3, '0')}';
  }

  /// 映射到系统日志级别
  static int _mapToSystemLevel(LogLevel level) {
    switch (level) {
      case LogLevel.verbose:
        return 300;
      case LogLevel.debug:
        return 500;
      case LogLevel.info:
        return 800;
      case LogLevel.warning:
        return 900;
      case LogLevel.error:
        return 1000;
      case LogLevel.fatal:
        return 1200;
    }
  }

  /// 添加到历史记录
  static void _addToHistory(LogEntry entry) {
    _logHistory.add(entry);
    
    // 限制历史记录大小
    while (_logHistory.length > _maxHistorySize) {
      _logHistory.removeAt(0);
    }
  }

  /// 获取日志历史
  static List<LogEntry> getHistory({LogLevel? minLevel}) {
    if (minLevel == null) {
      return List.unmodifiable(_logHistory);
    }
    
    return List.unmodifiable(
      _logHistory.where((entry) => entry.level.index >= minLevel.index),
    );
  }

  /// 清空日志历史
  static void clearHistory() {
    _logHistory.clear();
  }

  /// 导出日志历史为文本
  static String exportHistory({LogLevel? minLevel}) {
    final history = getHistory(minLevel: minLevel);
    final buffer = StringBuffer();
    
    buffer.writeln('=== ML Platform Log Export ===');
    buffer.writeln('Export Time: ${DateTime.now().toIso8601String()}');
    buffer.writeln('Total Entries: ${history.length}');
    buffer.writeln('=' * 40);
    buffer.writeln();
    
    for (final entry in history) {
      buffer.writeln(_formatLogMessage(entry));
      if (entry.error != null) {
        buffer.writeln('  Error: ${entry.error}');
      }
      if (entry.stackTrace != null) {
        buffer.writeln('  Stack Trace:');
        buffer.writeln('${entry.stackTrace}'.split('\n').map((line) => '    $line').join('\n'));
      }
      buffer.writeln();
    }
    
    return buffer.toString();
  }

  /// 记录性能指标
  static void logPerformance(String operation, Duration duration, {Map<String, dynamic>? extras}) {
    final message = StringBuffer('Performance: $operation took ${duration.inMilliseconds}ms');
    
    if (extras != null && extras.isNotEmpty) {
      message.write(' | ');
      message.write(extras.entries.map((e) => '${e.key}: ${e.value}').join(', '));
    }
    
    if (duration.inMilliseconds > 1000) {
      w(message.toString(), tag: 'Performance');
    } else if (duration.inMilliseconds > 500) {
      i(message.toString(), tag: 'Performance');
    } else {
      d(message.toString(), tag: 'Performance');
    }
  }

  /// 测量操作执行时间
  static Future<T> measureAsync<T>(
    String operation,
    Future<T> Function() task, {
    Map<String, dynamic>? extras,
  }) async {
    final stopwatch = Stopwatch()..start();
    
    try {
      final result = await task();
      stopwatch.stop();
      logPerformance(operation, stopwatch.elapsed, extras: extras);
      return result;
    } catch (error, stackTrace) {
      stopwatch.stop();
      e('$operation failed after ${stopwatch.elapsedMilliseconds}ms',
        error: error,
        stackTrace: stackTrace,
        tag: 'Performance',
      );
      rethrow;
    }
  }

  /// 测量同步操作执行时间
  static T measure<T>(
    String operation,
    T Function() task, {
    Map<String, dynamic>? extras,
  }) {
    final stopwatch = Stopwatch()..start();
    
    try {
      final result = task();
      stopwatch.stop();
      logPerformance(operation, stopwatch.elapsed, extras: extras);
      return result;
    } catch (error, stackTrace) {
      stopwatch.stop();
      e('$operation failed after ${stopwatch.elapsedMilliseconds}ms',
        error: error,
        stackTrace: stackTrace,
        tag: 'Performance',
      );
      rethrow;
    }
  }
}

/// 日志条目
class LogEntry {
  final LogLevel level;
  final String message;
  final String tag;
  final DateTime timestamp;
  final dynamic error;
  final StackTrace? stackTrace;

  LogEntry({
    required this.level,
    required this.message,
    required this.tag,
    required this.timestamp,
    this.error,
    this.stackTrace,
  });
}
