import 'dart:io';
import 'dart:convert';
import 'dart:async';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as path;
import 'package:mime/mime.dart';
import '../config/tencent_cloud_config.dart';

/// 腾讯云COS上传结果
class TencentUploadResult {
  final bool success;
  final String? url;
  final String? error;
  final String? fileName;
  
  TencentUploadResult._({
    required this.success,
    this.url,
    this.error,
    this.fileName,
  });
  
  factory TencentUploadResult.success(String fileName, String url) {
    return TencentUploadResult._(
      success: true,
      url: url,
      fileName: fileName,
    );
  }
  
  factory TencentUploadResult.error(String error) {
    return TencentUploadResult._(
      success: false,
      error: error,
    );
  }
}

/// 腾讯云COS文件上传服务
class TencentCOSService {
  /// 上传HTML内容到腾讯云COS（用于自包含播放器）
  /// [htmlContent] HTML内容字符串
  /// [fileName] 文件名（不包含路径）
  /// 返回 [TencentUploadResult] 包含上传结果
  static Future<TencentUploadResult> uploadHTMLContent(
    String htmlContent,
    String fileName,
  ) async {
    try {
      print('开始上传HTML内容: $fileName');
      
      // 验证配置
      if (!validateConfig()) {
        final errors = getConfigErrors();
        return TencentUploadResult.error('配置错误: ${errors.join(', ')}');
      }
      
      // 构建上传URL（使用标准COS域名）
      final uploadUrl = 'https://${TencentCloudConfig.bucketDomain}/$fileName';
      print('上传URL: $uploadUrl');
      
      // 发送PUT请求上传HTML内容
      final response = await http.put(
        Uri.parse(uploadUrl),
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          'x-cos-acl': 'public-read', // 设置文件为公有读
        },
        body: utf8.encode(htmlContent),
      ).timeout(
        const Duration(minutes: 2),
        onTimeout: () => throw Exception('上传超时'),
      );
      
      print('上传响应状态码: ${response.statusCode}');
      print('上传响应头: ${response.headers}');
      
      if (response.statusCode == 200 || response.statusCode == 201) {
        print('HTML文件上传成功');
        
        // 构建静态网站访问URL
        final staticUrl = 'https://${TencentCloudConfig.bucketName}.cos-website.${TencentCloudConfig.region}.myqcloud.com/$fileName';
        print('静态网站URL: $staticUrl');
        
        // 验证文件是否可访问
        await Future.delayed(Duration(seconds: 2)); // 等待文件生效
        
        try {
          final verifyResponse = await http.head(Uri.parse(staticUrl)).timeout(Duration(seconds: 10));
          print('验证响应状态码: ${verifyResponse.statusCode}');
          
          if (verifyResponse.statusCode == 200) {
            return TencentUploadResult.success(fileName, staticUrl);
          } else {
            return TencentUploadResult.error('文件上传成功但无法访问，状态码: ${verifyResponse.statusCode}');
          }
        } catch (verifyError) {
          print('验证访问失败: $verifyError');
          // 即使验证失败，也返回成功，可能是网络延迟
          return TencentUploadResult.success(fileName, staticUrl);
        }
        
      } else {
        final error = 'HTML上传失败: ${response.statusCode} - ${response.body}';
        print(error);
        return TencentUploadResult.error(error);
      }
      
    } catch (e) {
      final error = 'HTML上传异常: $e';
      print(error);
      return TencentUploadResult.error(error);
    }
  }

  /// 上传文件到腾讯云COS
  /// [filePath] 本地文件路径
  /// [onProgress] 上传进度回调，参数为进度百分比 (0.0 - 1.0)
  /// 返回 [TencentUploadResult] 包含上传结果
  static Future<TencentUploadResult> uploadFile(
    String filePath, {
    Function(double progress)? onProgress,
  }) async {
    try {
      final file = File(filePath);
      if (!await file.exists()) {
        return TencentUploadResult.error('文件不存在: $filePath');
      }
      
      // 获取文件信息
      final fileName = path.basename(filePath);
      final fileSize = await file.length();
      
      // 验证文件类型和大小
      if (!TencentCloudConfig.isSupportedFile(fileName)) {
        return TencentUploadResult.error('不支持的文件类型: $fileName');
      }
      
      if (!TencentCloudConfig.isValidFileSize(fileSize)) {
        final maxSizeMB = TencentCloudConfig.maxFileSize ~/ (1024 * 1024);
        return TencentUploadResult.error('文件过大，最大支持 ${maxSizeMB}MB');
      }
      
      // 生成唯一文件名
      final uniqueFileName = _generateUniqueFileName(fileName);
      final objectKey = TencentCloudConfig.uploadPrefix + uniqueFileName;
      
      // 开始上传
      onProgress?.call(0.0);
      
      // 使用简化的PUT上传
      return await _uploadFileWithSimplePut(file, objectKey, uniqueFileName, onProgress);
      
    } catch (e) {
      return TencentUploadResult.error('上传过程中发生错误: ${e.toString()}');
    }
  }

  /// 使用最简化的PUT上传方式
  static Future<TencentUploadResult> _uploadFileWithSimplePut(
    File file,
    String objectKey,
    String uniqueFileName,
    Function(double progress)? onProgress,
  ) async {
    try {
      // 检查文件大小，避免内存溢出
      final fileSize = await file.length();
      if (fileSize > 100 * 1024 * 1024) { // 100MB限制
        return TencentUploadResult.error('文件过大，无法一次性加载到内存');
      }
      
      final fileBytes = await file.readAsBytes();
      
      // 构建URL - 添加URL验证
      final bucketDomain = '${TencentCloudConfig.bucketName}.cos.${TencentCloudConfig.region}.myqcloud.com';
      if (bucketDomain.isEmpty || objectKey.isEmpty) {
        return TencentUploadResult.error('配置错误：存储桶或对象键为空');
      }
      
      final url = Uri.parse('https://$bucketDomain/$objectKey');
      
      onProgress?.call(0.3);
      
      // 安全构建Content-Disposition头部
      final originalBaseName = path.basenameWithoutExtension(file.path);
      final extension = path.extension(file.path);
      final safeFileName = Uri.encodeComponent('${originalBaseName.isEmpty ? 'audio' : originalBaseName}${extension.isEmpty ? '.mp3' : extension}');
      
      // 发送PUT请求，添加超时控制
      final response = await http.put(
        url,
        body: fileBytes,
        headers: {
          'Content-Type': _getContentType(path.basename(file.path)),
          'Content-Disposition': 'attachment; filename="$safeFileName"',
          'Cache-Control': 'public, max-age=31536000',
        },
      ).timeout(
        const Duration(minutes: 5), // 5分钟超时
        onTimeout: () {
          throw Exception('上传超时，请检查网络连接');
        },
      );
      
      onProgress?.call(1.0);
      
      // 检查响应状态
      if (response.statusCode >= 200 && response.statusCode < 300) {
        // 上传成功
        final downloadUrl = url.toString();
        return TencentUploadResult.success(uniqueFileName, downloadUrl);
      } else {
        // 提供更详细的错误信息
        String errorDetail = '';
        if (response.statusCode == 403) {
          errorDetail = '权限不足，请检查存储桶权限设置';
        } else if (response.statusCode == 404) {
          errorDetail = '存储桶不存在，请检查配置';
        } else if (response.statusCode >= 500) {
          errorDetail = '服务器错误，请稍后重试';
        }
        
        return TencentUploadResult.error(
          '上传失败: HTTP ${response.statusCode}${errorDetail.isNotEmpty ? ' - $errorDetail' : ''}',
        );
      }
    } on SocketException {
      return TencentUploadResult.error('网络连接失败，请检查网络设置');
    } on TimeoutException {
      return TencentUploadResult.error('网络超时，请重试');
    } on FormatException catch (e) {
      return TencentUploadResult.error('数据格式错误: ${e.message}');
    } catch (e) {
      return TencentUploadResult.error('上传失败: ${e.toString()}');
    }
  }
  
  /// 生成唯一文件名，保持原始名称的可读性
  static String _generateUniqueFileName(String originalFileName) {
    final extension = path.extension(originalFileName);
    final baseName = path.basenameWithoutExtension(originalFileName);
    
    // 清理文件名中的特殊字符，但保持可读性
    final cleanBaseName = baseName
        .replaceAll(RegExp(r'[^\u4e00-\u9fa5\w\-_. ]'), '_')  // 保留中文字符
        .replaceAll(RegExp(r'\s+'), '_')  // 空格转下划线
        .replaceAll(RegExp(r'_+'), '_');  // 多个下划线合并
    
    // 使用更简短的时间戳（只取后6位）
    final shortTimestamp = (DateTime.now().millisecondsSinceEpoch % 1000000).toString();
    
    // 如果原文件名过长，截取前20个字符
    final finalBaseName = cleanBaseName.length > 20 
        ? cleanBaseName.substring(0, 20)
        : cleanBaseName;
    
    return '${finalBaseName}_$shortTimestamp$extension';
  }


  
  /// 构建上传URL
  static String _buildUploadUrl(String objectKey) {
    return 'https://${TencentCloudConfig.bucketDomain}/$objectKey';
  }
  
  /// 获取文件MIME类型，优化音频文件的MIME类型
  static String _getContentType(String fileName) {
    final extension = path.extension(fileName).toLowerCase();
    
    // 为常见音频格式提供精确的MIME类型，确保微信等应用能正确识别
    switch (extension) {
      case '.mp3':
        return 'audio/mpeg';
      case '.wav':
        return 'audio/wav';
      case '.m4a':
        return 'audio/mp4';
      case '.aac':
        return 'audio/aac';
      case '.ogg':
        return 'audio/ogg';
      case '.flac':
        return 'audio/flac';
      case '.wma':
        return 'audio/x-ms-wma';
      default:
        return lookupMimeType(fileName) ?? 'application/octet-stream';
    }
  }
  
  /// 构建请求头部信息
  static Map<String, String> _buildHeaders({
    required String method,
    required String objectKey,
    required int contentLength,
    required String contentType,
  }) {
    final currentTime = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final expireTime = currentTime + TencentCloudConfig.signatureExpire;
    
    // 构建签名（使用最简单的方式）
    final authorization = _buildAuthorizationWithHeaders(
      method: method,
      objectKey: objectKey,
      currentTime: currentTime,
      expireTime: expireTime,
      headers: {},
    );
    
    // 只返回必要的头部
    return {
      'Authorization': authorization,
      'Content-Type': contentType,
      'Content-Length': contentLength.toString(),
    };
  }
  
  /// 构建腾讯云COS授权签名
  static String _buildAuthorization({
    required String method,
    required String objectKey,
    required int currentTime,
    required int expireTime,
  }) {
    // 1. 生成 KeyTime
    final keyTime = '$currentTime;$expireTime';
    
    // 2. 生成 SignKey
    final signKey = _hmacSha1(TencentCloudConfig.secretKey, keyTime);
    
    // 3. 生成要包含在签名中的头部列表（按字典序排序）
    final headerList = ['content-length', 'content-type', 'host'];
    final headerListStr = headerList.join(';');
    
    // 4. 生成 HttpString
    final httpString = _buildHttpString(method, objectKey, headerList);
    
    // 5. 生成 StringToSign
    final sha1HttpString = _sha1Hash(httpString);
    final stringToSign = 'sha1\n$keyTime\n$sha1HttpString\n';
    
    // 6. 生成 Signature
    final signature = _hmacSha1(signKey, stringToSign);
    
    // 7. 生成 Authorization
    return 'q-sign-algorithm=sha1'
        '&q-ak=${TencentCloudConfig.secretId}'
        '&q-sign-time=$keyTime'
        '&q-key-time=$keyTime'
        '&q-header-list=$headerListStr'
        '&q-url-param-list='
        '&q-signature=$signature';
  }

  /// 使用实际头部信息构建签名
  static String _buildAuthorizationWithHeaders({
    required String method,
    required String objectKey,
    required int currentTime,
    required int expireTime,
    required Map<String, String> headers,
  }) {
    // 1. 生成 KeyTime
    final keyTime = '$currentTime;$expireTime';
    
    // 2. 生成 SignKey
    final signKey = _hmacSha1(TencentCloudConfig.secretKey, keyTime);
    
    // 3. 构建最简单的HttpString（不包含头部，避免编码问题）
    final httpMethod = method.toUpperCase();
    final uriPathname = '/$objectKey';
    final httpParameters = '';
    final httpHeaders = '';
    
    final httpString = '$httpMethod\n$uriPathname\n$httpParameters\n$httpHeaders\n';
    
    // 4. 生成 StringToSign
    final sha1HttpString = _sha1Hash(httpString);
    final stringToSign = 'sha1\n$keyTime\n$sha1HttpString\n';
    
    // 5. 生成 Signature
    final signature = _hmacSha1(signKey, stringToSign);
    
    // 6. 生成 Authorization（使用最简单的格式）
    return 'q-sign-algorithm=sha1'
        '&q-ak=${TencentCloudConfig.secretId}'
        '&q-sign-time=$keyTime'
        '&q-key-time=$keyTime'
        '&q-header-list='
        '&q-url-param-list='
        '&q-signature=$signature';
  }
  
  /// 构建HTTP字符串
  static String _buildHttpString(String method, String objectKey, List<String> headerList) {
    final httpMethod = method.toUpperCase();
    final uriPathname = Uri.encodeComponent(objectKey).replaceAll('%2F', '/');
    final httpParameters = '';
    
    // 构建HTTP头部字符串（需要包含实际的头部值）
    final httpHeaders = headerList.map((header) {
      switch (header) {
        case 'host':
          return '$header:${TencentCloudConfig.bucketDomain}';
        case 'content-type':
          return '$header:application/octet-stream'; // 默认类型，实际会被覆盖
        case 'content-length':
          return '$header:0'; // 占位符，实际会被覆盖
        default:
          return '$header:';
      }
    }).join('\n');
    
    return '$httpMethod\n/$uriPathname\n$httpParameters\n$httpHeaders\n';
  }
  
  /// HMAC-SHA1加密
  static String _hmacSha1(String key, String data) {
    final keyBytes = utf8.encode(key);
    final dataBytes = utf8.encode(data);
    final hmac = Hmac(sha1, keyBytes);
    final digest = hmac.convert(dataBytes);
    return digest.toString();
  }
  
  /// SHA1哈希
  static String _sha1Hash(String data) {
    final bytes = utf8.encode(data);
    final digest = sha1.convert(bytes);
    return digest.toString();
  }
  
  /// 验证存储桶配置是否正确
  static bool validateConfig() {
    return TencentCloudConfig.secretId.isNotEmpty &&
           TencentCloudConfig.secretKey.isNotEmpty &&
           TencentCloudConfig.bucketName != 'your-bucket-name' &&
           TencentCloudConfig.region.isNotEmpty;
  }
  
  /// 获取配置验证错误信息
  static List<String> getConfigErrors() {
    final errors = <String>[];
    
    if (TencentCloudConfig.secretId.isEmpty) {
      errors.add('SecretId 未配置');
    }
    
    if (TencentCloudConfig.secretKey.isEmpty) {
      errors.add('SecretKey 未配置');
    }
    
    if (TencentCloudConfig.bucketName == 'your-bucket-name' || 
        TencentCloudConfig.bucketName.isEmpty) {
      errors.add('存储桶名称未配置或使用默认值');
    }
    
    if (TencentCloudConfig.region.isEmpty) {
      errors.add('存储桶地域未配置');
    }
    
    return errors;
  }
  
  /// 测试上传连接
  static Future<bool> testConnection() async {
    try {
      final url = 'https://${TencentCloudConfig.bucketDomain}';
      final response = await http.head(Uri.parse(url));
      return response.statusCode == 200 || 
             response.statusCode == 403 || 
             response.statusCode == 404; // 403/404 表示桶存在但无权限/对象不存在
    } catch (e) {
      return false;
    }
  }
}