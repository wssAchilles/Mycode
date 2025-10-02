import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as path;
import 'package:aws_s3_api/s3-2006-03-01.dart';
import 'package:crypto/crypto.dart';
import '../config/filebase_config.dart';

/// FilebaseService 类
/// 处理与 Filebase 存储服务的所有交互
class FilebaseService {
  /// S3 客户端实例
  late S3 _s3;
  
  /// 基础 URL 前缀，用于构建公共访问 URL
  late String _baseUrlPrefix;

  /// 构造函数
  /// 初始化 S3 客户端
  FilebaseService() {
    _initS3Client();
  }

  /// 初始化 S3 客户端
  void _initS3Client() {
    try {
      _s3 = S3(
        region: FilebaseConfig.region,
        credentials: AwsClientCredentials(
          accessKey: FilebaseConfig.accessKeyId,
          secretKey: FilebaseConfig.secretAccessKey,
        ),
        endpointUrl: FilebaseConfig.endpoint,
      );
      
      // 构建基础 URL 前缀，用于生成公共访问 URL
      _baseUrlPrefix = 'https://s3.filebase.com';
      
      if (FilebaseConfig.isDebugMode) {
        print('Filebase S3 客户端初始化成功');
      }
    } catch (e) {
      print('Filebase S3 客户端初始化失败: $e');
      rethrow;
    }
  }

  /// 上传文件到指定存储桶
  /// [bucketName] - 存储桶名称
  /// [objectKey] - 对象键名
  /// [filePath] - 本地文件路径
  /// 返回上传的文件的 URL
  Future<String> uploadFile(String bucketName, String objectKey, String filePath) async {
    try {
      // 读取文件内容
      final file = File(filePath);
      final fileBytes = await file.readAsBytes();
      final fileExtension = path.extension(filePath).toLowerCase();
      
      // 根据文件扩展名确定内容类型
      String contentType;
      switch (fileExtension) {
        case '.jpg':
        case '.jpeg':
          contentType = 'image/jpeg';
          break;
        case '.png':
          contentType = 'image/png';
          break;
        case '.gif':
          contentType = 'image/gif';
          break;
        case '.json':
          contentType = 'application/json';
          break;
        default:
          contentType = 'application/octet-stream';
      }

      // 上传文件
      final response = await _s3.putObject(
        bucket: bucketName,
        key: objectKey,
        body: fileBytes,
        contentType: contentType,
      );

      if (FilebaseConfig.isDebugMode) {
        print('文件上传成功: $objectKey');
      }

      // 尝试获取 IPFS CID
      final cid = await getIpfsCid(bucketName, objectKey);
      
      // 如果有 CID，返回 IPFS 网关 URL，否则返回 S3 URL
      if (cid != null) {
        return FilebaseConfig.getIpfsGatewayUrl(cid);
      } else {
        return '$_baseUrlPrefix/$bucketName/$objectKey';
      }
    } catch (e) {
      print('文件上传失败: $e');
      rethrow;
    }
  }

  /// 上传二进制数据到指定存储桶
  /// [bucketName] - 存储桶名称
  /// [objectKey] - 对象键名
  /// [data] - 二进制数据
  /// [contentType] - 内容类型
  /// 返回上传的文件的 URL
  Future<String> uploadData(
    String bucketName, 
    String objectKey, 
    Uint8List data, 
    String contentType
  ) async {
    try {
      // 上传数据
      final response = await _s3.putObject(
        bucket: bucketName,
        key: objectKey,
        body: data,
        contentType: contentType,
      );

      if (FilebaseConfig.isDebugMode) {
        print('数据上传成功: $objectKey');
      }

      // 尝试获取 IPFS CID
      final cid = await getIpfsCid(bucketName, objectKey);
      
      // 如果有 CID，返回 IPFS 网关 URL，否则返回 S3 URL
      if (cid != null) {
        return FilebaseConfig.getIpfsGatewayUrl(cid);
      } else {
        return '$_baseUrlPrefix/$bucketName/$objectKey';
      }
    } catch (e) {
      print('数据上传失败: $e');
      rethrow;
    }
  }

  /// 下载文件
  /// [bucketName] - 存储桶名称
  /// [objectKey] - 对象键名
  /// 返回文件内容的二进制数据，如果失败则返回 null
  Future<Uint8List?> downloadFile(String bucketName, String objectKey) async {
    try {
      final response = await _s3.getObject(
        bucket: bucketName,
        key: objectKey,
      );

      if (response.body != null) {
        if (FilebaseConfig.isDebugMode) {
          print('文件下载成功: $objectKey');
        }
        return response.body;
      }
      
      print('文件内容为空: $objectKey');
      return null;
    } catch (e) {
      print('文件下载失败: $e');
      if (e.toString().contains('NoSuchKey')) {
        return null; // 文件不存在，返回 null
      }
      rethrow;
    }
  }

  /// 获取文件的公共可访问 URL
  /// [bucketName] - 存储桶名称
  /// [objectKey] - 对象键名
  /// 返回文件的 URL，如果失败则返回 null
  Future<String?> getFileUrl(String bucketName, String objectKey) async {
    try {
      // 尝试获取 IPFS CID
      final cid = await getIpfsCid(bucketName, objectKey);
      
      // 如果有 CID，返回 IPFS 网关 URL，否则返回 S3 URL
      if (cid != null) {
        return FilebaseConfig.getIpfsGatewayUrl(cid);
      } else {
        return '$_baseUrlPrefix/$bucketName/$objectKey';
      }
    } catch (e) {
      print('获取文件 URL 失败: $e');
      return null;
    }
  }

