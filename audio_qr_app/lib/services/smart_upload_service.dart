import 'dart:io';
import '../services/tencent_cos_service.dart';
import '../services/native_platform_service.dart';


/// 上传方式枚举
enum UploadMethod {
  flutter,     // 纯Flutter实现
  nativeSDK,   // 原生SDK实现
  auto,        // 自动选择
}

/// 智能上传服务
/// 可以根据平台和SDK可用性自动选择最佳上传方式
class SmartUploadService {
  /// 上传文件（智能选择方式）
  /// [filePath] 本地文件路径
  /// [method] 指定上传方式，默认为自动选择
  /// [onProgress] 进度回调
  /// 返回上传后的文件URL
  static Future<String> uploadFile(
    String filePath, {
    UploadMethod method = UploadMethod.auto,
    Function(double progress)? onProgress,
  }) async {
    final actualMethod = await _determineUploadMethod(method);
    
    switch (actualMethod) {
      case UploadMethod.nativeSDK:
        return await _uploadWithNativeSDK(filePath, onProgress: onProgress);
      case UploadMethod.flutter:
      default:
        return await _uploadWithFlutter(filePath, onProgress: onProgress);
    }
  }

  /// 确定实际使用的上传方式
  static Future<UploadMethod> _determineUploadMethod(UploadMethod requested) async {
    if (requested == UploadMethod.flutter) {
      return UploadMethod.flutter;
    }
    
    if (requested == UploadMethod.nativeSDK) {
      // 检查原生SDK是否可用
      final isAvailable = await NativePlatformService.isNativeSDKAvailable();
      if (!isAvailable) {
        throw Exception('原生SDK不可用，请检查Android平台配置');
      }
      return UploadMethod.nativeSDK;
    }
    
    // 自动选择：优先使用原生SDK（Android平台），否则使用Flutter实现
    if (Platform.isAndroid) {
      final isAvailable = await NativePlatformService.isNativeSDKAvailable();
      if (isAvailable) {
        return UploadMethod.nativeSDK;
      }
    }
    
    return UploadMethod.flutter;
  }

  /// 使用原生SDK上传
  static Future<String> _uploadWithNativeSDK(
    String filePath, {
    Function(double progress)? onProgress,
  }) async {
    try {
      final url = await NativePlatformService.uploadFileWithNativeSDK(
        filePath,
        onProgress: onProgress,
      );
      return url;
    } catch (e) {
      // 原生SDK失败时，回退到Flutter实现
      print('原生SDK上传失败，回退到Flutter实现: $e');
      return await _uploadWithFlutter(filePath, onProgress: onProgress);
    }
  }

  /// 使用Flutter实现上传
  static Future<String> _uploadWithFlutter(
    String filePath, {
    Function(double progress)? onProgress,
  }) async {
    final result = await TencentCOSService.uploadFile(
      filePath,
      onProgress: onProgress,
    );
    
    if (result.success && result.url?.isNotEmpty == true) {
      return result.url!;
    } else {
      throw Exception(result.error ?? '上传失败');
    }
  }

  /// 获取当前推荐的上传方式
  static Future<UploadMethod> getRecommendedMethod() async {
    return await _determineUploadMethod(UploadMethod.auto);
  }

  /// 获取所有可用的上传方式
  static Future<List<UploadMethod>> getAvailableMethods() async {
    final methods = <UploadMethod>[UploadMethod.flutter];
    
    if (Platform.isAndroid) {
      final isNativeAvailable = await NativePlatformService.isNativeSDKAvailable();
      if (isNativeAvailable) {
        methods.add(UploadMethod.nativeSDK);
      }
    }
    
    return methods;
  }

  /// 获取上传方式的描述
  static String getMethodDescription(UploadMethod method) {
    switch (method) {
      case UploadMethod.flutter:
        return 'Flutter HTTP上传（跨平台）';
      case UploadMethod.nativeSDK:
        return 'Android原生SDK上传（高性能）';
      case UploadMethod.auto:
        return '智能选择（推荐）';
    }
  }

  /// 测试上传方式的可用性
  static Future<Map<UploadMethod, bool>> testAllMethods() async {
    final results = <UploadMethod, bool>{};
    
    // 测试Flutter实现
    results[UploadMethod.flutter] = TencentCOSService.validateConfig();
    
    // 测试原生SDK实现
    if (Platform.isAndroid) {
      try {
        final isAvailable = await NativePlatformService.isNativeSDKAvailable();
        if (isAvailable) {
          final testResults = await NativePlatformService.testNativeSDKConnection();
          results[UploadMethod.nativeSDK] = testResults['cos'] ?? false;
        } else {
          results[UploadMethod.nativeSDK] = false;
        }
      } catch (e) {
        results[UploadMethod.nativeSDK] = false;
      }
    } else {
      results[UploadMethod.nativeSDK] = false;
    }
    
    return results;
  }
}