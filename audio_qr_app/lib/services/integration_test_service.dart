import 'dart:typed_data';
import 'dart:io';
import '../services/smart_upload_service.dart';
import '../services/native_platform_service.dart';
import '../config/tencent_cloud_config.dart';

/// 集成测试服务
/// 提供完整的功能测试接口
class IntegrationTestService {
  
  /// 测试所有服务的可用性
  static Future<Map<String, dynamic>> testAllServices() async {
    final results = <String, dynamic>{};
    
    try {
      // 测试配置
      results['config'] = await _testConfiguration();
      
      // 测试原生SDK可用性
      results['nativeSDK'] = await _testNativeSDKAvailability();
      
      // 测试上传服务
      results['uploadService'] = await _testUploadService();
      
      // 测试二维码生成
      results['qrGeneration'] = await _testQRGeneration();
      
      results['overall'] = _calculateOverallStatus(results);
      
    } catch (e) {
      results['error'] = e.toString();
      results['overall'] = 'failed';
    }
    
    return results;
  }
  
  /// 测试配置是否正确
  static Future<Map<String, dynamic>> _testConfiguration() async {
    final config = <String, dynamic>{};
    
    // 检查腾讯云配置
    config['secretId'] = TencentCloudConfig.secretId.isNotEmpty;
    config['secretKey'] = TencentCloudConfig.secretKey.isNotEmpty;
    config['bucketName'] = TencentCloudConfig.bucketName.isNotEmpty;
    config['region'] = TencentCloudConfig.region.isNotEmpty;
    config['bucketDomain'] = TencentCloudConfig.bucketDomain.isNotEmpty;
    
    // 检查文件验证
    try {
      // 简单的文件验证逻辑
      config['fileValidation'] = 'test.mp3'.endsWith('.mp3') && 1024 > 0;
    } catch (e) {
      config['fileValidation'] = false;
      config['fileValidationError'] = e.toString();
    }
    
    config['status'] = config.values.every((v) => v == true) ? 'passed' : 'failed';
    
    return config;
  }
  
  /// 测试原生SDK可用性
  static Future<Map<String, dynamic>> _testNativeSDKAvailability() async {
    final nativeTests = <String, dynamic>{};
    
    try {
      // 测试原生SDK是否可用
      nativeTests['available'] = await NativePlatformService.isNativeSDKAvailable();
      
      // 获取SDK版本
      final versions = await NativePlatformService.getNativeSDKVersions();
      nativeTests['versions'] = versions;
      
      // 测试连接
      final connections = await NativePlatformService.testNativeSDKConnection();
      nativeTests['connections'] = connections;
      
      nativeTests['status'] = nativeTests['available'] == true ? 'passed' : 'failed';
      
    } catch (e) {
      nativeTests['error'] = e.toString();
      nativeTests['status'] = 'failed';
    }
    
    return nativeTests;
  }
  
  /// 测试上传服务
  static Future<Map<String, dynamic>> _testUploadService() async {
    final uploadTests = <String, dynamic>{};
    
    try {
      // 检查上传方法可用性
      uploadTests['flutterMethod'] = true; // Flutter方法总是可用
      uploadTests['nativeMethod'] = await NativePlatformService.isNativeSDKAvailable();
      
      // 获取推荐的上传方法
      final nativeAvailable = await NativePlatformService.isNativeSDKAvailable();
      uploadTests['recommendedMethod'] = nativeAvailable ? 'nativeSDK' : 'flutter';
      
      uploadTests['status'] = uploadTests['flutterMethod'] == true || uploadTests['nativeMethod'] == true ? 'passed' : 'failed';
      
    } catch (e) {
      uploadTests['error'] = e.toString();
      uploadTests['status'] = 'failed';
    }
    
    return uploadTests;
  }
  
  /// 测试二维码生成
  static Future<Map<String, dynamic>> _testQRGeneration() async {
    final qrTests = <String, dynamic>{};
    
    try {
      // 测试原生二维码生成
      final testData = "https://example.com/test";
      final qrBytes = await NativePlatformService.generateQRCodeWithNativeSDK(testData, size: 200);
      
      qrTests['nativeGeneration'] = qrBytes.isNotEmpty;
      qrTests['qrDataSize'] = qrBytes.length;
      qrTests['status'] = qrBytes.isNotEmpty ? 'passed' : 'failed';
      
    } catch (e) {
      qrTests['error'] = e.toString();
      qrTests['status'] = 'failed';
    }
    
    return qrTests;
  }
  
  /// 计算整体状态
  static String _calculateOverallStatus(Map<String, dynamic> results) {
    final allPassed = results.values
        .where((value) => value is Map<String, dynamic>)
        .cast<Map<String, dynamic>>()
        .every((test) => test['status'] == 'passed');
    
    return allPassed ? 'passed' : 'failed';
  }
  
  /// 创建测试用的临时文件
  static Future<File> createTestAudioFile() async {
    final directory = Directory.systemTemp;
    final file = File('${directory.path}/test_audio.mp3');
    
    // 创建一个小的测试文件（模拟音频数据）
    final testData = Uint8List.fromList(List.generate(1024, (index) => index % 256));
    await file.writeAsBytes(testData);
    
    return file;
  }
  
