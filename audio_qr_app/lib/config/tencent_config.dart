/// 腾讯云配置
class TencentConfig {
  // 腾讯云COS配置
  static const String secretId = 'AKID9HF0nU0LTPNCqGoJRSG3mOrBJrFRQCk3';
  static const String secretKey = '94nMjtqNmzzsY0EE0YszsY0EE1d2DAuQ';
  
  // COS存储桶配置
  static const String bucket = 'my-audio-files-123-1380453532'; // 请替换为您的存储桶名称
  static const String region = 'ap-nanjing'; // 请替换为您的存储桶所在地域
  
  // 可选：自定义域名
  static const String? customDomain = null; // 如果有自定义域名，请在此配置
  
  // 上传文件的路径前缀
  static const String uploadPrefix = 'audio-qr/';
  
  // 文件访问权限
  static const String acl = 'public-read'; // 公共读取权限，用于生成二维码
}