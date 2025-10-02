import 'lib/config/tencent_cloud_config.dart';

/// 简单测试配置文件
void main() {
  print('🧪 测试配置文件...\n');
  
  // 测试基本属性
  print('✅ bucketName: ${TencentCloudConfig.bucketName}');
  print('✅ region: ${TencentCloudConfig.region}');
  print('✅ acl: ${TencentCloudConfig.acl}');
  print('✅ signatureExpire: ${TencentCloudConfig.signatureExpire}');
  print('✅ wechatServerUrl: ${TencentCloudConfig.wechatServerUrl}');
  
  // 测试方法
  print('✅ isSupportedFile("test.mp3"): ${TencentCloudConfig.isSupportedFile("test.mp3")}');
  print('✅ isValidFileSize(1024): ${TencentCloudConfig.isValidFileSize(1024)}');
  
  // 测试异步方法
  TencentCloudConfig.buildBrowserPlayUrl("test.wav", "https://example.com/test.wav").then((url) {
    print('✅ buildBrowserPlayUrl: $url');
    print('\n🎉 配置文件测试完成！所有方法都可以正常调用。');
  });
}
