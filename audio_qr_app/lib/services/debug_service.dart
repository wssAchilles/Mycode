import 'dart:developer' as developer;
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// 日志级别枚举
enum LogLevel { verbose, debug, info, warning, error }

/// 调试和日志管理服务
class DebugService {
  static const String _tag = 'AudioQrApp';
  
  /// 是否启用调试模式
  static bool get isDebugMode => kDebugMode;
  
  /// 当前日志级别
  static LogLevel _currentLogLevel = LogLevel.debug;
  
  /// 设置日志级别
  static void setLogLevel(LogLevel level) {
    _currentLogLevel = level;
    log('日志级别设置为: ${level.name}', level: LogLevel.info);
  }
  
  /// 通用日志记录方法
  static void log(String message, {
    LogLevel level = LogLevel.debug,
    String? tag,
    Object? error,
    StackTrace? stackTrace,
  }) {
    // 检查日志级别
    if (_shouldLog(level)) {
      final logTag = tag ?? _tag;
      final timestamp = DateTime.now().toIso8601String();
      final logMessage = '[$timestamp] [$logTag] [${level.name.toUpperCase()}] $message';
      
      // 根据日志级别选择输出方式
      switch (level) {
        case LogLevel.verbose:
        case LogLevel.debug:
          developer.log(logMessage, name: logTag);
          if (isDebugMode) print(logMessage);
          break;
        case LogLevel.info:
          developer.log(logMessage, name: logTag, level: 800);
          print(logMessage);
          break;
        case LogLevel.warning:
          developer.log(logMessage, name: logTag, level: 900);
          print('⚠️ $logMessage');
          break;
        case LogLevel.error:
          developer.log(
            logMessage,
            name: logTag,
            level: 1000,
            error: error,
            stackTrace: stackTrace,
          );
          print('❌ $logMessage');
          if (error != null) print('Error: $error');
          if (stackTrace != null && isDebugMode) print('StackTrace: $stackTrace');
          break;
      }
    }
  }
  
  /// 检查是否应该记录该级别的日志
  static bool _shouldLog(LogLevel level) {
    return level.index >= _currentLogLevel.index;
  }
  
  /// 便捷方法：详细日志
  static void verbose(String message, {String? tag}) {
    log(message, level: LogLevel.verbose, tag: tag);
  }
  
  /// 便捷方法：调试日志
  static void debug(String message, {String? tag}) {
    log(message, level: LogLevel.debug, tag: tag);
  }
  
  /// 便捷方法：信息日志
  static void info(String message, {String? tag}) {
    log(message, level: LogLevel.info, tag: tag);
  }
  
  /// 便捷方法：警告日志
  static void warning(String message, {String? tag, Object? error}) {
    log(message, level: LogLevel.warning, tag: tag, error: error);
  }
  
  /// 便捷方法：错误日志
  static void error(String message, {String? tag, Object? error, StackTrace? stackTrace}) {
    log(message, level: LogLevel.error, tag: tag, error: error, stackTrace: stackTrace);
  }
  
  /// 腾讯云相关日志
  static void tencentCloud(String message, {LogLevel level = LogLevel.debug, Object? error}) {
    log(message, level: level, tag: 'TencentCloud', error: error);
  }
  
  /// 原生SDK相关日志
  static void nativeSDK(String message, {LogLevel level = LogLevel.debug, Object? error}) {
    log(message, level: level, tag: 'NativeSDK', error: error);
  }
  
  /// 上传相关日志
  static void upload(String message, {LogLevel level = LogLevel.debug, Object? error}) {
    log(message, level: level, tag: 'Upload', error: error);
  }
  
  /// 二维码相关日志
  static void qrCode(String message, {LogLevel level = LogLevel.debug, Object? error}) {
    log(message, level: level, tag: 'QRCode', error: error);
  }
  
  /// Platform Channel相关日志
  static void platformChannel(String message, {LogLevel level = LogLevel.debug, Object? error}) {
    log(message, level: level, tag: 'PlatformChannel', error: error);
  }
  
