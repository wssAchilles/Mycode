// Firebase 服务封装
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../utils/app_exceptions.dart';

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
                apiKey: "AIzaSyBHi2EnTWAPYTsWtWGjzod76BRh7hO421E",
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
      throw ServiceUnavailableException(
        'Firebase服务初始化失败，请检查网络连接',
        originalError: e,
      );
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
      throw ServiceUnavailableException('认证服务未初始化，请稍后重试');
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
      throw AuthException(
        _mapAuthErrorCodeToMessage(e.code),
        code: e.code,
        originalError: e,
      );
    } catch (e) {
      debugPrint('注册时发生未知错误: $e');
      throw AuthException(
        '发生未知错误，请稍后重试',
        originalError: e,
      );
    }
  }

  /// 邮箱密码登录
  Future<UserCredential?> loginWithEmail({
    required String email,
    required String password,
  }) async {
    if (_auth == null) {
      debugPrint('Firebase Auth 未初始化');
      throw ServiceUnavailableException('认证服务未初始化，请稍后重试');
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
      throw AuthException(
        _mapAuthErrorCodeToMessage(e.code),
        code: e.code,
        originalError: e,
      );
    } catch (e) {
      debugPrint('登录时发生未知错误: $e');
      throw AuthException(
        '发生未知错误，请稍后重试',
        originalError: e,
      );
    }
  }

  /// 登出
  Future<void> logout() async {
    if (_auth != null) {
      await _auth!.signOut();
    }
    // 同时登出 Google
    try {
      await GoogleSignIn().signOut();
    } catch (_) {
      // 忽略 Google 登出错误
    }
  }

  /// Google 登录
  Future<UserCredential?> signInWithGoogle() async {
    if (_auth == null) {
      throw ServiceUnavailableException('认证服务未初始化，请稍后重试');
    }
    
    try {
      debugPrint('开始 Google 登录...');
      
      // 创建 Google 认证提供者
      final GoogleAuthProvider googleProvider = GoogleAuthProvider();
      googleProvider.addScope('email');
      googleProvider.addScope('profile');
      
      // 使用弹窗方式登录 (Web 和移动端都支持)
      final UserCredential userCredential;
      
      if (kIsWeb) {
        // Web 平台使用 signInWithPopup
        userCredential = await _auth!.signInWithPopup(googleProvider);
      } else {
        // 移动端使用 google_sign_in 包
        final GoogleSignIn googleSignIn = GoogleSignIn(scopes: ['email', 'profile']);
        final GoogleSignInAccount? googleUser = await googleSignIn.signIn();
        
        if (googleUser == null) {
          debugPrint('用户取消了 Google 登录');
          return null;
        }
        
        debugPrint('Google 用户: ${googleUser.email}');
        
        final GoogleSignInAuthentication googleAuth = await googleUser.authentication;
        final credential = GoogleAuthProvider.credential(
          accessToken: googleAuth.accessToken,
          idToken: googleAuth.idToken,
        );
        
        userCredential = await _auth!.signInWithCredential(credential);
      }
      
      debugPrint('Google 登录成功，UID: ${userCredential.user?.uid}');
      
      // 创建或更新用户文档
      if (userCredential.user != null) {
        await _createUserDocument(userCredential.user!);
      }
      
      return userCredential;
    } on FirebaseAuthException catch (e) {
      debugPrint('Firebase Auth 错误: ${e.code} - ${e.message}');
      throw AuthException(
        _mapAuthErrorCodeToMessage(e.code),
        code: e.code,
        originalError: e,
      );
    } catch (e) {
      debugPrint('Google 登录时发生未知错误: $e');
      throw AuthException(
        'Google 登录失败，请稍后重试',
        originalError: e,
      );
    }
  }

  /// 自动登录或注册
  /// 如果邮箱存在则登录，不存在则自动注册
  /// 返回 (UserCredential, bool isNewUser)
  Future<(UserCredential?, bool)> signInOrRegister({
    required String email,
    required String password,
    String? displayName,
  }) async {
    if (_auth == null) {
      throw ServiceUnavailableException('认证服务未初始化，请稍后重试');
    }
    
    try {
      debugPrint('开始自动登录/注册: $email');
      
      // 先尝试登录
      try {
        final credential = await _auth!.signInWithEmailAndPassword(
          email: email,
          password: password,
        );
        debugPrint('登录成功，UID: ${credential.user?.uid}');
        return (credential, false);
      } on FirebaseAuthException catch (e) {
        // 如果是用户不存在(user-not-found)或者凭证无效(invalid-credential)，则尝试注册
        // 注意：开启 Email Enumeration Protection 后，用户不存在也会返回 invalid-credential
        if (e.code == 'user-not-found' || e.code == 'invalid-credential') {
          debugPrint('用户可能不存在 (${e.code})，尝试自动注册...');
          
          try {
            final credential = await _auth!.createUserWithEmailAndPassword(
              email: email,
              password: password,
            );
            
            if (displayName != null && credential.user != null) {
              await credential.user!.updateDisplayName(displayName);
            }
            
            // 创建用户文档
            if (credential.user != null) {
              await _createUserDocument(credential.user!);
            }
            
            debugPrint('注册成功，UID: ${credential.user?.uid}');
            return (credential, true);
          } on FirebaseAuthException catch (regError) {
             // 如果注册失败提示邮箱已存在，说明之前的 invalid-credential 是因为密码错误
             if (regError.code == 'email-already-in-use') {
               debugPrint('自动注册失败: 邮箱已存在，说明是密码错误');
               throw AuthException(
                 '密码错误，请重试',
                 code: 'wrong-password',
                 originalError: e, // 使用原始登录错误
               );
             }
             rethrow;
          }
        }
        
        // 其他错误直接抛出
        rethrow;
      }
    } on FirebaseAuthException catch (e) {
      debugPrint('Firebase Auth 错误: ${e.code} - ${e.message}');
      throw AuthException(
        _mapAuthErrorCodeToMessage(e.code),
        code: e.code,
        originalError: e,
      );
    } catch (e) {
      debugPrint('登录/注册时发生未知错误: $e');
      throw AuthException(
        '发生未知错误，请稍后重试',
        originalError: e,
      );
    }
  }

  /// 重置密码
  Future<void> resetPassword(String email) async {
    if (_auth == null) {
      throw ServiceUnavailableException('认证服务未初始化，请稍后重试');
    }
    
    try {
      await _auth!.sendPasswordResetEmail(email: email);
    } on FirebaseAuthException catch (e) {
      debugPrint('Firebase Auth 错误: ${e.code} - ${e.message}');
      throw AuthException(
        _mapAuthErrorCodeToMessage(e.code),
        code: e.code,
        originalError: e,
      );
    } catch (e) {
      debugPrint('重置密码时发生未知错误: $e');
      throw AuthException(
        '发生未知错误，请稍后重试',
        originalError: e,
      );
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
      // 不抛出异常，因为这是次要操作
    }
  }

  /// 获取用户数据
  Future<Map<String, dynamic>?> getUserData(String uid) async {
    if (_firestore == null) {
      throw ServiceUnavailableException('数据库服务未初始化');
    }
    
    try {
      final doc = await _firestore!.collection('users').doc(uid).get();
      return doc.data();
    } catch (e) {
      debugPrint('获取用户数据失败: $e');
      throw FirestoreException(
        '获取用户数据失败',
        originalError: e,
      );
    }
  }

  /// 更新学习进度
  Future<void> updateLearningProgress({
    required String userId,
    required String algorithmType,
    required Map<String, dynamic> progress,
  }) async {
    if (_firestore == null) {
      throw ServiceUnavailableException('数据库服务未初始化');
    }
    
    try {
      await _firestore!.collection('users').doc(userId).update({
        'learning_progress.$algorithmType': progress,
        'lastUpdated': FieldValue.serverTimestamp(),
      });
    } catch (e) {
      debugPrint('更新学习进度失败: $e');
      throw FirestoreException(
        '更新学习进度失败',
        originalError: e,
      );
    }
  }

  /// 保存算法案例
  Future<void> saveAlgorithmCase({
    required String algorithmType,
    required List<int> inputData,
    required List<Map<String, dynamic>> steps,
    required Map<String, dynamic> metrics,
  }) async {
    if (_firestore == null) {
      throw ServiceUnavailableException('数据库服务未初始化');
    }
    
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
      throw FirestoreException(
        '保存算法案例失败',
        originalError: e,
      );
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
    if (_firestore == null) {
      throw ServiceUnavailableException('数据库服务未初始化');
    }
    
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
      throw FirestoreException(
        '保存用户提交失败',
        originalError: e,
      );
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

  // ============= 私有辅助方法 =============
  
  /// 将Firebase Auth错误码映射为用户友好的消息
  String _mapAuthErrorCodeToMessage(String code) {
    switch (code) {
      case 'weak-password':
        return '密码强度太弱，请使用至少6位字符';
      case 'email-already-in-use':
        return '该邮箱已被注册，请使用其他邮箱';
      case 'invalid-email':
        return '邮箱格式不正确';
      case 'user-not-found':
        return '用户不存在，请先注册';
      case 'wrong-password':
        return '密码错误，请重试';
      case 'user-disabled':
        return '该账户已被禁用';
      case 'too-many-requests':
        return '登录尝试次数过多，请稍后再试';
      case 'operation-not-allowed':
        return '认证方式未启用，请联系管理员';
      case 'network-request-failed':
        return '网络连接失败，请检查网络设置';
      case 'invalid-credential':
        return '登录凭证无效或已过期';
      case 'account-exists-with-different-credential':
        return '该邮箱已使用其他方式注册';
      case 'requires-recent-login':
        return '此操作需要重新登录';
      case 'email-not-verified':
        return '邮箱尚未验证，请先验证邮箱';
      case 'popup-blocked':
        return '登录弹窗被浏览器拦截，请允许弹窗后重试';
      case 'popup-closed-by-user':
        return '登录已取消';
      case 'cancelled-popup-request':
        return '已有登录在进行中，请勿重复点击';
      default:
        return '认证失败 ($code)，请检查您的网络或联系我们';
    }
  }
}
