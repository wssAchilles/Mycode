import 'dart:convert';

/// 腾讯云配置（简化版 - 直接播放音频）
class TencentCloudConfig {
  // 基础配置
  static const String secretId = 'AKIDswuaLt8i6lv9vCWqDnH6dBc4l8vGT5oy';
  static const String secretKey = 'mI4Gk3qkzTjVw7s2xc4iEuQ7LqTf4B7jXnL9H6kK';
  static const String region = 'ap-nanjing';
  static const String bucketName = 'my-audio-files-123-1380453532';
  static const String? customDomain = null;
  
  // 上传配置
  static const String uploadPrefix = 'audio-files/';
  static const int maxFileSize = 100 * 1024 * 1024; // 100MB
  
  // 额外配置（兼容性）
  static const String acl = 'public-read';
  static const int signatureExpire = 3600; // 签名过期时间（秒）
  static const String wechatServerUrl = 'https://my-audio-files-123-1380453532.cos-website.ap-nanjing.myqcloud.com';
  
  /// 获取存储桶的完整域名
  static String get bucketDomain {
    return '$bucketName.cos.$region.myqcloud.com';
  }
  
  /// 获取文件访问URL的基础地址（使用常规COS域名，确保文件可直接访问）
  static String get baseUrl {
    if (customDomain != null) {
      return customDomain!;
    }
    return 'https://$bucketDomain';
  }
  
  /// 生成完整的文件访问URL
  static String buildFileUrl(String fileName) {
    return '$baseUrl/$uploadPrefix$fileName';
  }
  
  /// 生成浏览器播放URL（直接返回音频文件URL - 最简单方案）
  static Future<String> buildBrowserPlayUrl(String fileName, String audioUrl) async {
    try {
      print('生成浏览器播放URL: $fileName');
      print('直接返回音频文件URL: $audioUrl');
      
      // 直接返回音频文件的URL，浏览器会自动播放
      return audioUrl;
      
    } catch (e) {
      print('生成播放URL异常: $e');
      // 降级方案：仍然返回音频URL
      return audioUrl;
    }
  }
  
  /// 兼容旧方法名
  static Future<String> buildWechatPlayUrl(String fileName, String audioUrl) async {
    return await buildBrowserPlayUrl(fileName, audioUrl);
  }
  
  /// 验证配置是否完整
  static bool validateConfig() {
    return secretId.isNotEmpty && 
           secretKey.isNotEmpty && 
           region.isNotEmpty && 
           bucketName.isNotEmpty;
  }
  
  /// 获取配置错误信息  
  static List<String> getConfigErrors() {
    List<String> errors = [];
    if (secretId.isEmpty) errors.add('SecretId未配置');
    if (secretKey.isEmpty) errors.add('SecretKey未配置');
    if (region.isEmpty) errors.add('地域未配置');
    if (bucketName.isEmpty) errors.add('存储桶名称未配置');
    return errors;
  }
  
  /// 检查文件类型是否支持
  static bool isSupportedFile(String fileName) {
    final ext = fileName.toLowerCase().split('.').last;
    return ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'].contains(ext);
  }
  
  /// 检查文件大小是否有效
  static bool isValidFileSize(int fileSize) {
    return fileSize > 0 && fileSize <= maxFileSize;
  }
  
  /// 生成播放器HTML（兼容方法，现在返回空字符串）
  static String generatePlayerHTML(String fileName, String audioUrl) {
    // 简化方案不再生成HTML，直接返回空字符串
    return '';
  }
}
