import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/tutorial_model.dart';
import '../utils/app_exceptions.dart';

/// 教程服务
class TutorialService {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  
  // 缓存教程内容
  final Map<String, Tutorial> _tutorialCache = {};
  
  /// 获取教程
  Future<Tutorial?> getTutorial(String tutorialId) async {
    // 检查缓存
    if (_tutorialCache.containsKey(tutorialId)) {
      return _tutorialCache[tutorialId];
    }
    
    try {
      // 首先尝试从预定义教程获取
      final tutorial = _getPredefinedTutorial(tutorialId);
      if (tutorial != null) {
        _tutorialCache[tutorialId] = tutorial;
        return tutorial;
      }
      
      // 从Firestore获取
      final doc = await _firestore
          .collection('tutorials')
          .doc(tutorialId)
          .get();
      
      if (doc.exists) {
        final tutorial = Tutorial.fromFirestore(doc);
        _tutorialCache[tutorialId] = tutorial;
        return tutorial;
      }
      
      return null;
    } catch (e) {
      throw FirestoreException('获取教程信息失败', originalError: e);
    }
  }
  
  /// 获取预定义教程
  Tutorial? _getPredefinedTutorial(String tutorialId) {
    switch (tutorialId) {
      case 'sorting_bubblesort':
        return PredefinedTutorials.bubbleSortTutorial;
      case 'network_tcp_handshake':
        return PredefinedTutorials.tcpHandshakeTutorial;
      default:
        return null;
    }
  }
  
  /// 获取分类下的所有教程
  Future<List<Tutorial>> getTutorialsByCategory(String category) async {
    try {
      final query = await _firestore
          .collection('tutorials')
          .where('category', isEqualTo: category)
          .orderBy('difficulty')
          .get();
      
      return query.docs
          .map((doc) => Tutorial.fromFirestore(doc))
          .toList();
    } catch (e) {
      throw FirestoreException('获取分类教程列表失败', originalError: e);
    }
  }
  
  /// 保存教程进度
  Future<void> saveTutorialProgress({
    required String userId,
    required String tutorialId,
    required int currentStep,
    required double completionPercentage,
  }) async {
    try {
      await _firestore
          .collection('user_tutorial_progress')
          .doc('${userId}_$tutorialId')
          .set({
        'userId': userId,
        'tutorialId': tutorialId,
        'currentStep': currentStep,
        'completionPercentage': completionPercentage,
        'lastUpdated': FieldValue.serverTimestamp(),
      });
    } catch (e) {
      throw FirestoreException('保存教程进度失败', originalError: e);
    }
  }
  
  /// 获取教程进度
  Future<Map<String, dynamic>?> getTutorialProgress({
    required String userId,
    required String tutorialId,
  }) async {
    try {
      final doc = await _firestore
          .collection('user_tutorial_progress')
          .doc('${userId}_$tutorialId')
          .get();
      
      if (doc.exists) {
        return doc.data();
      }
      return null;
    } catch (e) {
      throw FirestoreException('获取教程进度失败', originalError: e);
    }
  }
  
  /// 创建或更新教程
  Future<void> saveTutorial(Tutorial tutorial) async {
    try {
      await _firestore
          .collection('tutorials')
          .doc(tutorial.id)
          .set(tutorial.toFirestore());
      
      // 清除缓存
      _tutorialCache.remove(tutorial.id);
    } catch (e) {
      throw FirestoreException('保存教程失败', originalError: e);
    }
  }
}