  /// 记录方法执行时间
  static Future<T> timeMethod<T>(
    String methodName,
    Future<T> Function() method, {
    String? tag,
  }) async {
    final stopwatch = Stopwatch()..start();
    final logTag = tag ?? 'Performance';
    
    log('开始执行: $methodName', tag: logTag, level: LogLevel.debug);
    
    try {
      final result = await method();
      stopwatch.stop();
      log('执行完成: $methodName (耗时: ${stopwatch.elapsedMilliseconds}ms)', 
          tag: logTag, level: LogLevel.info);
      return result;
    } catch (e, stackTrace) {
      stopwatch.stop();
      log('执行失败: $methodName (耗时: ${stopwatch.elapsedMilliseconds}ms)', 
          tag: logTag, level: LogLevel.error, error: e, stackTrace: stackTrace);
      rethrow;
    }
  }
  
  /// 记录Platform Channel调用
  static Future<T?> logPlatformChannelCall<T>(
    String channelName,
    String methodName,
    Future<T?> Function() call, {
    Map<String, dynamic>? arguments,
  }) async {
    platformChannel('调用原生方法: $channelName.$methodName${arguments != null ? ' 参数: $arguments' : ''}');
    
    try {
      final result = await call();
      platformChannel('原生方法调用成功: $channelName.$methodName 返回: $result');
      return result;
    } on PlatformException catch (e) {
      platformChannel(
        '原生方法调用失败: $channelName.$methodName',
        level: LogLevel.error,
        error: 'PlatformException: ${e.code} - ${e.message}${e.details != null ? ' 详情: ${e.details}' : ''}',
      );
      rethrow;
    } catch (e, stackTrace) {
      platformChannel(
        '原生方法调用异常: $channelName.$methodName',
        level: LogLevel.error,
        error: e,
      );
      rethrow;
    }
  }
  
  /// 记录文件操作
  static void fileOperation(String operation, String filePath, {bool success = true, Object? error}) {
    final message = '$operation: $filePath';
    if (success) {
      log(message, tag: 'FileOp', level: LogLevel.debug);
    } else {
      log('$message 失败', tag: 'FileOp', level: LogLevel.error, error: error);
    }
  }
  
  /// 记录网络请求
  static void networkRequest(String method, String url, {
    int? statusCode,
    Object? error,
    int? responseTime,
  }) {
    final message = '$method $url';
    if (statusCode != null) {
      if (statusCode >= 200 && statusCode < 300) {
        log('$message -> $statusCode${responseTime != null ? ' (${responseTime}ms)' : ''}', 
            tag: 'Network', level: LogLevel.info);
      } else {
        log('$message -> $statusCode${responseTime != null ? ' (${responseTime}ms)' : ''}', 
            tag: 'Network', level: LogLevel.warning);
      }
    } else if (error != null) {
      log('$message 失败', tag: 'Network', level: LogLevel.error, error: error);
    }
  }
  
  /// 获取当前应用信息
  static Map<String, dynamic> getAppInfo() {
    return {
      'debugMode': isDebugMode,
      'currentLogLevel': _currentLogLevel.name,
      'timestamp': DateTime.now().toIso8601String(),
      'platform': defaultTargetPlatform.name,
    };
  }
  
  /// 打印应用启动信息
  static void logAppStart() {
    info('=== 应用启动 ===');
    info('调试模式: ${isDebugMode ? '开启' : '关闭'}');
    info('日志级别: ${_currentLogLevel.name}');
    info('平台: ${defaultTargetPlatform.name}');
    info('时间: ${DateTime.now()}');
    info('================');
  }
  
  /// 打印系统信息
  static void logSystemInfo() {
    debug('=== 系统信息 ===');
    debug('Dart版本: ${Platform.version}');
    debug('Flutter调试模式: $kDebugMode');
    debug('Flutter Profile模式: $kProfileMode');
    debug('Flutter Release模式: $kReleaseMode');
    debug('===============');
  }
}