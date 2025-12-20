import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import '../models/experiment_config.dart';
import '../models/ml_result.dart';
import '../../utils/app_exceptions.dart';

/// 机器学习服务类
class MLService {
  // 为每个云函数定义独立的URL
  static const String _trainModelUrl = 'https://train-ml-model-ituoerp4ka-uc.a.run.app';
  static const String _getHistoryUrl = 'https://get-experiment-history-ituoerp4ka-uc.a.run.app';
  
  // 请求超时时间
  static const Duration _requestTimeout = Duration(seconds: 180); // 训练可能需要更长时间
  static const Duration _uploadTimeout = Duration(seconds: 120);

  final FirebaseStorage _storage = FirebaseStorage.instance;
  final FirebaseAuth _auth = FirebaseAuth.instance;

  /// 上传数据集到Firebase Storage（支持Web）
  Future<String> uploadDataset(
    Uint8List bytes, 
    String fileName, {
    Function(double)? onProgress,
  }) async {
    // 文件大小验证（限制50MB）
    const maxFileSize = 50 * 1024 * 1024; // 50MB
    if (bytes.length > maxFileSize) {
      throw ValidationException('文件大小超过限制（最大50MB）');
    }
    
    // 文件名验证
    if (fileName.isEmpty) {
      throw ValidationException('文件名不能为空');
    }
    
    final extension = fileName.split('.').last.toLowerCase();
    if (extension != 'csv') {
      throw ValidationException('只支持CSV格式文件');
    }
    
    try {
      // 生成唯一文件名
      final String userId = _auth.currentUser?.uid ?? 'anonymous';
      final String timestamp = DateTime.now().millisecondsSinceEpoch.toString();
      final String sanitizedFileName = fileName.replaceAll(RegExp(r'[^\w\.]'), '_');
      final String uniqueFileName = '${timestamp}_$sanitizedFileName';
      final String filePath = 'datasets/$userId/$uniqueFileName';

      // 上传文件
      final Reference ref = _storage.ref().child(filePath);
      final UploadTask uploadTask = ref.putData(
        bytes,
        SettableMetadata(contentType: 'text/csv'),
      );
      
      // 监听上传进度
      if (onProgress != null) {
        uploadTask.snapshotEvents.listen((TaskSnapshot snapshot) {
          final progress = snapshot.bytesTransferred / snapshot.totalBytes;
          onProgress(progress);
        });
      }

      // 等待上传完成（带超时）
      final TaskSnapshot snapshot = await uploadTask.timeout(
        _uploadTimeout,
        onTimeout: () {
          uploadTask.cancel();
          throw TimeoutException('文件上传超时');
        },
      );
      
      // 获取下载URL
      final String downloadUrl = await snapshot.ref.getDownloadURL();
      
      // 返回Storage路径（gs://格式）
      final String bucket = _storage.bucket;
      return 'gs://$bucket/$filePath';
    } on TimeoutException catch (e) {
      throw FileException(
        '文件上传超时，请检查网络连接',
        originalError: e,
      );
    } on FirebaseException catch (e) {
      throw FileException(
        '数据集上传失败: ${e.message}',
        code: e.code,
        originalError: e,
      );
    } catch (e) {
      throw FileException(
        '数据集上传失败: ${e.toString()}',
        originalError: e,
      );
    }
  }

