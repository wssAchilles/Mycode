import 'package:flutter/services.dart';
import '../config/tencent_cloud_config.dart';
import 'debug_service.dart';

/// 原生平台服务管理器
/// 提供与Android/iOS原生SDK交互的接口
class NativePlatformService {
  static const MethodChannel _cosChannel = 
      MethodChannel('com.audioqr.app/tencent_cos');
  
  static const MethodChannel _qrChannel = 
      MethodChannel('com.audioqr.app/qr_generator');

  /// 检查原生SDK是否可用
  static Future<bool> isNativeSDKAvailable() async {
    final result = await DebugService.logPlatformChannelCall(
      'tencent_cos',
      'isAvailable',
      () async {
        try {
          final result = await _cosChannel.invokeMethod<bool>('isAvailable') ?? false;
          DebugService.nativeSDK('COS SDK 可用性检查: $result');
          return result;
        } catch (e) {
          DebugService.nativeSDK('COS SDK 可用性检查失败', error: e, level: LogLevel.error);
          return false;
        }
      },
    );
    return result ?? false;
  }

  /// 使用原生腾讯云COS SDK上传文件
  /// [filePath] 本地文件路径
  /// [onProgress] 进度回调 (0.0 - 1.0)
  /// 返回上传后的文件URL
  static Future<String> uploadFileWithNativeSDK(
    String filePath, {
    Function(double progress)? onProgress,
  }) async {
    DebugService.upload('开始使用原生SDK上传文件: $filePath');
    
    return DebugService.timeMethod('NativeSDK上传', () async {
      try {
        // 设置进度监听
        if (onProgress != null) {
          _cosChannel.setMethodCallHandler((call) async {
            if (call.method == 'onProgress') {
              final progress = (call.arguments as num).toDouble();
              DebugService.upload('上传进度: ${(progress * 100).toStringAsFixed(1)}%');
              onProgress(progress);
            }
            return null;
          });
        }

        final arguments = {
          'filePath': filePath,
          'secretId': TencentCloudConfig.secretId,
          'secretKey': TencentCloudConfig.secretKey,
          'bucketName': TencentCloudConfig.bucketName,
          'region': TencentCloudConfig.region,
          'uploadPrefix': TencentCloudConfig.uploadPrefix,
          'acl': TencentCloudConfig.acl,
        };

        final result = await DebugService.logPlatformChannelCall(
          'tencent_cos',
          'uploadFile',
          () => _cosChannel.invokeMethod<String>('uploadFile', arguments),
          arguments: arguments,
        );

        if (result == null || result.isEmpty) {
          throw Exception('上传失败：未返回文件URL');
        }

        DebugService.upload('文件上传成功: $result', level: LogLevel.info);
        return result;
        
      } on PlatformException catch (e) {
        DebugService.upload('原生SDK上传失败: ${e.message}', error: e, level: LogLevel.error);
        throw Exception('原生SDK上传失败: ${e.message}');
      } catch (e) {
        DebugService.upload('上传过程发生错误', error: e, level: LogLevel.error);
        throw Exception('上传过程发生错误: $e');
      }
    });
  }

  /// 使用原生ZXing生成二维码
  /// [data] 要编码的数据
  /// [size] 二维码尺寸
  /// 返回二维码图片的字节数组
  static Future<List<int>> generateQRCodeWithNativeSDK(
    String data, {
    int size = 500,
  }) async {
    DebugService.qrCode('开始生成二维码: $data (尺寸: ${size}x$size)');
    
    return DebugService.timeMethod('ZXing二维码生成', () async {
      try {
        final arguments = {
          'data': data,
          'size': size,
        };

        final result = await DebugService.logPlatformChannelCall(
          'qr_generator',
          'generateQRCode',
          () => _qrChannel.invokeMethod('generateQRCode', arguments),
          arguments: arguments,
        );

        if (result == null) {
          throw Exception('生成二维码失败：未返回图片数据');
        }

        // 处理不同的数据类型返回
        List<int> qrBytes;
        if (result is List<dynamic>) {
          qrBytes = result.cast<int>();
        } else if (result is List<int>) {
          qrBytes = result;
        } else {
          throw Exception('返回数据格式错误: ${result.runtimeType}');
        }

        DebugService.qrCode('二维码生成成功，数据大小: ${qrBytes.length} 字节', level: LogLevel.info);
        return qrBytes;
        
      } on PlatformException catch (e) {
        DebugService.qrCode('原生SDK生成二维码失败: ${e.message}', error: e, level: LogLevel.error);
        throw Exception('原生SDK生成二维码失败: ${e.message}');
      } catch (e) {
        DebugService.qrCode('生成二维码过程发生错误', error: e, level: LogLevel.error);
        throw Exception('生成二维码过程发生错误: $e');
      }
    });
  }

  /// 获取原生SDK版本信息
  static Future<Map<String, String>> getNativeSDKVersions() async {
    try {
      final cosVersion = await _cosChannel.invokeMethod<String>('getVersion') ?? 'Unknown';
      final qrVersion = await _qrChannel.invokeMethod<String>('getVersion') ?? 'Unknown';
      
      return {
        'cosSDK': cosVersion,
        'zxingSDK': qrVersion,
      };
    } catch (e) {
      return {
        'cosSDK': 'Unavailable',
        'zxingSDK': 'Unavailable',
      };
    }
  }

  /// 测试原生SDK连接
  static Future<Map<String, bool>> testNativeSDKConnection() async {
    try {
      final cosTest = await _cosChannel.invokeMethod<bool>('testConnection', {
        'secretId': TencentCloudConfig.secretId,
        'secretKey': TencentCloudConfig.secretKey,
        'bucketName': TencentCloudConfig.bucketName,
        'region': TencentCloudConfig.region,
      }) ?? false;

      final qrTest = await _qrChannel.invokeMethod<bool>('testQRGeneration') ?? false;

      return {
        'cos': cosTest,
        'qr': qrTest,
      };
    } catch (e) {
      return {
        'cos': false,
        'qr': false,
      };
    }
  }

  /// 清理Platform Channel监听
  static void dispose() {
    _cosChannel.setMethodCallHandler(null);
    _qrChannel.setMethodCallHandler(null);
  }
}