import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../models/learning_stats.dart';
import '../models/achievement_model.dart';
import '../utils/app_exceptions.dart';
/// 成就系统服务
class AchievementService {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseAuth _auth = FirebaseAuth.instance;

  /// 获取用户统计数据
  Future<LearningStats> getUserStats() async {
    final userId = _auth.currentUser?.uid;
    if (userId == null) {
      return LearningStats();
    }

    try {
      final doc = await _firestore.collection('users').doc(userId).get();
      if (doc.exists && doc.data()!.containsKey('learning_stats')) {
        return LearningStats.fromFirestore(doc.data()!);
      } else {
        // 如果用户第一次使用，创建默认统计
        final defaultStats = LearningStats();
        await _firestore.collection('users').doc(userId).set({
          'learning_stats': defaultStats.toFirestore(),
        }, SetOptions(merge: true));
        return defaultStats;
      }
    } catch (e) {
      throw FirestoreException('获取用户学习统计失败', originalError: e);
    }
  }

  /// 更新用户统计数据
  Future<void> updateLearningStats(LearningStats stats) async {
    final userId = _auth.currentUser?.uid;
    if (userId == null) return;

    try {
      await _firestore.collection('users').doc(userId).update({
        'learning_stats': stats.toFirestore(),
      });
    } catch (e) {
      // 如果文档不存在，创建它
      await _firestore.collection('users').doc(userId).set({
        'learning_stats': stats.toFirestore(),
      }, SetOptions(merge: true));
    }
  }

  /// 获取用户成就列表
  Future<List<Achievement>> getUserAchievements() async {
    final userId = _auth.currentUser?.uid;
    if (userId == null) return [];

    try {
      final stats = await getUserStats();
      final allAchievements = PredefinedAchievements.all;
      
      // 标记已解锁的成就
      return allAchievements.map((achievement) {
        if (stats.unlockedAchievements.contains(achievement.id)) {
          return achievement.copyWith(
            unlockedAt: DateTime.now(), // 实际应该从数据库获取解锁时间
          );
        }
        return achievement;
      }).toList();
    } catch (e) {
      throw FirestoreException('获取用户成就失败', originalError: e);
    }
  }

  /// 检查并解锁成就
  Future<List<Achievement>> checkAndUnlockAchievements({
    required String type,
    Map<String, dynamic>? metadata,
  }) async {
    final userId = _auth.currentUser?.uid;
    if (userId == null) return [];

    final stats = await getUserStats();
    final unlockedAchievements = <Achievement>[];

    // 检查每个成就的解锁条件
    for (final achievement in PredefinedAchievements.all) {
      // 跳过已解锁的成就
      if (stats.unlockedAchievements.contains(achievement.id)) {
        continue;
      }

      // 检查成就条件
      bool shouldUnlock = false;
      final criteria = achievement.criteria;

      switch (criteria['type']) {
        case 'sorting':
        case 'tree':
        case 'graph':
        case 'os_scheduling':
        case 'os_memory':
        case 'tcp':
        case 'routing':
        case 'ml_train':
          if (type == criteria['type']) {
            // 更新进度
            final progressKey = 'progress_${achievement.id}';
            final currentProgress = (metadata?[progressKey] ?? 0) + 1;
            
            if (currentProgress >= (criteria['count'] ?? 1)) {
              shouldUnlock = true;
            }
          }
          break;

        case 'streak':
          if (type == 'daily_login') {
            if (stats.streakDays >= (criteria['days'] ?? 1)) {
              shouldUnlock = true;
            }
          }
          break;

        case 'time':
          if (type == 'study_time') {
            final hour = DateTime.now().hour;
            if (criteria['hour'] != null) {
              if (criteria['hour'] >= 23 && hour >= 23) {
                shouldUnlock = true; // 夜猫子
              } else if (criteria['hour'] <= 6 && hour <= 6) {
                shouldUnlock = true; // 早起鸟
              }
            }
          }
          break;

        case 'complete_all':
          if (type == 'module_complete') {
            if (stats.completedModules >= (criteria['modules'] ?? 5)) {
              shouldUnlock = true;
            }
          }
          break;

        case 'login':
          if (type == 'first_login') {
            shouldUnlock = true;
          }
          break;
      }

      if (shouldUnlock) {
        unlockedAchievements.add(achievement);
        
        // 更新用户统计
        stats.unlockedAchievements.add(achievement.id);
        stats.totalPoints += achievement.points;
      }
    }

    // 保存更新后的统计
    if (unlockedAchievements.isNotEmpty) {
      await updateLearningStats(stats);
      
      // 记录成就解锁事件
      for (final achievement in unlockedAchievements) {
        await _recordAchievementUnlock(achievement);
      }
    }

    return unlockedAchievements;
  }

  /// 记录成就解锁
  Future<void> _recordAchievementUnlock(Achievement achievement) async {
    final userId = _auth.currentUser?.uid;
    if (userId == null) return;

    try {
      await _firestore.collection('achievement_unlocks').add({
        'userId': userId,
        'achievementId': achievement.id,
        'unlockedAt': FieldValue.serverTimestamp(),
        'points': achievement.points,
      });
    } catch (e) {
      throw FirestoreException('记录成就解锁失败', originalError: e);
    }
  }

