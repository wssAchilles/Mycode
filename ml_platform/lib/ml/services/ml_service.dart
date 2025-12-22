import 'dart:typed_data';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';
import '../../utils/app_exceptions.dart';
import '../models/experiment_config.dart';
import '../models/ml_result.dart';
import '../../services/firebase_service.dart';

/// 机器学习服务类
/// 负责与后端 ML API 交互，处理模型训练和实验记录请求
class MLService {
  static final FirebaseFunctions _functions = FirebaseFunctions.instance;
  static final FirebaseStorage _storage = FirebaseStorage.instance;
  
  // 训练请求超时时间 (ML 训练可能较慢，设置长一点)
  static const Duration _trainTimeout = Duration(minutes: 15);
  
  // 查询请求超时时间
  static const Duration _queryTimeout = Duration(seconds: 30);

  /// 解析 CSV 内容 (在 Isolate 中运行以避免阻塞 UI)
  /// 返回 CSVInfo 对象 (包含表头、预览数据、列类型推断)
  Future<CSVInfo> parseCSVContent(String content) async {
    try {
      return await compute(_parseCSVInternal, content);
    } catch (e) {
      throw ValidationException('CSV 解析失败: $e');
    }
  }

  /// 内部静态解析方法 (供 compute 调用)
  static CSVInfo _parseCSVInternal(String content) {
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
      columnTypes[header] = _inferColumnTypeStatic(dataRows, i);
    }
    
    return CSVInfo(
      headers: headers,
      data: dataRows,
      totalRows: totalRows,
      columnTypes: columnTypes,
    );
  }

  /// 静态类型推断方法
  static ColumnType _inferColumnTypeStatic(List<List<String>> rows, int colIndex) {
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
      if (valueSet.length < 10 && valueSet.length < rows.length * 0.5) {
        return ColumnType.categorical;
      }
      return ColumnType.integer;
    }
    
    if (isNumeric) return ColumnType.numeric;
    
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
  Future<MLResult> trainModel(ExperimentConfig config) async {
    try {
      final callable = _functions.httpsCallable(
        'train_ml_model',
        options: HttpsCallableOptions(timeout: _trainTimeout),
      );
      
      final response = await callable.call(config.toJson());
      
      final data = Map<String, dynamic>.from(response.data as Map);
      
      // 解析结果
      return MLResult.fromJson(data);
      
    } on FirebaseFunctionsException catch (e) {
      debugPrint('ML 训练服务错误: ${e.code} - ${e.message}');
      throw MLException('训练服务暂时不可用: ${e.message}', originalError: e);
    } catch (e) {
      debugPrint('ML 训练未知错误: $e');
      throw MLException('发生未知错误: $e', originalError: e);
    }
  }

  /// 获取实验历史记录
  Future<List<Map<String, dynamic>>> getExperimentHistory({
    String? userId,
    int limit = 10,
  }) async {
    try {
      final currentUserId = userId ?? FirebaseService().currentUser?.uid ?? 'anonymous';
      
      final callable = _functions.httpsCallable(
        'get_experiment_history',
        options: HttpsCallableOptions(timeout: _queryTimeout),
      );
      
      final response = await callable.call({
        'user_id': currentUserId,
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