  /// 列出存储桶中的对象
  /// [bucketName] - 存储桶名称
  /// [prefix] - 可选的对象键名前缀
  /// 返回对象键名列表
  Future<List<String>> listObjects(String bucketName, {String? prefix}) async {
    try {
      print('尝试列出存储桶 $bucketName 中的对象，前缀: ${prefix ?? "无"}');
      
      final response = await _s3.listObjectsV2(
        bucket: bucketName,
        prefix: prefix,
      );

      final objects = response.contents ?? [];
      final keys = objects
          .map((obj) => obj.key ?? '')
          .where((key) => key.isNotEmpty)
          .toList();

      if (FilebaseConfig.isDebugMode) {
        print('列出对象成功，共 ${keys.length} 个对象');
      }

      return keys;
    } catch (e) {
      // 如果错误是NoSuchBucket或类似错误，返回空列表而不是抛出异常
      if (e.toString().contains('NoSuchBucket') || 
          e.toString().contains('NotFound') || 
          e.toString().contains('NoSuchKey')) {
        print('存储桶 $bucketName 不存在或为空，返回空列表: $e');
        return [];
      } else {
        print('列出对象失败: $e');
        // 其他错误也返回空列表，以提高应用程序的健壮性
        return [];
      }
    }
  }

  /// 删除对象
  /// [bucketName] - 存储桶名称
  /// [objectKey] - 对象键名
  Future<void> deleteObject(String bucketName, String objectKey) async {
    try {
      await _s3.deleteObject(
        bucket: bucketName,
        key: objectKey,
      );

      if (FilebaseConfig.isDebugMode) {
        print('删除对象成功: $objectKey');
      }
    } catch (e) {
      print('删除对象失败: $e');
      rethrow;
    }
  }

  /// 上传 JSON 数据
  /// [bucketName] - 存储桶名称
  /// [objectKey] - 对象键名
  /// [jsonData] - JSON 数据
  /// 返回上传的 JSON 文件的 URL
  Future<String> uploadJson(
    String bucketName, 
    String objectKey, 
    Map<String, dynamic> jsonData
  ) async {
    try {
      // 将 JSON 转换为字符串
      final jsonString = jsonEncode(jsonData);
      
      // 转换为 UTF-8 编码的字节
      final jsonBytes = utf8.encode(jsonString);
      
      // 上传 JSON 数据
      return await uploadData(
        bucketName, 
        objectKey, 
        Uint8List.fromList(jsonBytes), 
        'application/json'
      );
    } catch (e) {
      print('上传 JSON 数据失败: $e');
      rethrow;
    }
  }

  /// 下载并解析 JSON 对象
  /// [bucketName] - 存储桶名称
  /// [objectKey] - 对象键名
  /// 返回解析后的 JSON 数据，如果失败则返回 null
  Future<Map<String, dynamic>?> downloadJson(String bucketName, String objectKey) async {
    try {
      // 下载文件
      final fileData = await downloadFile(bucketName, objectKey);
      
      if (fileData != null) {
        // 解析 JSON 数据
        final jsonString = utf8.decode(fileData);
        final jsonData = jsonDecode(jsonString) as Map<String, dynamic>;
        
        if (FilebaseConfig.isDebugMode) {
          print('JSON 数据下载并解析成功: $objectKey');
        }
        
        return jsonData;
      }
      
      return null;
    } catch (e) {
      print('下载或解析 JSON 数据失败: $e');
      return null;
    }
  }

  /// 获取对象的 IPFS CID
  /// [bucketName] - 存储桶名称
  /// [objectKey] - 对象键名
  /// 返回 IPFS CID，如果失败则返回 null
  Future<String?> getIpfsCid(String bucketName, String objectKey) async {
    try {
      final response = await _s3.headObject(
        bucket: bucketName,
        key: objectKey,
      );
      
      // Filebase 在对象元数据中存储 IPFS CID
      final metadata = response.metadata;
      // 使用正确的键名 'cid' 获取 IPFS CID
      return metadata?['cid'];
    } catch (e) {
      // 恢复正常的错误处理逻辑
      print('获取 IPFS CID 失败: $e');
      return null;
    }
  }

  /// 检查对象是否存在
  /// [bucketName] - 存储桶名称
  /// [objectKey] - 对象键名
  /// 返回对象是否存在
  Future<bool> objectExists(String bucketName, String objectKey) async {
    try {
      await _s3.headObject(
        bucket: bucketName,
        key: objectKey,
      );
      return true;
    } catch (e) {
      if (e.toString().contains('NotFound') || e.toString().contains('NoSuchKey')) {
        return false;
      }
      print('检查对象是否存在失败: $e');
      rethrow;
    }
  }

  /// 获取JSON数据（作为downloadJson的别名）
  /// [bucketName] - 存储桶名称
  /// [objectKey] - 对象键名
  /// 返回解析后的JSON数据
  Future<Map<String, dynamic>?> getJson(String bucketName, String objectKey) async {
    return downloadJson(bucketName, objectKey);
  }
  
  /// 读取JSON数据（作为downloadJson的别名）
  /// [bucketName] - 存储桶名称
  /// [objectKey] - 对象键名
  /// 返回解析后的JSON数据
  Future<Map<String, dynamic>?> readJson(String bucketName, String objectKey) async {
    return downloadJson(bucketName, objectKey);
  }
  
  /// 删除文件（作为deleteObject的别名）
  /// [bucketName] - 存储桶名称
  /// [objectKey] - 对象键名
  Future<void> deleteFile(String bucketName, String objectKey) async {
    return deleteObject(bucketName, objectKey);
  }
}