  /// 增加学习时间
  Future<void> addStudyTime(int minutes, String module) async {
    final stats = await getUserStats();
    final today = DateTime.now().toIso8601String().split('T')[0];
    
    // 更新总时间
    final newStats = stats.copyWith(
      totalStudyTime: stats.totalStudyTime + minutes,
      dailyTime: {
        ...stats.dailyTime,
        today: (stats.dailyTime[today] ?? 0) + minutes,
      },
      lastStudyDate: DateTime.now(),
    );

    // 注意：newStats是不可变的，需要重新创建
    LearningStats finalStats = newStats;
    if (stats.lastActiveDate != null && _isNewDay(stats.lastActiveDate!)) {
      if (_isConsecutiveDay(stats.lastActiveDate!)) {
        finalStats = newStats.copyWith(streakDays: newStats.streakDays + 1);
      } else {
        finalStats = newStats.copyWith(streakDays: 1);
      }
    }

    await updateLearningStats(finalStats);
    
    // 检查时间相关成就
    await checkAndUnlockAchievements(
      type: 'study_time',
      metadata: {'minutes': minutes, 'module': module},
    );
  }

  /// 增加练习次数
  Future<void> incrementExerciseCount(String type) async {
    final stats = await getUserStats();
    // 创建更新后的统计实例
    final newStats = LearningStats(
      totalPoints: stats.totalPoints,
      streakDays: stats.streakDays,
      completedModules: stats.completedModules,
      totalStudyTime: stats.totalStudyTime,
      totalTimeSpent: stats.totalTimeSpent,
      totalExercises: stats.totalExercises + 1,
      dailyTime: stats.dailyTime,
      moduleProgress: stats.moduleProgress,
      unlockedAchievements: stats.unlockedAchievements,
      lastStudyDate: stats.lastStudyDate,
      lastActiveDate: stats.lastActiveDate,
    );
    
    await updateLearningStats(newStats);
    
    // 检查相关成就
    await checkAndUnlockAchievements(
      type: type,
      metadata: {'count': stats.totalExercises + 1},
    );
  }

  /// 标记模块完成
  Future<void> markModuleComplete(String module) async {
    final stats = await getUserStats();
    final newStats = stats.copyWith(
      completedModules: stats.completedModules + 1,
    );
    
    await updateLearningStats(newStats);
    
    // 检查完成相关成就
    await checkAndUnlockAchievements(
      type: 'module_complete',
      metadata: {'module': module},
    );
  }

  /// 获取排行榜
  Future<List<Map<String, dynamic>>> getLeaderboard({int limit = 10}) async {
    try {
      final query = await _firestore
          .collection('users')
          .orderBy('learning_stats.totalPoints', descending: true)
          .limit(limit)
          .get();

      return query.docs.map((doc) {
        final data = doc.data();
        final stats = data['learning_stats'] ?? {};
        return {
          'userId': doc.id,
          'displayName': data['displayName'] ?? 'Anonymous',
          'photoUrl': data['photoUrl'],
          'totalPoints': stats['totalPoints'] ?? 0,
          'streakDays': stats['streakDays'] ?? 0,
          'completedModules': stats['completedModules'] ?? 0,
        };
      }).toList();
    } catch (e) {
      throw FirestoreException('获取排行榜失败', originalError: e);
    }
  }

  /// 获取学习活动热力图数据
  Future<Map<DateTime, int>> getActivityHeatmap({int days = 30}) async {
    final stats = await getUserStats();
    final heatmap = <DateTime, int>{};
    
    // 转换每日时间数据
    stats.dailyTime.forEach((dateStr, minutes) {
      try {
        final date = DateTime.parse(dateStr);
        heatmap[date] = minutes;
      } catch (e) {
        // 忽略解析错误
      }
    });
    
    return heatmap;
  }

  /// 获取模块进度百分比
  Future<Map<String, double>> getModuleProgressPercentage() async {
    final stats = await getUserStats();
    final totalGoal = {
      'algorithm': 300, // 5小时
      'dataStructure': 300,
      'os': 240, // 4小时
      'network': 180, // 3小时
      'ml': 240,
    };
    
    final progress = <String, double>{};
    totalGoal.forEach((module, goal) {
      final current = stats.moduleProgress[module] ?? 0;
      progress[module] = (current / goal).clamp(0.0, 1.0);
    });
    
    return progress;
  }

  /// 检查是否是新的一天
  bool _isNewDay(DateTime lastActive) {
    final now = DateTime.now();
    return now.day != lastActive.day ||
           now.month != lastActive.month ||
           now.year != lastActive.year;
  }

  /// 检查是否是连续的一天
  bool _isConsecutiveDay(DateTime lastActive) {
    final now = DateTime.now();
    final difference = now.difference(lastActive).inDays;
    return difference == 1;
  }

  /// 初始化新用户
  Future<void> initializeNewUser() async {
    final userId = _auth.currentUser?.uid;
    if (userId == null) return;

    // 检查用户是否已存在
    final doc = await _firestore.collection('users').doc(userId).get();
    if (!doc.exists || !doc.data()!.containsKey('learning_stats')) {
      // 创建初始统计
      final initialStats = LearningStats(
        lastActiveDate: DateTime.now(),
      );
      
      await _firestore.collection('users').doc(userId).set({
        'learning_stats': initialStats.toFirestore(),
        'createdAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
      
      // 解锁第一个成就
      await checkAndUnlockAchievements(type: 'first_login');
    }
  }
}