  /// 训练机器学习模型
  Future<MLResult> trainModel(ExperimentConfig config) async {
    // 配置验证
    _validateTrainingConfig(config);
    
    try {
      // 添加用户ID
      if (config.userId == null) {
        config.userId = _auth.currentUser?.uid ?? 'anonymous';
      }

      // 发送训练请求（带超时）
      final response = await http
          .post(
            Uri.parse(_trainModelUrl),
            headers: {
              'Content-Type': 'application/json',
            },
            body: jsonEncode(config.toJson()),
          )
          .timeout(_requestTimeout);

      // 解析响应
      if (response.statusCode == 200) {
        final Map<String, dynamic> data = jsonDecode(response.body);
        return MLResult.fromJson(data);
      } else if (response.statusCode >= 500) {
        // 服务器错误
        String errorMessage = '服务器错误，请稍后重试';
        try {
          final Map<String, dynamic> errorData = jsonDecode(response.body);
          errorMessage = errorData['message'] ?? errorMessage;
        } catch (_) {}
        
        return MLResult(
          status: 'error',
          metrics: {},
          visualizationData: {},
          modelInfo: ModelInfo(
            modelName: config.modelName,
            hyperparameters: config.hyperparameters,
            taskType: config.taskType,
            nFeatures: 0,
            nSamples: 0,
          ),
          errorMessage: errorMessage,
        );
      } else {
        // 客户端错误
        String errorMessage = '训练请求失败';
        try {
          final Map<String, dynamic> errorData = jsonDecode(response.body);
          errorMessage = errorData['message'] ?? errorMessage;
        } catch (_) {}
        
        return MLResult(
          status: 'error',
          metrics: {},
          visualizationData: {},
          modelInfo: ModelInfo(
            modelName: config.modelName,
            hyperparameters: config.hyperparameters,
            taskType: config.taskType,
            nFeatures: 0,
            nSamples: 0,
          ),
          errorMessage: errorMessage,
        );
      }
    } on TimeoutException catch (_) {
      return MLResult(
        status: 'error',
        metrics: {},
        visualizationData: {},
        modelInfo: ModelInfo(
          modelName: config.modelName,
          hyperparameters: config.hyperparameters,
          taskType: config.taskType,
          nFeatures: 0,
          nSamples: 0,
        ),
        errorMessage: '训练超时，请尝试减少数据量或选择更简单的模型',
      );
    } on http.ClientException catch (e) {
      return MLResult(
        status: 'error',
        metrics: {},
        visualizationData: {},
        modelInfo: ModelInfo(
          modelName: config.modelName,
          hyperparameters: config.hyperparameters,
          taskType: config.taskType,
          nFeatures: 0,
          nSamples: 0,
        ),
        errorMessage: '网络连接失败: ${e.message}',
      );
    } catch (e) {
      return MLResult(
        status: 'error',
        metrics: {},
        visualizationData: {},
        modelInfo: ModelInfo(
          modelName: config.modelName,
          hyperparameters: config.hyperparameters,
          taskType: config.taskType,
          nFeatures: 0,
          nSamples: 0,
        ),
        errorMessage: '未知错误: ${e.toString()}',
      );
    }
  }
  
  /// 验证训练配置
  void _validateTrainingConfig(ExperimentConfig config) {
    if (config.modelName.isEmpty) {
      throw ValidationException('模型名称不能为空');
    }
    
    if (config.taskType.isEmpty) {
      throw ValidationException('任务类型不能为空');
    }
    
    if (config.featureColumns.isEmpty) {
      throw ValidationException('特征列表不能为空');
    }
    
    if (config.targetColumn?.isEmpty ?? true) {
      throw ValidationException('目标列不能为空');
    }
    
    // 验证数据集路径
    if (config.datasetUrl.isNotEmpty && !config.datasetUrl.startsWith('gs://')) {
      throw ValidationException('数据集路径格式错误');
    }
  }

  /// 获取实验历史记录
  Future<List<Map<String, dynamic>>> getExperimentHistory({int limit = 10}) async {
    // 参数验证
    if (limit <= 0 || limit > 100) {
      throw ValidationException('limit 必须在 1-100 之间');
    }
    
    try {
      final String userId = _auth.currentUser?.uid ?? 'anonymous';
      
      final response = await http
          .get(
            Uri.parse('$_getHistoryUrl?user_id=$userId&limit=$limit'),
            headers: {
              'Content-Type': 'application/json',
            },
          )
          .timeout(const Duration(seconds: 30));

      if (response.statusCode == 200) {
        final Map<String, dynamic> data = jsonDecode(response.body);
        if (data['status'] == 'success') {
          final experiments = data['experiments'];
          if (experiments is List) {
            return List<Map<String, dynamic>>.from(experiments);
          }
        }
      } else if (response.statusCode >= 500) {
        throw NetworkException('服务器错误，请稍后重试');
      }
      
      return [];
    } on TimeoutException catch (e) {
      throw NetworkException(
        '请求超时，请检查网络连接',
        originalError: e,
      );
    } on http.ClientException catch (e) {
      throw NetworkException(
        '网络请求失败: ${e.message}',
        originalError: e,
      );
    } on FormatException catch (e) {
      throw NetworkException(
        '数据格式错误',
        originalError: e,
      );
    } catch (e) {
      throw NetworkException(
        '获取实验历史失败: ${e.toString()}',
        originalError: e,
      );
    }
  }

