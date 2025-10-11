// Firebase 服务封装
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

/// Firebase服务单例类
class FirebaseService {
  static final FirebaseService _instance = FirebaseService._internal();
  factory FirebaseService() => _instance;
  FirebaseService._internal();

  // Firebase实例
  FirebaseFirestore? _firestore;
  FirebaseAuth? _auth;
  bool _isInitialized = false;

  FirebaseFirestore get firestore => _firestore!;
  FirebaseAuth get auth => _auth!;
  bool get isInitialized => _isInitialized;

  // 用户状态流
  Stream<User?> get authStateChanges => _auth?.authStateChanges() ?? Stream.value(null);
  User? get currentUser => _auth?.currentUser;

  /// 初始化Firebase
  Future<void> initialize() async {
    try {
      // 检查是否已经初始化过
      if (_isInitialized) {
        return;
      }

      await Firebase.initializeApp(
        options: kIsWeb
            ? const FirebaseOptions(
                apiKey: "AIzaSyB9881dS4fMzW9sgFLdO4binSGTrP2NE38",
                authDomain: "experiment-platform-cc91e.firebaseapp.com",
                projectId: "experiment-platform-cc91e",
                storageBucket: "experiment-platform-cc91e.firebasestorage.app",
                messagingSenderId: "1068811839219",
                appId: "1:1068811839219:web:94a66abb0de1ccfc2cb986",
                measurementId: "G-BMZHVF7LGG",
              )
            : null, // 移动端会使用google-services.json/GoogleService-Info.plist
      );

      _firestore = FirebaseFirestore.instance;
      _auth = FirebaseAuth.instance;
      _isInitialized = true;

      debugPrint('Firebase初始化成功');
    } catch (e) {
      debugPrint('Firebase初始化失败: $e');
      // 不重新抛出异常，让应用继续运行
      rethrow;
    }
  }

  // ============= 认证相关方法 =============

  /// 邮箱密码注册
  Future<UserCredential?> registerWithEmail({
    required String email,
    required String password,
    String? displayName,
  }) async {
    if (_auth == null) {
      debugPrint('Firebase Auth 未初始化');
      throw Exception('Firebase Auth 未初始化');
    }
    
    try {
      debugPrint('开始注册用户: $email');
      
      final credential = await _auth!.createUserWithEmailAndPassword(
        email: email,
        password: password,
      );

      debugPrint('用户注册成功，UID: ${credential.user?.uid}');

      if (displayName != null && credential.user != null) {
        await credential.user!.updateDisplayName(displayName);
        debugPrint('用户显示名称已更新: $displayName');
      }

      // 创建用户文档
      if (credential.user != null) {
        await _createUserDocument(credential.user!);
        debugPrint('用户文档创建完成');
      }

      return credential;
    } on FirebaseAuthException catch (e) {
      debugPrint('Firebase Auth 错误: ${e.code} - ${e.message}');
      
      // 提供更详细的错误信息
      String errorMessage;
      switch (e.code) {
        case 'weak-password':
          errorMessage = '密码强度太弱，请使用至少6位字符';
          break;
        case 'email-already-in-use':
          errorMessage = '该邮箱已被注册，请使用其他邮箱';
          break;
        case 'invalid-email':
          errorMessage = '邮箱格式不正确';
          break;
        case 'operation-not-allowed':
          errorMessage = '邮箱注册功能未启用，请联系管理员';
          break;
        default:
          errorMessage = e.message ?? '注册失败，请稍后重试';
      }
      
      throw Exception(errorMessage);
    } catch (e) {
      debugPrint('注册时发生未知错误: $e');
      throw Exception('注册失败：$e');
    }
  }

  /// 邮箱密码登录
  Future<UserCredential?> loginWithEmail({
    required String email,
    required String password,
  }) async {
    if (_auth == null) {
      debugPrint('Firebase Auth 未初始化');
      throw Exception('Firebase Auth 未初始化');
    }
    
    try {
      debugPrint('开始登录用户: $email');
      
      final credential = await _auth!.signInWithEmailAndPassword(
        email: email,
        password: password,
      );
      
      debugPrint('用户登录成功，UID: ${credential.user?.uid}');
      return credential;
    } on FirebaseAuthException catch (e) {
      debugPrint('Firebase Auth 错误: ${e.code} - ${e.message}');
      
      // 提供更详细的错误信息
      String errorMessage;
      switch (e.code) {
        case 'user-not-found':
          errorMessage = '用户不存在，请先注册';
          break;
        case 'wrong-password':
          errorMessage = '密码错误，请重试';
          break;
        case 'invalid-email':
          errorMessage = '邮箱格式不正确';
          break;
        case 'user-disabled':
          errorMessage = '该账户已被禁用';
          break;
        case 'too-many-requests':
          errorMessage = '登录尝试次数过多，请稍后再试';
          break;
        default:
          errorMessage = e.message ?? '登录失败，请稍后重试';
      }
      
      throw Exception(errorMessage);
    } catch (e) {
      debugPrint('登录时发生未知错误: $e');
      throw Exception('登录失败：$e');
    }
  }

