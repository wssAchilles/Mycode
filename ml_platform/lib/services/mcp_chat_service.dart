import 'package:http/http.dart' as http;
import 'dart:convert';
import 'dart:async';
import '../utils/request_cache.dart';

/// MCP 聊天助手服务
/// 与后端 MCP Server 通信,提供 AI 辅助学习功能
class MCPChatService {
  // 请求缓存管理器
  static final RequestCache _cache = RequestCache();
  // Firebase Cloud Functions 基础 URL (v2 格式)
  // v2 格式: https://<function-name>-<hash>-<region-code>.a.run.app
  // v1 格式: https://<region>-<project-id>.cloudfunctions.net (已废弃)
  // 
  // 您的项目使用 Cloud Functions v2,URL 从 Cloud Run 获取
  static const String _baseUrl =
      'https://mcp-chat-assistant-ituoerp4ka-uc.a.run.app';
  
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
        final response = await http
            .post(
              Uri.parse(_baseUrl),
              headers: {'Content-Type': 'application/json'},
              body: json.encode({
                'tool': tool,
                'arguments': arguments,
              }),
            )
            .timeout(_requestTimeout);

        if (response.statusCode == 200) {
          final data = json.decode(response.body);
          
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
        } else if (response.statusCode >= 500) {
          // 服务器错误，可以重试
          lastException = MCPException(
            '服务器错误 (${response.statusCode})',
            code: 'SERVER_ERROR',
            statusCode: response.statusCode,
          );
          
          if (attempts < _maxRetries) {
            await Future.delayed(_retryDelay * attempts);
            continue;
          }
        } else {
          // 客户端错误，不重试
          String errorMessage = '请求失败';
          try {
            final errorData = json.decode(response.body);
            errorMessage = errorData['message'] ?? errorMessage;
          } catch (_) {}
          
          throw MCPException(
            errorMessage,
            code: 'CLIENT_ERROR',
            statusCode: response.statusCode,
          );
        }
      } on TimeoutException catch (e) {
        lastException = MCPException(
          '请求超时，请检查网络连接',
          code: 'TIMEOUT',
          originalError: e,
        );
        
        if (attempts < _maxRetries) {
          await Future.delayed(_retryDelay * attempts);
          continue;
        }
      } on http.ClientException catch (e) {
        lastException = MCPException(
          '网络连接失败: ${e.message}',
          code: 'NETWORK_ERROR',
          originalError: e,
        );
        
        if (attempts < _maxRetries) {
          await Future.delayed(_retryDelay * attempts);
          continue;
        }
      } on FormatException catch (e) {
        // JSON 解析错误，不重试
        throw MCPException(
          '响应数据格式错误',
          code: 'PARSE_ERROR',
          originalError: e,
        );
      } catch (e) {
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
  ///
  /// [algorithmName] 算法名称 (如 'bubble_sort')
  /// [category] 算法类别 ('sorting', 'data_structures', 'os_algorithms', 'ml_algorithms')
  /// [detailLevel] 详细程度 ('basic', 'detailed', 'expert')
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
  ///
  /// [algorithmType] 算法类型
  /// [framework] 框架 ('flutter' 或 'dart')
  /// [animationStyle] 动画风格 ('basic', 'smooth', 'interactive')
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
  ///
  /// [metrics] 评估指标
  /// [taskType] 任务类型 ('classification', 'regression', 'clustering')
  /// [modelType] 模型类型
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
  ///
  /// [modelName] 模型名称
  /// [taskType] 任务类型
  /// [datasetInfo] 数据集信息
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
  ///
  /// [algorithms] 算法列表
  /// [category] 算法类别
  /// [criteria] 比较维度
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
  ///
  /// [errorMessage] 错误信息
  /// [codeSnippet] 代码片段
  /// [context] 问题上下文
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
  ///
  /// 用于自由对话,系统会自动选择合适的工具
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

/// MCP 服务异常类
class MCPException implements Exception {
  final String message;
  final String code;
  final int? statusCode;
  final Object? originalError;

  MCPException(
    this.message, {
    required this.code,
    this.statusCode,
    this.originalError,
  });

  @override
  String toString() {
    final buffer = StringBuffer('MCPException: $message');
    if (statusCode != null) {
      buffer.write(' (HTTP $statusCode)');
    }
    return buffer.toString();
  }

  /// 获取用户友好的错误消息
  String get userMessage {
    switch (code) {
      case 'TIMEOUT':
        return '请求超时，请检查网络连接后重试';
      case 'NETWORK_ERROR':
        return '网络连接失败，请检查网络设置';
      case 'SERVER_ERROR':
        return '服务器暂时无法响应，请稍后重试';
      case 'CLIENT_ERROR':
        return message;
      case 'PARSE_ERROR':
        return '数据格式错误，请联系技术支持';
      default:
        return '操作失败: $message';
    }
  }

  /// 判断是否可以重试
  bool get canRetry {
    return code == 'TIMEOUT' || code == 'NETWORK_ERROR' || code == 'SERVER_ERROR';
  }
}
