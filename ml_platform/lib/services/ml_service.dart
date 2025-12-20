import 'dart:typed_data';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';
import '../utils/app_exceptions.dart';
import '../ml/models/experiment_config.dart';

/// 机器学习服务类
/// 负责与后端 ML API 交互，处理模型训练和实验记录请求
class MLService {
  static final FirebaseFunctions _functions = FirebaseFunctions.instance;
  static final FirebaseStorage _storage = FirebaseStorage.instance;
  
  // 训练请求超时时间 (ML 训练可能较慢，设置长一点)
  static const Duration _trainTimeout = Duration(minutes: 5);
  
  // 查询请求超时时间
  static const Duration _queryTimeout = Duration(seconds: 30);

  /// 解析 CSV 内容
  /// 返回 CSVInfo 对象 (包含表头、预览数据、列类型推断)
  Future<CSVInfo> parseCSVContent(String content) async {
    try {
      final lines = content.split('\n');
      if (lines.isEmpty) throw Exception('CSV文件为空');
      
      // 解析表头
      final headerLine = lines[0].trim();
      if (headerLine.isEmpty) throw Exception('CSV表头为空');
      final headers = headerLine.split(',').map((e) => e.trim()).toList();
      
      // 解析数据行 (最多预览100行)
      final dataRows = <List<String>>[];
      int totalRows = 0;
      
      for (var i = 1; i < lines.length; i++) {
        final line = lines[i].trim();
        if (line.isEmpty) continue;
        
        totalRows++;
        if (dataRows.length < 100) {
          dataRows.add(line.split(',').map((e) => e.trim()).toList());
        }
      }
      
      // 推断列类型
      final columnTypes = <String, ColumnType>{};
      for (var i = 0; i < headers.length; i++) {
        final header = headers[i];
        columnTypes[header] = _inferColumnType(dataRows, i);
      }
      
      return CSVInfo(
        headers: headers,
        data: dataRows,
        totalRows: totalRows,
        columnTypes: columnTypes,
      );
    } catch (e) {
      throw ValidationException('CSV 解析失败: $e');
    }
  }
  
  /// 推断列类型
  ColumnType _inferColumnType(List<List<String>> rows, int colIndex) {
    if (rows.isEmpty) return ColumnType.string;
    
    bool isNumeric = true;
    bool isInteger = true;
    final valueSet = <String>{};
    
    for (var row in rows) {
      if (colIndex >= row.length) continue;
      
      final val = row[colIndex];
      if (val.isEmpty) continue;
      
      valueSet.add(val);
      
      if (double.tryParse(val) == null) {
        isNumeric = false;
        isInteger = false;
      } else if (int.tryParse(val) == null) {
        isInteger = false;
      }
    }
    
    if (isInteger) {
      // 如果唯一值很少，可能是分类变量（即使是数字）
      if (valueSet.length < 10 && valueSet.length < rows.length * 0.5) {
        return ColumnType.categorical;
      }
      return ColumnType.integer;
    }
    
    if (isNumeric) return ColumnType.numeric;
    
    // 如果非数字，且唯一值很少，推断为分类变量
    if (valueSet.length < 20 && valueSet.length < rows.length * 0.5) {
      return ColumnType.categorical;
    }
    
    return ColumnType.string;
  }

  /// 上传数据集到 Firebase Storage
  /// 返回下载 URL
  Future<String> uploadDataset(Uint8List fileBytes, String fileName) async {
    try {
      final ref = _storage.ref().child('datasets').child('${DateTime.now().millisecondsSinceEpoch}_$fileName');
      
      // 设置元数据
      final metadata = SettableMetadata(
        contentType: 'text/csv',
        customMetadata: {
          'originalName': fileName,
          'uploadTime': DateTime.now().toIso8601String(),
        },
      );
      
      await ref.putData(fileBytes, metadata);
      final downloadUrl = await ref.getDownloadURL();
      
      return downloadUrl;
    } catch (e) {
      throw NetworkException('上传数据集失败: $e', originalError: e);
    }
  }

  /// 提交模型训练任务
  static Future<Map<String, dynamic>> trainModel({
    required String datasetUrl,
    required Map<String, dynamic> modelConfig,
    required String taskType,
    required List<String> featureColumns,
    String? targetColumn,
    String? userId,
  }) async {
    if (datasetUrl.isEmpty) throw ArgumentError('数据集 URL 不能为空');
    if (featureColumns.isEmpty) throw ArgumentError('特征列不能为空');
    
    try {
      final callable = _functions.httpsCallable(
        'train_ml_model',
        options: HttpsCallableOptions(timeout: _trainTimeout),
      );
      
      final response = await callable.call({
        'dataset_url': datasetUrl,
        'model_config': modelConfig,
        'task_type': taskType,
        'feature_columns': featureColumns,
        'target_column': targetColumn,
        'user_id': userId ?? 'anonymous',
      });
      
      final data = Map<String, dynamic>.from(response.data as Map);
      
      if (data['status'] == 'error') {
        throw MLException(data['message'] ?? '训练失败');
      }
      
      return data;
      
    } on FirebaseFunctionsException catch (e) {
      debugPrint('ML 训练服务错误: ${e.code} - ${e.message}');
      throw MLException('训练服务暂时不可用: ${e.message}', originalError: e);
    } catch (e) {
      debugPrint('ML 训练未知错误: $e');
      throw MLException('发生未知错误: $e', originalError: e);
    }
  }

  /// 获取实验历史记录
  static Future<List<Map<String, dynamic>>> getExperimentHistory({
    required String userId,
    int limit = 10,
  }) async {
    try {
      final callable = _functions.httpsCallable(
        'get_experiment_history',
        options: HttpsCallableOptions(timeout: _queryTimeout),
      );
      
      final response = await callable.call({
        'user_id': userId,
        'limit': limit,
      });
      
      final data = Map<String, dynamic>.from(response.data as Map);
      
      if (data['status'] == 'error') {
        throw MLException(data['message'] ?? '获取历史记录失败');
      }
      
      final list = data['experiments'] as List?;
      return list?.map((e) => Map<String, dynamic>.from(e as Map)).toList() ?? [];
      
    } catch (e) {
      debugPrint('获取实验历史失败: $e');
      throw MLException('无法获取历史记录: $e', originalError: e);
    }
  }
}