  /// 登出
  Future<void> logout() async {
    if (_auth != null) {
      await _auth!.signOut();
    }
  }

  /// 重置密码
  Future<void> resetPassword(String email) async {
    if (_auth != null) {
      await _auth!.sendPasswordResetEmail(email: email);
    }
  }

  // ============= Firestore 数据操作 =============

  /// 创建用户文档
  Future<void> _createUserDocument(User user) async {
    if (_firestore == null) return;
    
    try {
      final userRef = _firestore!.collection('users').doc(user.uid);
      final doc = await userRef.get();

      if (!doc.exists) {
        await userRef.set({
          'uid': user.uid,
          'email': user.email,
          'displayName': user.displayName ?? '',
          'createdAt': FieldValue.serverTimestamp(),
          'learning_progress': {},
          'saved_cases': [],
        });
      }
    } catch (e) {
      debugPrint('创建用户文档失败: $e');
    }
  }

  /// 获取用户数据
  Future<Map<String, dynamic>?> getUserData(String uid) async {
    if (_firestore == null) return null;
    
    try {
      final doc = await _firestore!.collection('users').doc(uid).get();
      return doc.data();
    } catch (e) {
      debugPrint('获取用户数据失败: $e');
      return null;
    }
  }

  /// 更新学习进度
  Future<void> updateLearningProgress({
    required String userId,
    required String algorithmType,
    required Map<String, dynamic> progress,
  }) async {
    if (_firestore == null) return;
    
    try {
      await _firestore!.collection('users').doc(userId).update({
        'learning_progress.$algorithmType': progress,
        'lastUpdated': FieldValue.serverTimestamp(),
      });
    } catch (e) {
      debugPrint('更新学习进度失败: $e');
      rethrow;
    }
  }

  /// 保存算法案例
  Future<void> saveAlgorithmCase({
    required String algorithmType,
    required List<int> inputData,
    required List<Map<String, dynamic>> steps,
    required Map<String, dynamic> metrics,
  }) async {
    if (_firestore == null) return;
    
    try {
      await _firestore!.collection('algorithm_cases').add({
        'algorithm_type': algorithmType,
        'input_data': inputData,
        'steps': steps,
        'complexity_analysis': metrics,
        'createdAt': FieldValue.serverTimestamp(),
        'createdBy': currentUser?.uid,
      });
    } catch (e) {
      debugPrint('保存算法案例失败: $e');
      rethrow;
    }
  }

  /// 获取算法案例
  Stream<QuerySnapshot> getAlgorithmCases({String? algorithmType}) {
    if (_firestore == null) {
      return Stream.empty();
    }
    
    Query query = _firestore!.collection('algorithm_cases');
    
    if (algorithmType != null) {
      query = query.where('algorithm_type', isEqualTo: algorithmType);
    }
    
    return query
        .orderBy('createdAt', descending: true)
        .limit(20)
        .snapshots();
  }

  /// 保存用户提交
  Future<void> saveUserSubmission({
    required String algorithmId,
    required List<int> customInput,
    required Duration executionTime,
  }) async {
    if (_firestore == null) return;
    
    try {
      await _firestore!.collection('user_submissions').add({
        'user_id': currentUser?.uid,
        'algorithm_id': algorithmId,
        'custom_input': customInput,
        'execution_time': executionTime.inMilliseconds,
        'submittedAt': FieldValue.serverTimestamp(),
      });
    } catch (e) {
      debugPrint('保存用户提交失败: $e');
      rethrow;
    }
  }

  /// 获取用户提交历史
  Stream<QuerySnapshot> getUserSubmissions() {
    if (_firestore == null || currentUser == null) {
      return Stream.empty();
    }
    
    return _firestore!
        .collection('user_submissions')
        .where('user_id', isEqualTo: currentUser!.uid)
        .orderBy('submittedAt', descending: true)
        .limit(50)
        .snapshots();
  }
  
  // ============= 用户进度相关方法 =============
  
  /// 获取用户学习进度
  Future<Map<String, dynamic>?> getUserProgress(String userId) async {
    if (_firestore == null) return null;
    
    try {
      final doc = await _firestore!
          .collection('user_progress')
          .doc(userId)
          .get();
      
      if (!doc.exists) {
        // 创建初始进度文档
        await _createInitialProgress(userId);
        return {};
      }
      
      return doc.data();
    } catch (e) {
      debugPrint('获取用户进度失败: $e');
      return null;
    }
  }
  
  /// 创建初始进度文档
  Future<void> _createInitialProgress(String userId) async {
    if (_firestore == null) return;
    
    try {
      await _firestore!.collection('user_progress').doc(userId).set({
        'userId': userId,
        'algorithmProgress': {},
        'dataStructureProgress': {},
        'savedCases': [],
        'lastUpdated': FieldValue.serverTimestamp(),
        'totalStudyTime': 0,
        'dailyStudyTime': {},
      });
    } catch (e) {
      debugPrint('创建初始进度失败: $e');
    }
  }
  
