import 'package:cloud_firestore/cloud_firestore.dart';

/// 学习统计模型
class LearningStats {
  final int totalPoints;
  final int streakDays;
  final int completedModules;
  final int totalStudyTime; // 分钟
  final Map<String, int> dailyTime;
  final List<String> unlockedAchievements;
  final DateTime? lastStudyDate;

  LearningStats({
    this.totalPoints = 0,
    this.streakDays = 0,
    this.completedModules = 0,
    this.totalStudyTime = 0,
    this.dailyTime = const {},
    this.unlockedAchievements = const [],
    this.lastStudyDate,
  });

  /// 从Firestore数据创建
  factory LearningStats.fromFirestore(Map<String, dynamic> data) {
    return LearningStats(
      totalPoints: data['totalPoints'] ?? 0,
      streakDays: data['streakDays'] ?? 0,
      completedModules: data['completedModules'] ?? 0,
      totalStudyTime: data['totalStudyTime'] ?? 0,
      dailyTime: Map<String, int>.from(data['dailyTime'] ?? {}),
      unlockedAchievements: List<String>.from(data['unlockedAchievements'] ?? []),
      lastStudyDate: data['lastStudyDate'] != null 
          ? (data['lastStudyDate'] as Timestamp).toDate()
          : null,
    );
  }

  /// 转换为Firestore数据
  Map<String, dynamic> toFirestore() {
    return {
      'totalPoints': totalPoints,
      'streakDays': streakDays,
      'completedModules': completedModules,
      'totalStudyTime': totalStudyTime,
      'dailyTime': dailyTime,
      'unlockedAchievements': unlockedAchievements,
      'lastStudyDate': lastStudyDate != null 
          ? Timestamp.fromDate(lastStudyDate!)
          : null,
    };
  }

  /// 复制并修改部分属性
  LearningStats copyWith({
    int? totalPoints,
    int? streakDays,
    int? completedModules,
    int? totalStudyTime,
    Map<String, int>? dailyTime,
    List<String>? unlockedAchievements,
    DateTime? lastStudyDate,
  }) {
    return LearningStats(
      totalPoints: totalPoints ?? this.totalPoints,
      streakDays: streakDays ?? this.streakDays,
      completedModules: completedModules ?? this.completedModules,
      totalStudyTime: totalStudyTime ?? this.totalStudyTime,
      dailyTime: dailyTime ?? this.dailyTime,
      unlockedAchievements: unlockedAchievements ?? this.unlockedAchievements,
      lastStudyDate: lastStudyDate ?? this.lastStudyDate,
    );
  }
}
