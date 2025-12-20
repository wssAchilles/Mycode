import 'dart:convert';
import 'dart:async';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart';
import '../utils/request_cache.dart';
import '../utils/app_exceptions.dart';

/// MCP 聊天助手服务
/// 与后端 MCP Server 通信,提供 AI 辅助学习功能
class MCPChatService {
  // 请求缓存管理器
  static final RequestCache _cache = RequestCache();
  
  // 云函数实例
  // 默认使用 us-central1 区域，如不同需指定 region 参数
  static final FirebaseFunctions _functions = FirebaseFunctions.instance;

  // 请求超时时间
  static const Duration _requestTimeout = Duration(seconds: 90);
  
  // 最大重试次数
  static const int _maxRetries = 2;
  
  // 重试延迟
  static const Duration _retryDelay = Duration(seconds: 1);

  /// 通用请求方法（带重试和超时控制）
  static Future<Map<String, dynamic>> _makeRequest({
    required String tool,
    required Map<String, dynamic> arguments,
    bool useCache = true,
  }) async {
    // 参数验证
    if (tool.isEmpty) {
      throw ArgumentError('工具名称不能为空');
    }
    
    // 尝试从缓存获取（chat工具不缓存）
    if (useCache && tool != 'chat') {
      final cachedResult = _cache.get(tool, arguments);
      if (cachedResult != null) {
        return {
          'status': 'success',
          'result': cachedResult,
          'tool': tool,
          'from_cache': true,
        };
      }
    }
    
    int attempts = 0;
    Exception? lastException;
    
    while (attempts < _maxRetries) {
      attempts++;
      
      try {
        // 调用名为 'mcp_chat_assistant' 的云函数
        final callable = _functions.httpsCallable(
          'mcp_chat_assistant',
          options: HttpsCallableOptions(timeout: _requestTimeout),
        );
        
        final response = await callable.call({
          'tool': tool,
          'arguments': arguments,
        });

        // 将 Map<dynamic, dynamic> 转换为 Map<String, dynamic>
        // 云函数 SDK 返回的数据即为 JSON 反序列化后的对象
        final data = Map<String, dynamic>.from(response.data as Map);
          
        // 检查响应状态
        if (data['status'] == 'error') {
          throw MCPException(
            '服务器返回错误: ${data['message'] ?? '未知错误'}',
            code: 'SERVER_ERROR',
          );
        }
        
        // 缓存成功的响应（chat工具除外）
        if (useCache && tool != 'chat' && data['result'] != null) {
          _cache.set(tool, arguments, data['result'].toString());
        }
        
        return data;
        
      } on FirebaseFunctionsException catch (e) {
        // Firebase 特有的异常处理
        // code, message, details
        debugPrint('Firebase 函数调用错误 [${e.code}]: ${e.message}');
        
        lastException = MCPException(
          '云函数错误: ${e.message}',
          code: 'SERVER_ERROR',
          originalError: e,
        );
        
        // 对于部分错误（如内部错误、可用性问题），允许重试
        if (e.code == 'internal' || e.code == 'unavailable' || e.code == 'deadline-exceeded') {
          if (attempts < _maxRetries) {
            await Future.delayed(_retryDelay * attempts);
            continue;
          }
        } else {
          // 其他错误（如 invalid-argument），不重试
          break;
        }
      } catch (e) {
        debugPrint('未知错误: $e');
        lastException = MCPException(
          '未知错误: ${e.toString()}',
          code: 'UNKNOWN_ERROR',
          originalError: e,
        );
        
        if (attempts < _maxRetries) {
          await Future.delayed(_retryDelay * attempts);
          continue;
        }
      }
    }
    
    // 所有重试都失败了
    throw lastException ?? MCPException('请求失败', code: 'UNKNOWN_ERROR');
  }

  /// 解释算法
  static Future<String> explainAlgorithm({
    required String algorithmName,
    required String category,
    String detailLevel = 'basic',
  }) async {
    // 输入验证
    if (algorithmName.trim().isEmpty) {
      throw ArgumentError('算法名称不能为空');
    }
    if (category.trim().isEmpty) {
      throw ArgumentError('算法类别不能为空');
    }
    
    final data = await _makeRequest(
      tool: 'explain_algorithm',
      arguments: {
        'algorithm_name': algorithmName.trim(),
        'category': category.trim(),
        'detail_level': detailLevel,
      },
    );
    
    return data['result']?.toString() ?? '无法获取解释';
  }

