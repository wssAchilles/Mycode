import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import '../models/user_model.dart';

/// 认证服务类
/// 作为与Firebase Authentication交互的唯一入口，封装所有认证逻辑
class AuthService {
  static final AuthService _instance = AuthService._internal();
  factory AuthService() => _instance;
  AuthService._internal();

  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseMessaging _messaging = FirebaseMessaging.instance;

  /// 当前登录用户
  User? get currentUser => _auth.currentUser;

  /// 认证状态变化流
  Stream<User?> get authStateChanges => _auth.authStateChanges();

  /// 用户注册
  /// 使用邮箱和密码进行用户注册
  Future<UserCredential?> signUp({
    required String email,
    required String password,
    String? displayName,
  }) async {
    try {
      print('开始用户注册流程...');
      
      // 设置超时时间为30秒
      final completer = Completer<UserCredential>();
      Timer(const Duration(seconds: 30), () {
        if (!completer.isCompleted) {
          completer.completeError('注册超时，请检查网络连接后重试');
        }
      });

      // 创建用户账户
      print('正在创建Firebase Auth用户...');
      UserCredential userCredential = await _auth.createUserWithEmailAndPassword(
        email: email,
        password: password,
      ).timeout(
        const Duration(seconds: 15),
        onTimeout: () => throw Exception('Firebase认证超时，请检查网络连接'),
      );
      
      print('Firebase Auth用户创建成功: ${userCredential.user?.uid}');

      // 更新用户显示名称
      if (displayName != null && displayName.isNotEmpty) {
        print('更新用户显示名称...');
        await userCredential.user?.updateDisplayName(displayName);
        await userCredential.user?.reload();
        print('显示名称更新成功');
      }

      // 获取FCM令牌
      print('获取FCM令牌...');
      String? fcmToken;
      try {
        fcmToken = await _messaging.getToken().timeout(
          const Duration(seconds: 10),
          onTimeout: () {
            print('FCM令牌获取超时，将使用null值');
            return null;
          },
        );
        print('FCM令牌获取成功: ${fcmToken != null ? "已获取" : "未获取"}');
      } catch (e) {
        print('FCM令牌获取失败: $e，继续注册流程');
        fcmToken = null;
      }

      // 在Firestore中创建用户文档
      if (userCredential.user != null) {
        print('创建Firestore用户文档...');
        await _createUserDocument(userCredential.user!, fcmToken);
        print('Firestore用户文档创建成功');
      }

      print('用户注册流程完成');
      return userCredential;
    } on FirebaseAuthException catch (e) {
      print('Firebase认证异常: ${e.code} - ${e.message}');
      // 处理Firebase认证异常
      throw _handleAuthException(e);
    } catch (e) {
      print('注册过程中发生错误: $e');
      throw Exception('注册失败：${e.toString()}');
    }
  }

  /// 用户登录
  /// 使用邮箱和密码进行用户登录
  Future<UserCredential?> signIn({
    required String email,
    required String password,
  }) async {
    try {
      UserCredential userCredential = await _auth.signInWithEmailAndPassword(
        email: email,
        password: password,
      );

      // 更新FCM令牌
      await _updateFCMToken();

      return userCredential;
    } on FirebaseAuthException catch (e) {
      throw _handleAuthException(e);
    } catch (e) {
      throw Exception('登录失败：${e.toString()}');
    }
  }

  /// 用户登出
  /// 即使Firestore中不存在用户文档，也能保证成功登出
  Future<void> signOut() async {
    final String? uid = _auth.currentUser?.uid;
    
    // 只有在用户已登录时才尝试清除FCM令牌
    if (uid != null) {
      try {
        // 尝试清除FCM令牌
        await _firestore
            .collection('users')
            .doc(uid)
            .update({'fcmToken': null});
      } on FirebaseException catch (e) {
        // 如果文档不存在，则忽略此错误
        if (e.code != 'not-found') {
          // 如果是其他Firebase异常，则重新抛出
          rethrow;
        }
        // not-found 错误被静默处理，继续执行登出
        print('用户文档不存在，继续执行登出流程');
      } catch (e) {
        // 捕获其他非Firebase异常
        print('清除FCM令牌时发生错误：${e.toString()}');
        // 不重新抛出，确保登出流程继续
      }
    }

    // 无论前面的操作成功与否，都确保执行核心登出操作
    try {
      await _auth.signOut();
    } catch (e) {
      throw Exception('登出失败：${e.toString()}');
    }
  }

  /// 重置密码
  Future<void> resetPassword(String email) async {
    try {
      await _auth.sendPasswordResetEmail(email: email);
    } on FirebaseAuthException catch (e) {
      throw _handleAuthException(e);
    } catch (e) {
      throw Exception('密码重置失败：${e.toString()}');
    }
  }