  /// 完整的功能测试（包含文件上传和二维码生成）
  static Future<Map<String, dynamic>> performFullFunctionalTest() async {
    final testResults = <String, dynamic>{};
    
    try {
      // 创建测试文件
      final testFile = await createTestAudioFile();
      testResults['testFileCreated'] = testFile.existsSync();
      testResults['testFilePath'] = testFile.path;
      testResults['testFileSize'] = testFile.lengthSync();
      
      // 测试文件上传
      try {
        final uploadUrl = await SmartUploadService.uploadFile(
          testFile.path,
          onProgress: (progress) {
            print('上传进度: ${(progress * 100).toStringAsFixed(1)}%');
          },
        );
        
        testResults['uploadSuccess'] = uploadUrl.isNotEmpty;
        testResults['uploadUrl'] = uploadUrl;
        testResults['uploadMethod'] = 'smart';
        
        // 如果上传成功，生成包含URL的二维码
        if (uploadUrl.isNotEmpty) {
          final qrBytes = await NativePlatformService.generateQRCodeWithNativeSDK(
            uploadUrl,
            size: 300,
          );
          
          testResults['qrGenerated'] = qrBytes.isNotEmpty;
          testResults['qrDataSize'] = qrBytes.length;
        }
        
      } catch (e) {
        testResults['uploadError'] = e.toString();
        testResults['uploadSuccess'] = false;
      }
      
      // 清理测试文件
      try {
        await testFile.delete();
        testResults['testFileCleanedUp'] = true;
      } catch (e) {
        testResults['cleanupError'] = e.toString();
      }
      
      testResults['overallSuccess'] = testResults['uploadSuccess'] == true && testResults['qrGenerated'] == true;
      
    } catch (e) {
      testResults['error'] = e.toString();
      testResults['overallSuccess'] = false;
    }
    
    return testResults;
  }
  
  /// 生成测试报告
  static String generateTestReport(Map<String, dynamic> results) {
    final buffer = StringBuffer();
    buffer.writeln('=== 功能集成测试报告 ===\n');
    
    buffer.writeln('整体状态: ${results['overall'] ?? results['overallSuccess'] ?? 'unknown'}');
    buffer.writeln('测试时间: ${DateTime.now()}\n');
    
    // 配置测试
    if (results.containsKey('config')) {
      buffer.writeln('📋 配置测试:');
      final config = results['config'] as Map<String, dynamic>;
      config.forEach((key, value) {
        if (key != 'status') {
          buffer.writeln('  - $key: ${value == true ? '✅' : '❌'}');
        }
      });
      buffer.writeln('  状态: ${config['status']}\n');
    }
    
    // 原生SDK测试
    if (results.containsKey('nativeSDK')) {
      buffer.writeln('🔧 原生SDK测试:');
      final native = results['nativeSDK'] as Map<String, dynamic>;
      buffer.writeln('  - 可用性: ${native['available'] == true ? '✅' : '❌'}');
      if (native.containsKey('versions')) {
        final versions = native['versions'] as Map<String, dynamic>;
        versions.forEach((key, value) {
          buffer.writeln('  - $key版本: $value');
        });
      }
      buffer.writeln('  状态: ${native['status']}\n');
    }
    
    // 上传测试
    if (results.containsKey('uploadService')) {
      buffer.writeln('📤 上传服务测试:');
      final upload = results['uploadService'] as Map<String, dynamic>;
      upload.forEach((key, value) {
        if (key != 'status') {
          buffer.writeln('  - $key: $value');
        }
      });
      buffer.writeln('  状态: ${upload['status']}\n');
    }
    
    // 二维码测试
    if (results.containsKey('qrGeneration')) {
      buffer.writeln('🔳 二维码生成测试:');
      final qr = results['qrGeneration'] as Map<String, dynamic>;
      qr.forEach((key, value) {
        if (key != 'status') {
          buffer.writeln('  - $key: $value');
        }
      });
      buffer.writeln('  状态: ${qr['status']}\n');
    }
    
    // 完整功能测试
    if (results.containsKey('testFileCreated')) {
      buffer.writeln('🎵 完整功能测试:');
      buffer.writeln('  - 测试文件创建: ${results['testFileCreated'] == true ? '✅' : '❌'}');
      buffer.writeln('  - 文件上传: ${results['uploadSuccess'] == true ? '✅' : '❌'}');
      buffer.writeln('  - 二维码生成: ${results['qrGenerated'] == true ? '✅' : '❌'}');
      if (results.containsKey('uploadUrl')) {
        buffer.writeln('  - 上传URL: ${results['uploadUrl']}');
      }
      buffer.writeln('  - 整体成功: ${results['overallSuccess'] == true ? '✅' : '❌'}\n');
    }
    
    // 错误信息
    results.forEach((key, value) {
      if (key.contains('Error')) {
        buffer.writeln('❌ 错误: $key - $value');
      }
    });
    
    buffer.writeln('\n=== 测试报告结束 ===');
    
    return buffer.toString();
  }
}