  /// 更新算法学习进度
  Future<void> updateAlgorithmProgress({
    required String userId,
    required String algorithmName,
    required Map<String, dynamic> progress,
  }) async {
    if (_firestore == null) return;
    
    try {
      await _firestore!.collection('user_progress').doc(userId).update({
        'algorithmProgress.$algorithmName': progress,
        'lastUpdated': FieldValue.serverTimestamp(),
      });
      
      debugPrint('算法进度更新成功: $algorithmName');
    } catch (e) {
      debugPrint('更新算法进度失败: $e');
    }
  }
  
  /// 更新数据结构学习进度
  Future<void> updateDataStructureProgress({
    required String userId,
    required String structureName,
    required Map<String, dynamic> progress,
  }) async {
    if (_firestore == null) return;
    
    try {
      await _firestore!.collection('user_progress').doc(userId).update({
        'dataStructureProgress.$structureName': progress,
        'lastUpdated': FieldValue.serverTimestamp(),
      });
      
      debugPrint('数据结构进度更新成功: $structureName');
    } catch (e) {
      debugPrint('更新数据结构进度失败: $e');
    }
  }
  
  /// 保存案例
  Future<void> saveCaseToProgress({
    required String userId,
    required Map<String, dynamic> caseData,
  }) async {
    if (_firestore == null) return;
    
    try {
      await _firestore!.collection('user_progress').doc(userId).update({
        'savedCases': FieldValue.arrayUnion([caseData]),
        'lastUpdated': FieldValue.serverTimestamp(),
      });
      
      debugPrint('案例保存成功');
    } catch (e) {
      debugPrint('保存案例失败: $e');
    }
  }
  
  /// 更新学习时间
  Future<void> updateStudyTime({
    required String userId,
    required int minutes,
  }) async {
    if (_firestore == null) return;
    
    try {
      final today = DateTime.now().toIso8601String().split('T')[0];
      
      await _firestore!.collection('user_progress').doc(userId).update({
        'totalStudyTime': FieldValue.increment(minutes),
        'dailyStudyTime.$today': FieldValue.increment(minutes),
        'lastUpdated': FieldValue.serverTimestamp(),
      });
      
      debugPrint('学习时间更新成功: $minutes 分钟');
    } catch (e) {
      debugPrint('更新学习时间失败: $e');
    }
  }
  
  /// 获取学习统计
  Future<Map<String, dynamic>?> getStudyStatistics(String userId) async {
    if (_firestore == null) return null;
    
    try {
      final doc = await _firestore!
          .collection('user_statistics')
          .doc(userId)
          .get();
      
      if (!doc.exists) {
        await _createInitialStatistics(userId);
        return {};
      }
      
      return doc.data();
    } catch (e) {
      debugPrint('获取学习统计失败: $e');
      return null;
    }
  }
  
  /// 创建初始统计文档
  Future<void> _createInitialStatistics(String userId) async {
    if (_firestore == null) return;
    
    try {
      await _firestore!.collection('user_statistics').doc(userId).set({
        'userId': userId,
        'totalAlgorithmsCompleted': 0,
        'totalDataStructuresCompleted': 0,
        'totalPracticeCount': 0,
        'totalStudyDays': 0,
        'currentStreak': 0,
        'longestStreak': 0,
        'algorithmPracticeCount': {},
        'algorithmMastery': {},
        'accountCreated': FieldValue.serverTimestamp(),
      });
    } catch (e) {
      debugPrint('创建初始统计失败: $e');
    }
  }
  
  /// 增加练习计数
  Future<void> incrementPracticeCount({
    required String userId,
    required String algorithmName,
  }) async {
    if (_firestore == null) return;
    
    try {
      await _firestore!.collection('user_statistics').doc(userId).update({
        'totalPracticeCount': FieldValue.increment(1),
        'algorithmPracticeCount.$algorithmName': FieldValue.increment(1),
      });
      
      debugPrint('练习计数更新成功: $algorithmName');
    } catch (e) {
      debugPrint('更新练习计数失败: $e');
    }
  }
  
  /// 标记算法完成
  Future<void> markAlgorithmCompleted({
    required String userId,
    required String algorithmName,
  }) async {
    if (_firestore == null) return;
    
    try {
      // 更新进度
      await updateAlgorithmProgress(
        userId: userId,
        algorithmName: algorithmName,
        progress: {
          'isCompleted': true,
          'completedAt': FieldValue.serverTimestamp(),
        },
      );
      
      // 更新统计
      await _firestore!.collection('user_statistics').doc(userId).update({
        'totalAlgorithmsCompleted': FieldValue.increment(1),
        'algorithmMastery.$algorithmName': 1.0,
      });
      
      debugPrint('算法标记为已完成: $algorithmName');
    } catch (e) {
      debugPrint('标记算法完成失败: $e');
    }
  }
}
