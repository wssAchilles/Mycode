import 'dart:io';
import 'package:firebase_core/firebase_core.dart';

/// 网络连接检查工具
class NetworkChecker {
  /// 检查基本网络连接
  static Future<bool> hasInternetConnection() async {
    try {
      final result = await InternetAddress.lookup('google.com');
      return result.isNotEmpty && result[0].rawAddress.isNotEmpty;
    } on SocketException catch (_) {
      return false;
    }
  }

  /// 检查Firebase连接
  static Future<bool> checkFirebaseConnection() async {
    try {
      // 尝试获取Firebase App实例
      final app = Firebase.app();
      print('Firebase App ID: ${app.name}');
      print('Firebase Project ID: ${app.options.projectId}');
      return true;
    } catch (e) {
      print('Firebase连接检查失败: $e');
      return false;
    }
  }

  /// 检查中国大陆网络环境下的Firebase连接
  static Future<Map<String, dynamic>> diagnoseFirebaseConnection() async {
    final Map<String, dynamic> result = {};
    
    // 基本网络连接
    result['hasInternet'] = await hasInternetConnection();
    
    // Firebase配置检查
    result['firebaseConfigured'] = await checkFirebaseConnection();
    
    // 检查Firebase服务器连接
    try {
      final googleResult = await InternetAddress.lookup('firebase.google.com')
          .timeout(const Duration(seconds: 5));
      result['firebaseServerReachable'] = googleResult.isNotEmpty;
    } catch (e) {
      result['firebaseServerReachable'] = false;
      result['firebaseServerError'] = e.toString();
    }
    
    // 检查Firestore连接
    try {
      final firestoreResult = await InternetAddress.lookup('firestore.googleapis.com')
          .timeout(const Duration(seconds: 5));
      result['firestoreServerReachable'] = firestoreResult.isNotEmpty;
    } catch (e) {
      result['firestoreServerReachable'] = false;
      result['firestoreServerError'] = e.toString();
    }
    
    return result;
  }

  /// 获取网络诊断建议
  static String getNetworkAdvice(Map<String, dynamic> diagnosis) {
    if (!diagnosis['hasInternet']) {
      return '网络连接不可用，请检查您的网络设置';
    }
    
    if (!diagnosis['firebaseConfigured']) {
      return 'Firebase配置有问题，请检查firebase_options.dart文件';
    }
    
    if (!diagnosis['firebaseServerReachable']) {
      return 'Firebase服务器连接失败，可能是网络防火墙或中国大陆网络环境影响，建议使用VPN或等待重试';
    }
    
    if (!diagnosis['firestoreServerReachable']) {
      return 'Firestore服务器连接失败，请检查网络环境或稍后重试';
    }
    
    return '网络环境正常';
  }
}
