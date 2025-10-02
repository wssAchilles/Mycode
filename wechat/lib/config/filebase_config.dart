import 'package:flutter/foundation.dart';

/// Filebase 配置类
/// 存储与 Filebase 服务交互所需的配置参数
class FilebaseConfig {
  /// Filebase S3 API 端点
  static const String endpoint = 'https://s3.filebase.com';

  /// Filebase 区域设置 (与标准 S3 兼容)
  static const String region = 'us-east-1';

  /// Filebase Access Key ID
  /// 注意：在实际应用中，请避免直接硬编码这些凭证
  static const String accessKeyId = '2FAD9C6C9BC02C442F23';

  /// Filebase Secret Access Key
  /// 重要安全提示: 这是高度敏感的凭证信息
  /// 在生产环境中，绝不应该将其硬编码在应用中，尤其是前端代码
  /// 应考虑使用以下安全管理方式：
  /// 1. 环境变量
  /// 2. 安全的后端服务代理请求
  /// 3. 密钥管理系统
  /// 4. 临时凭证服务
  static const String secretAccessKey = 'sWfMIH5tMnwhOgJDB9bm9Xqs4ht0KO6cM8RjHqtR';

  /// Filebase 存储桶名称 (均在 IPFS 网络上)
  /// 用户数据存储桶 - 存储用户个人资料和信息
  static const String userDataBucket = 'userdata';

  /// 聊天消息存储桶 - 存储聊天消息记录
  static const String chatMessagesBucket = 'chatmssages';

  /// 媒体文件存储桶 - 存储聊天中发送的图片、视频等多媒体文件
  static const String mediaFilesBucket = 'mediafiles';

  /// 获取 IPFS 网关 URL
  /// 将 IPFS CID 转换为可访问的 URL
  static String getIpfsGatewayUrl(String cid) {
    return 'https://ipfs.filebase.io/ipfs/$cid';
  }

  /// 判断是否为调试模式
  /// 在调试模式下可以提供更多日志信息
  static bool get isDebugMode {
    return kDebugMode;
  }
}
