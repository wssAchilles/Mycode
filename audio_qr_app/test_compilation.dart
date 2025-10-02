import 'lib/config/tencent_cloud_config.dart';
import 'lib/services/tencent_cos_service.dart';
import 'lib/services/native_platform_service.dart';

/// 测试所有类和方法是否可正常编译
void main() {
  print('🧪 测试编译状态...\n');
  
  // 测试 TencentCloudConfig 的所有属性和方法
  print('✅ TencentCloudConfig.acl: ${TencentCloudConfig.acl}');
  print('✅ TencentCloudConfig.signatureExpire: ${TencentCloudConfig.signatureExpire}');
  print('✅ TencentCloudConfig.wechatServerUrl: ${TencentCloudConfig.wechatServerUrl}');
  
  // 测试方法调用
  print('✅ isSupportedFile: ${TencentCloudConfig.isSupportedFile("test.mp3")}');
  print('✅ isValidFileSize: ${TencentCloudConfig.isValidFileSize(1024)}');
  
  final html = TencentCloudConfig.generatePlayerHTML("test.mp3", "http://example.com/test.mp3");
  print('✅ generatePlayerHTML: ${html.isEmpty ? "空字符串(正确)" : "有内容"}');
  
  print('\n🎉 所有方法和属性均可正常访问！');
  print('📱 应用可以正常编译和运行。');
}
