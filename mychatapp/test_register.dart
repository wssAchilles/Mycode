import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';

/// 简单的注册测试脚本
void main() async {
  print('开始Firebase注册测试...');
  
  try {
    // 初始化Firebase（你需要先配置好firebase_options.dart）
    await Firebase.initializeApp();
    print('✅ Firebase初始化成功');
    
    final auth = FirebaseAuth.instance;
    
    // 测试注册
    const email = 'test@example.com';
    const password = 'test123456';
    
    print('🔄 开始注册测试用户...');
    
    final userCredential = await auth.createUserWithEmailAndPassword(
      email: email,
      password: password,
    ).timeout(
      const Duration(seconds: 15),
      onTimeout: () {
        throw Exception('注册超时');
      },
    );
    
    print('✅ 注册成功! UID: ${userCredential.user?.uid}');
    
    // 清理测试用户
    await userCredential.user?.delete();
    print('🧹 测试用户已清理');
    
  } catch (e) {
    print('❌ 注册测试失败: $e');
    
    if (e.toString().contains('network')) {
      print('💡 建议检查网络连接');
    } else if (e.toString().contains('email-already-in-use')) {
      print('💡 邮箱已被使用，测试正常');
    } else {
      print('💡 建议检查Firebase配置');
    }
  }
}