  /// 获取当前用户的UserModel
  Future<UserModel?> getCurrentUserModel() async {
    if (currentUser == null) return null;

    try {
      DocumentSnapshot doc = await _firestore
          .collection('users')
          .doc(currentUser!.uid)
          .get();

      if (doc.exists) {
        return UserModel.fromJson(doc.data() as Map<String, dynamic>, doc.id);
      }
      return null;
    } catch (e) {
      throw Exception('获取用户信息失败：${e.toString()}');
    }
  }

  /// 更新用户资料
  Future<void> updateUserProfile({
    String? displayName,
    String? photoUrl,
  }) async {
    if (currentUser == null) return;

    try {
      // 更新Firebase Auth用户资料
      if (displayName != null) {
        await currentUser!.updateDisplayName(displayName);
      }
      if (photoUrl != null) {
        await currentUser!.updatePhotoURL(photoUrl);
      }
      await currentUser!.reload();

      // 更新Firestore用户文档
      Map<String, dynamic> updateData = {};
      if (displayName != null) updateData['displayName'] = displayName;
      if (photoUrl != null) updateData['photoUrl'] = photoUrl;

      if (updateData.isNotEmpty) {
        await _firestore
            .collection('users')
            .doc(currentUser!.uid)
            .update(updateData);
      }
    } catch (e) {
      throw Exception('更新用户资料失败：${e.toString()}');
    }
  }

  /// 在Firestore中创建用户文档
  /// 严格遵循蓝图定义的用户文档结构：{uid, email, displayName, photoUrl, createdAt}
  Future<void> _createUserDocument(User user, String? fcmToken) async {
    try {
      print('准备创建用户文档，UID: ${user.uid}');
      
      UserModel userModel = UserModel(
        uid: user.uid,
        email: user.email ?? '',
        displayName: user.displayName ?? '',
        photoUrl: user.photoURL,
        createdAt: Timestamp.now(),
        fcmToken: fcmToken,
      );

      print('用户模型创建完成，开始写入Firestore...');
      
      await _firestore
          .collection('users')
          .doc(user.uid)
          .set(userModel.toJson())
          .timeout(
            const Duration(seconds: 15),
            onTimeout: () => throw Exception('Firestore写入超时，请检查网络连接'),
          );
          
      print('Firestore用户文档写入成功');
    } catch (e) {
      print('创建用户文档时发生错误: $e');
      throw Exception('创建用户文档失败：${e.toString()}');
    }
  }

  /// 更新FCM令牌
  Future<void> _updateFCMToken() async {
    if (currentUser == null) return;

    try {
      String? fcmToken = await _messaging.getToken();
      if (fcmToken != null) {
        await _firestore
            .collection('users')
            .doc(currentUser!.uid)
            .update({'fcmToken': fcmToken});
      }
    } catch (e) {
      // FCM令牌更新失败不应该影响登录流程
      print('FCM令牌更新失败：${e.toString()}');
    }
  }

  /// 处理Firebase认证异常
  String _handleAuthException(FirebaseAuthException e) {
    switch (e.code) {
      case 'weak-password':
        return '密码强度太弱，请使用更强的密码';
      case 'email-already-in-use':
        return '该邮箱已被注册，请使用其他邮箱';
      case 'invalid-email':
        return '邮箱格式不正确';
      case 'user-not-found':
        return '用户不存在，请检查邮箱地址';
      case 'wrong-password':
        return '密码错误，请重新输入';
      case 'user-disabled':
        return '该账户已被禁用';
      case 'too-many-requests':
        return '请求过于频繁，请稍后再试';
      case 'operation-not-allowed':
        return '操作不被允许，请联系管理员';
      default:
        return '认证失败：${e.message}';
    }
  }

  /// 检查邮箱是否已注册
  Future<bool> isEmailRegistered(String email) async {
    try {
      try {
        final credential = EmailAuthProvider.credential(email: email, password: 'dummy');
        await _auth.signInWithCredential(credential);
        return true; // 如果没有异常，说明邮箱存在
      } on FirebaseAuthException catch (e) {
        if (e.code == 'user-not-found') {
          return false;
        }
        return true; // 其他错误（如密码错误）说明邮箱存在
      }
    } catch (e) {
      return false;
    }
  }

  /// 删除用户账户
  Future<void> deleteAccount() async {
    if (currentUser == null) return;

    try {
      String uid = currentUser!.uid;
      
      // 删除Firestore中的用户文档
      await _firestore.collection('users').doc(uid).delete();
      
      // 删除Firebase Auth中的用户
      await currentUser!.delete();
    } catch (e) {
      throw Exception('删除账户失败：${e.toString()}');
    }
  }
}