  /// 解析CSV文件获取列信息（支持Web）
  Future<CSVInfo> parseCSVContent(String content) async {
    // 内容验证
    if (content.trim().isEmpty) {
      throw ValidationException('CSV文件内容为空');
    }
    
    // 大小限制（50MB文本）
    const maxContentSize = 50 * 1024 * 1024;
    if (content.length > maxContentSize) {
      throw ValidationException('CSV文件过大，请选择小于50MB的文件');
    }
    
    try {
      final List<String> lines = content.split('\n')
          .where((line) => line.trim().isNotEmpty)
          .toList();
      
      if (lines.isEmpty) {
        throw ValidationException('CSV文件没有有效数据');
      }
      
      if (lines.length < 2) {
        throw ValidationException('CSV文件至少需要包含表头和一行数据');
      }

      // 解析表头
      final List<String> headers = lines[0]
          .split(',')
          .map((e) => e.trim().replaceAll('"', '').replaceAll("'", ''))
          .where((e) => e.isNotEmpty)
          .toList();
      
      if (headers.isEmpty) {
        throw ValidationException('CSV文件表头为空');
      }
      
      // 检查表头重复
      final duplicateHeaders = <String>{};
      final seenHeaders = <String>{};
      for (final header in headers) {
        if (seenHeaders.contains(header)) {
          duplicateHeaders.add(header);
        }
        seenHeaders.add(header);
      }
      if (duplicateHeaders.isNotEmpty) {
        throw ValidationException('CSV文件包含重复的列名: ${duplicateHeaders.join(", ")}');
      }

      // 解析数据行（最多前100行用于预览）
      final List<List<String>> data = [];
      int validRowCount = 0;
      for (int i = 1; i < lines.length && validRowCount < 100; i++) {
        if (lines[i].trim().isEmpty) continue;
        
        final List<String> row = lines[i]
            .split(',')
            .map((e) => e.trim().replaceAll('"', '').replaceAll("'", ''))
            .toList();
        
        if (row.length == headers.length) {
          data.add(row);
          validRowCount++;
        }
      }
      
      if (data.isEmpty) {
        throw ValidationException('CSV文件没有有效的数据行');
      }

      // 推断列类型
      final Map<String, ColumnType> columnTypes = {};
      for (int i = 0; i < headers.length; i++) {
        columnTypes[headers[i]] = _inferColumnType(data, i);
      }

      return CSVInfo(
        headers: headers,
        data: data,
        columnTypes: columnTypes,
        totalRows: lines.length - 1,
      );
    } on ValidationException {
      rethrow;
    } on FileSystemException catch (e) {
      throw FileException(
        'CSV文件读取失败: ${e.message}',
        originalError: e,
      );
    } catch (e) {
      throw FileException(
        'CSV解析失败: ${e.toString()}',
        originalError: e,
      );
    }
  }

  /// 推断列类型
  ColumnType _inferColumnType(List<List<String>> data, int columnIndex) {
    if (data.isEmpty) return ColumnType.string;

    bool allNumeric = true;
    bool allInteger = true;
    Set<String> uniqueValues = {};

    for (final row in data) {
      if (columnIndex >= row.length) continue;
      
      final value = row[columnIndex];
      if (value.isEmpty) continue;
      
      uniqueValues.add(value);

      // 尝试解析为数字
      final numValue = num.tryParse(value);
      if (numValue == null) {
        allNumeric = false;
        allInteger = false;
      } else if (!numValue.toString().contains('.')) {
        // 整数
      } else {
        allInteger = false;
      }
    }

    // 如果唯一值少于10个且不是数字，可能是分类变量
    if (!allNumeric && uniqueValues.length < 10) {
      return ColumnType.categorical;
    }

    if (allInteger) return ColumnType.integer;
    if (allNumeric) return ColumnType.numeric;
    
    return ColumnType.string;
  }
}