  /// 生成可视化代码
  static Future<String> generateVisualizationCode({
    required String algorithmType,
    String framework = 'flutter',
    String animationStyle = 'smooth',
  }) async {
    if (algorithmType.trim().isEmpty) {
      throw ArgumentError('算法类型不能为空');
    }
    
    final data = await _makeRequest(
      tool: 'generate_visualization_code',
      arguments: {
        'algorithm_type': algorithmType.trim(),
        'framework': framework,
        'animation_style': animationStyle,
      },
    );
    
    return data['result']?.toString() ?? '无法生成代码';
  }

  /// 分析机器学习结果
  static Future<String> analyzeMLResults({
    required Map<String, dynamic> metrics,
    required String taskType,
    String? modelType,
  }) async {
    if (metrics.isEmpty) {
      throw ArgumentError('评估指标不能为空');
    }
    if (taskType.trim().isEmpty) {
      throw ArgumentError('任务类型不能为空');
    }
    
    final data = await _makeRequest(
      tool: 'analyze_ml_results',
      arguments: {
        'metrics': metrics,
        'task_type': taskType.trim(),
        if (modelType != null && modelType.isNotEmpty) 'model_type': modelType.trim(),
      },
    );
    
    return data['result']?.toString() ?? '无法分析结果';
  }

  /// 建议超参数
  static Future<String> suggestHyperparameters({
    required String modelName,
    required String taskType,
    Map<String, dynamic>? datasetInfo,
  }) async {
    if (modelName.trim().isEmpty) {
      throw ArgumentError('模型名称不能为空');
    }
    if (taskType.trim().isEmpty) {
      throw ArgumentError('任务类型不能为空');
    }
    
    final data = await _makeRequest(
      tool: 'suggest_hyperparameters',
      arguments: {
        'model_name': modelName.trim(),
        'task_type': taskType.trim(),
        if (datasetInfo != null && datasetInfo.isNotEmpty) 'dataset_info': datasetInfo,
      },
    );
    
    return data['result']?.toString() ?? '无法获取建议';
  }

  /// 比较算法
  static Future<String> compareAlgorithms({
    required List<String> algorithms,
    required String category,
    List<String>? criteria,
  }) async {
    if (algorithms.isEmpty) {
      throw ArgumentError('算法列表不能为空');
    }
    if (algorithms.length < 2) {
      throw ArgumentError('至少需要2个算法进行比较');
    }
    if (category.trim().isEmpty) {
      throw ArgumentError('算法类别不能为空');
    }
    
    final data = await _makeRequest(
      tool: 'compare_algorithms',
      arguments: {
        'algorithms': algorithms.map((a) => a.trim()).where((a) => a.isNotEmpty).toList(),
        'category': category.trim(),
        if (criteria != null && criteria.isNotEmpty) 
          'comparison_criteria': criteria.map((c) => c.trim()).where((c) => c.isNotEmpty).toList(),
      },
    );
    
    return data['result']?.toString() ?? '无法比较算法';
  }

  /// 调试可视化代码
  static Future<String> debugVisualization({
    required String errorMessage,
    String? codeSnippet,
    String? context,
  }) async {
    if (errorMessage.trim().isEmpty) {
      throw ArgumentError('错误信息不能为空');
    }
    
    final data = await _makeRequest(
      tool: 'debug_visualization',
      arguments: {
        'error_message': errorMessage.trim(),
        if (codeSnippet != null && codeSnippet.isNotEmpty) 'code_snippet': codeSnippet.trim(),
        if (context != null && context.isNotEmpty) 'context': context.trim(),
      },
    );
    
    return data['result']?.toString() ?? '无法提供调试建议';
  }

  /// 通用聊天接口
  static Future<String> chat({
    required String message,
    List<Map<String, String>>? conversationHistory,
  }) async {
    if (message.trim().isEmpty) {
      throw ArgumentError('消息内容不能为空');
    }
    
    // 限制历史记录长度，避免请求过大
    List<Map<String, String>>? limitedHistory;
    if (conversationHistory != null && conversationHistory.isNotEmpty) {
      final maxHistoryLength = 10; // 最多保留最近10轮对话
      limitedHistory = conversationHistory.length > maxHistoryLength
          ? conversationHistory.sublist(conversationHistory.length - maxHistoryLength)
          : conversationHistory;
    }
    
    final data = await _makeRequest(
      tool: 'chat',
      arguments: {
        'message': message.trim(),
        if (limitedHistory != null) 'history': limitedHistory,
      },
    );
    
    return data['result']?.toString() ?? '无法获取回复';
  }
}
