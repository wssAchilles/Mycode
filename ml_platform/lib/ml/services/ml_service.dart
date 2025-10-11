import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:path/path.dart' as path;
import '../models/experiment_config.dart';
import '../models/ml_result.dart';
import '../../utils/app_exceptions.dart';

/// 机器学习服务类
class MLService {
  // 为每个云函数定义独立的URL
  static const String _trainModelUrl = 'https://train-ml-model-ituoerp4ka-uc.a.run.app';
  static const String _getHistoryUrl = 'https://get-experiment-history-ituoerp4ka-uc.a.run.app';

  final FirebaseStorage _storage = FirebaseStorage.instance;
  final FirebaseAuth _auth = FirebaseAuth.instance;

  /// 上传数据集到Firebase Storage
  Future<String> uploadDataset(File file) async {
    try {
      // 生成唯一文件名
      final String userId = _auth.currentUser?.uid ?? 'anonymous';
      final String timestamp = DateTime.now().millisecondsSinceEpoch.toString();
      final String fileName = '${timestamp}_${path.basename(file.path)}';
      final String filePath = 'datasets/$userId/$fileName';

      // 上传文件
      final Reference ref = _storage.ref().child(filePath);
      final UploadTask uploadTask = ref.putFile(
        file,
        SettableMetadata(contentType: 'text/csv'),
      );

      // 等待上传完成
      final TaskSnapshot snapshot = await uploadTask;
      
      // 获取下载URL
      final String downloadUrl = await snapshot.ref.getDownloadURL();
      
      // 返回Storage路径（gs://格式）
      final String bucket = _storage.bucket;
      return 'gs://$bucket/$filePath';
    } on FirebaseException catch (e) {
      throw FileException(
        '数据集上传失败: ${e.message}',
        code: e.code,
        originalError: e,
      );
    } catch (e) {
      throw FileException(
        '数据集上传失败',
        originalError: e,
      );
    }
  }

  /// 训练机器学习模型
  Future<MLResult> trainModel(ExperimentConfig config) async {
    try {
      // 添加用户ID
      if (config.userId == null) {
        config.userId = _auth.currentUser?.uid ?? 'anonymous';
      }

      // 发送训练请求
      final response = await http.post(
        Uri.parse(_trainModelUrl),
        headers: {
          'Content-Type': 'application/json',
        },
        body: jsonEncode(config.toJson()),
      );

      // 解析响应
      if (response.statusCode == 200) {
        final Map<String, dynamic> data = jsonDecode(response.body);
        return MLResult.fromJson(data);
      } else {
        // 尝试解析错误信息
        try {
          final Map<String, dynamic> errorData = jsonDecode(response.body);
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
            errorMessage: errorData['message'] ?? '训练失败',
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
            errorMessage: '训练失败: HTTP ${response.statusCode}',
          );
        }
      }
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
        errorMessage: '网络错误: $e',
      );
    }
  }

  /// 获取实验历史记录
  Future<List<Map<String, dynamic>>> getExperimentHistory({int limit = 10}) async {
    try {
      final String userId = _auth.currentUser?.uid ?? 'anonymous';
      
      final response = await http.get(
        Uri.parse('$_getHistoryUrl?user_id=$userId&limit=$limit'),
        headers: {
          'Content-Type': 'application/json',
        },
      );

      if (response.statusCode == 200) {
        final Map<String, dynamic> data = jsonDecode(response.body);
        if (data['status'] == 'success') {
          return List<Map<String, dynamic>>.from(data['experiments'] ?? []);
        }
      }
      
      return [];
    } on http.ClientException catch (e) {
      throw NetworkException(
        '网络请求失败: ${e.message}',
        originalError: e,
      );
    } catch (e) {
      throw NetworkException(
        '获取实验历史失败',
        originalError: e,
      );
    }
  }

  /// 解析CSV文件获取列信息
  Future<CSVInfo> parseCSVFile(File file) async {
    try {
      final String content = await file.readAsString();
      final List<String> lines = content.split('\n');
      
      if (lines.isEmpty) {
        throw ValidationException('CSV文件为空');
      }

      // 解析表头
      final List<String> headers = lines[0]
          .split(',')
          .map((e) => e.trim().replaceAll('"', ''))
          .toList();

      // 解析数据行（最多前100行用于预览）
      final List<List<String>> data = [];
      for (int i = 1; i < lines.length && i <= 100; i++) {
        if (lines[i].trim().isEmpty) continue;
        
        final List<String> row = lines[i]
            .split(',')
            .map((e) => e.trim().replaceAll('"', ''))
            .toList();
        
        if (row.length == headers.length) {
          data.add(row);
        }
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
    } on FileSystemException catch (e) {
      throw FileException(
        'CSV文件读取失败: ${e.message}',
        originalError: e,
      );
    } on ValidationException {
      rethrow;
    } catch (e) {
      throw FileException(
        'CSV解析失败',
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

/// CSV文件信息
class CSVInfo {
  final List<String> headers;
  final List<List<String>> data;
  final Map<String, ColumnType> columnTypes;
  final int totalRows;

  CSVInfo({
    required this.headers,
    required this.data,
    required this.columnTypes,
    required this.totalRows,
  });
}

/// 列类型枚举
enum ColumnType {
  numeric,     // 数值型（浮点数）
  integer,     // 整数型
  categorical, // 分类型
  string,      // 字符串型
}
