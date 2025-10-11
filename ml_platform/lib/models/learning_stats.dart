import 'package:cloud_firestore/cloud_firestore.dart';

/// 学习统计模型
class LearningStats {
  int totalPoints;
  int streakDays;
  final int completedModules;
  final int totalStudyTime; // 分钟
  final int totalTimeSpent; // 总学习时间（秒）
  final int totalExercises; // 总练习数
  final Map<String, int> dailyTime;
  final Map<String, dynamic> moduleProgress; // 模块进度
  List<String> unlockedAchievements;
  final DateTime? lastStudyDate;
  final DateTime? lastActiveDate;

  LearningStats({
    this.totalPoints = 0,
    this.streakDays = 0,
    this.completedModules = 0,
    this.totalStudyTime = 0,
    this.totalTimeSpent = 0,
    this.totalExercises = 0,
    this.dailyTime = const {},
    this.moduleProgress = const {},
    List<String>? unlockedAchievements,
    this.lastStudyDate,
    this.lastActiveDate,
  }) : unlockedAchievements = unlockedAchievements ?? [];

  /// 从Firestore数据创建
  factory LearningStats.fromFirestore(Map<String, dynamic> data) {
    return LearningStats(
      totalPoints: data['totalPoints'] ?? 0,
      streakDays: data['streakDays'] ?? 0,
      completedModules: data['completedModules'] ?? 0,
      totalStudyTime: data['totalStudyTime'] ?? 0,
      totalTimeSpent: data['totalTimeSpent'] ?? 0,
      totalExercises: data['totalExercises'] ?? 0,
      dailyTime: Map<String, int>.from(data['dailyTime'] ?? {}),
      moduleProgress: Map<String, dynamic>.from(data['moduleProgress'] ?? {}),
      unlockedAchievements: List<String>.from(data['unlockedAchievements'] ?? []),
      lastStudyDate: data['lastStudyDate'] != null 
          ? (data['lastStudyDate'] as Timestamp).toDate()
          : null,
      lastActiveDate: data['lastActiveDate'] != null 
          ? (data['lastActiveDate'] as Timestamp).toDate()
          : null,
    );
  }

  /// 从JSON数据创建
  factory LearningStats.fromJson(Map<String, dynamic> json) {
    return LearningStats(
      totalPoints: json['totalPoints'] ?? 0,
      streakDays: json['streakDays'] ?? 0,
      completedModules: json['completedModules'] ?? 0,
      totalStudyTime: json['totalStudyTime'] ?? 0,
      totalTimeSpent: json['totalTimeSpent'] ?? 0,
      totalExercises: json['totalExercises'] ?? 0,
      dailyTime: Map<String, int>.from(json['dailyTime'] ?? {}),
      moduleProgress: Map<String, dynamic>.from(json['moduleProgress'] ?? {}),
      unlockedAchievements: List<String>.from(json['unlockedAchievements'] ?? []),
      lastStudyDate: json['lastStudyDate'] != null 
          ? DateTime.parse(json['lastStudyDate'])
          : null,
      lastActiveDate: json['lastActiveDate'] != null 
          ? DateTime.parse(json['lastActiveDate'])
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
      'totalTimeSpent': totalTimeSpent,
      'totalExercises': totalExercises,
      'dailyTime': dailyTime,
      'moduleProgress': moduleProgress,
      'unlockedAchievements': unlockedAchievements,
      'lastStudyDate': lastStudyDate != null 
          ? Timestamp.fromDate(lastStudyDate!)
          : null,
      'lastActiveDate': lastActiveDate != null 
          ? Timestamp.fromDate(lastActiveDate!)
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
