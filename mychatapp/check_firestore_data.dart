import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'lib/firebase_options.dart';

/// 检查Firestore数据结构
void main() async {
  print('🔍 检查Firestore数据结构...');
  
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
    
    final auth = FirebaseAuth.instance;
    final firestore = FirebaseFirestore.instance;
    
    final currentUser = auth.currentUser;
    if (currentUser == null) {
      print('❌ 用户未登录');
      return;
    }
    
    print('👤 当前用户ID: ${currentUser.uid}');
    
    // 检查用户文档
    print('\n📋 检查用户文档...');
    final userDoc = await firestore.collection('users').doc(currentUser.uid).get();
    if (userDoc.exists) {
      print('✅ 用户文档存在');
      print('   数据: ${userDoc.data()}');
    } else {
      print('❌ 用户文档不存在');
      
      // 创建用户文档
      print('🔧 创建用户文档...');
      await firestore.collection('users').doc(currentUser.uid).set({
        'uid': currentUser.uid,
        'email': currentUser.email,
        'displayName': currentUser.displayName ?? 'User',
        'createdAt': FieldValue.serverTimestamp(),
      });
      print('✅ 用户文档已创建');
    }
    
    // 检查chat_rooms集合
    print('\n📋 检查chat_rooms集合...');
    try {
      final chatRoomsSnapshot = await firestore
          .collection('chat_rooms')
          .limit(5)
          .get();
      print('✅ chat_rooms集合访问成功');
      print('   找到 ${chatRoomsSnapshot.docs.length} 个聊天室');
      
      for (var doc in chatRoomsSnapshot.docs) {
        final data = doc.data();
        print('   聊天室ID: ${doc.id}');
        print('   参与者: ${data['participantIds']}');
        print('   最后消息时间: ${data['lastMessageTimestamp']}');
        print('   ---');
      }
    } catch (e) {
      print('❌ chat_rooms集合访问失败: $e');
    }
    
    // 测试用户专属查询
    print('\n📋 测试用户专属查询...');
    try {
      final userChatRooms = await firestore
          .collection('chat_rooms')
          .where('participantIds', arrayContains: currentUser.uid)
          .limit(5)
          .get();
      print('✅ 用户聊天室查询成功');
      print('   找到 ${userChatRooms.docs.length} 个属于该用户的聊天室');
      
      if (userChatRooms.docs.isEmpty) {
        print('⚠️ 该用户没有任何聊天室，这可能是加载失败的原因');
        
        // 创建一个测试聊天室
        print('🔧 创建测试聊天室...');
        await firestore.collection('chat_rooms').add({
          'participantIds': [currentUser.uid, 'test_user_id'],
          'participantNames': {
            currentUser.uid: currentUser.displayName ?? 'User',
            'test_user_id': 'Test User'
          },
          'lastMessage': '这是一条测试消息',
          'lastMessageTimestamp': FieldValue.serverTimestamp(),
          'unreadCounts': {
            currentUser.uid: 0,
            'test_user_id': 1
          }
        });
        print('✅ 测试聊天室已创建');
      }
    } catch (e) {
      print('❌ 用户聊天室查询失败: $e');
      
      if (e.toString().contains('PERMISSION_DENIED')) {
        print('💡 权限问题仍然存在，可能需要等待规则生效或检查规则语法');
      }
    }
    
  } catch (e) {
    print('❌ 检查过程中发生错误: $e');
  }
}
