import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'lib/firebase_options.dart';

/// Firestore权限调试脚本
void main() async {
  print('🔍 开始Firestore权限诊断...');
  
  try {
    // 初始化Firebase
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
    print('✅ Firebase初始化成功');
    
    final auth = FirebaseAuth.instance;
    final firestore = FirebaseFirestore.instance;
    
    // 检查当前用户
    final currentUser = auth.currentUser;
    if (currentUser == null) {
      print('❌ 当前没有用户登录，请先登录');
      return;
    }
    
    print('👤 当前用户: ${currentUser.uid}');
    print('📧 用户邮箱: ${currentUser.email}');
    
    // 测试1: 读取users集合
    print('\n🔬 测试1: 读取users集合...');
    try {
      final usersSnapshot = await firestore
          .collection('users')
          .limit(1)
          .get()
          .timeout(Duration(seconds: 10));
      print('✅ users集合读取成功，找到 ${usersSnapshot.docs.length} 个文档');
    } catch (e) {
      print('❌ users集合读取失败: $e');
    }
    
    // 测试2: 读取当前用户文档
    print('\n🔬 测试2: 读取当前用户文档...');
    try {
      final userDoc = await firestore
          .collection('users')
          .doc(currentUser.uid)
          .get()
          .timeout(Duration(seconds: 10));
      if (userDoc.exists) {
        print('✅ 当前用户文档存在');
        final data = userDoc.data();
        print('   - 显示名称: ${data?['displayName']}');
        print('   - 邮箱: ${data?['email']}');
      } else {
        print('⚠️ 当前用户文档不存在');
      }
    } catch (e) {
      print('❌ 读取用户文档失败: $e');
    }
    
    // 测试3: 查询chat_rooms集合
    print('\n🔬 测试3: 查询chat_rooms集合...');
    try {
      final chatRoomsSnapshot = await firestore
          .collection('chat_rooms')
          .where('participantIds', arrayContains: currentUser.uid)
          .limit(1)
          .get()
          .timeout(Duration(seconds: 10));
      print('✅ chat_rooms集合查询成功，找到 ${chatRoomsSnapshot.docs.length} 个聊天室');
    } catch (e) {
      print('❌ chat_rooms集合查询失败: $e');
      
      // 进一步分析错误类型
      if (e.toString().contains('PERMISSION_DENIED')) {
        print('   💡 这是权限问题，需要检查Firestore安全规则');
        print('   💡 当前规则可能没有正确部署或配置不当');
      }
    }
    
    // 测试4: 尝试简单的读取操作
    print('\n🔬 测试4: 尝试读取chat_rooms集合（不使用查询条件）...');
    try {
      final chatRoomsSnapshot = await firestore
          .collection('chat_rooms')
          .limit(1)
          .get()
          .timeout(Duration(seconds: 10));
      print('✅ chat_rooms集合基础读取成功，找到 ${chatRoomsSnapshot.docs.length} 个文档');
    } catch (e) {
      print('❌ chat_rooms集合基础读取失败: $e');
    }
    
    print('\n🎯 诊断完成');
    
  } catch (e) {
    print('❌ 诊断过程中发生错误: $e');
  }
}
