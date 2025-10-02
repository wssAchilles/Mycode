import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'lib/firebase_options.dart';

/// 设置测试好友关系的脚本
void main() async {
  print('🔧 设置测试好友关系...');
  
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
    
    final currentUserId = currentUser.uid;
    print('👤 当前用户ID: $currentUserId');
    
    // 创建一个测试好友用户
    const testFriendId = 'test_friend_123';
    const testFriendEmail = 'testfriend@example.com';
    const testFriendName = '测试好友';
    
    // 1. 创建测试好友用户文档
    print('\n📝 创建测试好友用户文档...');
    await firestore.collection('users').doc(testFriendId).set({
      'uid': testFriendId,
      'email': testFriendEmail,
      'displayName': testFriendName,
      'photoUrl': null,
      'createdAt': FieldValue.serverTimestamp(),
      'fcmToken': null,
      'friendIds': [currentUserId], // 测试好友的好友列表中包含当前用户
    });
    print('✅ 测试好友用户文档已创建');
    
    // 2. 更新当前用户的好友列表
    print('\n📝 更新当前用户的好友列表...');
    await firestore.collection('users').doc(currentUserId).update({
      'friendIds': FieldValue.arrayUnion([testFriendId])
    });
    print('✅ 当前用户好友列表已更新');
    
    // 3. 验证好友关系
    print('\n🔍 验证好友关系...');
    final currentUserDoc = await firestore.collection('users').doc(currentUserId).get();
    final testFriendDoc = await firestore.collection('users').doc(testFriendId).get();
    
    if (currentUserDoc.exists && testFriendDoc.exists) {
      final currentUserData = currentUserDoc.data()!;
      final testFriendData = testFriendDoc.data()!;
      
      final currentUserFriends = List<String>.from(currentUserData['friendIds'] ?? []);
      final testFriendFriends = List<String>.from(testFriendData['friendIds'] ?? []);
      
      print('当前用户好友列表: $currentUserFriends');
      print('测试好友好友列表: $testFriendFriends');
      
      final isMutualFriends = currentUserFriends.contains(testFriendId) && 
                              testFriendFriends.contains(currentUserId);
      
      if (isMutualFriends) {
        print('✅ 互相添加为好友成功！');
      } else {
        print('❌ 好友关系不完整');
      }
    }
    
    // 4. 测试聊天室创建
    print('\n🔍 测试聊天室创建权限...');
    final chatRoomId = [currentUserId, testFriendId]..sort();
    final chatRoomIdString = chatRoomId.join('_');
    
    try {
      await firestore.collection('chat_rooms').doc(chatRoomIdString).set({
        'chatRoomId': chatRoomIdString,
        'participantIds': [currentUserId, testFriendId],
        'lastMessage': null,
        'lastMessageTimestamp': null,
        'lastMessageSenderId': null,
        'unreadCounts': {
          currentUserId: 0,
          testFriendId: 0,
        },
      });
      print('✅ 测试聊天室创建成功');
    } catch (e) {
      print('❌ 测试聊天室创建失败: $e');
    }
    
    print('\n🎉 测试好友关系设置完成！');
    print('📱 现在可以尝试与测试好友聊天了');
    
  } catch (e) {
    print('❌ 设置过程中发生错误: $e');
  }
}
