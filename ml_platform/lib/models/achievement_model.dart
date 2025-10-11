import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

/// 成就模型
class Achievement {
  final String id;
  final String name;
  final String description;
  final String iconUrl;
  final String category;
  final int points;
  final Map<String, dynamic> criteria;
  final DateTime? unlockedAt;
  final int totalRequired;
  final int currentProgress;

  Achievement({
    required this.id,
    required this.name,
    required this.description,
    required this.iconUrl,
    required this.category,
    this.points = 10,
    required this.criteria,
    this.unlockedAt,
    this.totalRequired = 1,
    this.currentProgress = 0,
  });

  bool get isUnlocked => unlockedAt != null;
  
  double get progressPercentage {
    if (totalRequired == 0) return 1.0;
    return (currentProgress / totalRequired).clamp(0.0, 1.0);
  }

  factory Achievement.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return Achievement(
      id: doc.id,
      name: data['name'] ?? '',
      description: data['description'] ?? '',
      iconUrl: data['iconUrl'] ?? '',
      category: data['category'] ?? 'general',
      points: data['points'] ?? 10,
      criteria: data['criteria'] ?? {},
      unlockedAt: data['unlockedAt']?.toDate(),
      totalRequired: data['totalRequired'] ?? 1,
      currentProgress: data['currentProgress'] ?? 0,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'name': name,
      'description': description,
      'iconUrl': iconUrl,
      'category': category,
      'points': points,
      'criteria': criteria,
      'unlockedAt': unlockedAt != null ? Timestamp.fromDate(unlockedAt!) : null,
      'totalRequired': totalRequired,
      'currentProgress': currentProgress,
    };
  }

  Achievement copyWith({
    String? id,
    String? name,
    String? description,
    String? iconUrl,
    String? category,
    int? points,
    Map<String, dynamic>? criteria,
    DateTime? unlockedAt,
    int? totalRequired,
    int? currentProgress,
  }) {
    return Achievement(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      iconUrl: iconUrl ?? this.iconUrl,
      category: category ?? this.category,
      points: points ?? this.points,
      criteria: criteria ?? this.criteria,
      unlockedAt: unlockedAt ?? this.unlockedAt,
      totalRequired: totalRequired ?? this.totalRequired,
      currentProgress: currentProgress ?? this.currentProgress,
    );
  }
}

/// 学习统计
class LearningStats {
  final int totalTimeSpent; // 总学习时间（分钟）
  final int completedModules; // 完成的模块数
  final int totalExercises; // 总练习次数
  final int streakDays; // 连续学习天数
  final Map<String, int> moduleProgress; // 各模块进度
  final Map<String, int> dailyTime; // 每日学习时间
  final List<String> unlockedAchievements; // 已解锁成就ID列表
  final int totalPoints; // 总积分
  final DateTime lastActiveDate; // 最后活跃日期

  LearningStats({
    this.totalTimeSpent = 0,
    this.completedModules = 0,
    this.totalExercises = 0,
    this.streakDays = 0,
    Map<String, int>? moduleProgress,
    Map<String, int>? dailyTime,
    List<String>? unlockedAchievements,
    this.totalPoints = 0,
    DateTime? lastActiveDate,
  }) : moduleProgress = moduleProgress ?? {},
        dailyTime = dailyTime ?? {},
        unlockedAchievements = unlockedAchievements ?? [],
        lastActiveDate = lastActiveDate ?? DateTime.now();

  factory LearningStats.fromFirestore(Map<String, dynamic> data) {
    return LearningStats(
      totalTimeSpent: data['totalTimeSpent'] ?? 0,
      completedModules: data['completedModules'] ?? 0,
      totalExercises: data['totalExercises'] ?? 0,
      streakDays: data['streakDays'] ?? 0,
      moduleProgress: Map<String, int>.from(data['moduleProgress'] ?? {}),
      dailyTime: Map<String, int>.from(data['dailyTime'] ?? {}),
      unlockedAchievements: List<String>.from(data['unlockedAchievements'] ?? []),
      totalPoints: data['totalPoints'] ?? 0,
      lastActiveDate: data['lastActiveDate']?.toDate() ?? DateTime.now(),
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'totalTimeSpent': totalTimeSpent,
      'completedModules': completedModules,
      'totalExercises': totalExercises,
      'streakDays': streakDays,
      'moduleProgress': moduleProgress,
      'dailyTime': dailyTime,
      'unlockedAchievements': unlockedAchievements,
      'totalPoints': totalPoints,
      'lastActiveDate': Timestamp.fromDate(lastActiveDate),
    };
  }

  LearningStats copyWith({
    int? totalTimeSpent,
    int? completedModules,
    int? totalExercises,
    int? streakDays,
    Map<String, int>? moduleProgress,
    Map<String, int>? dailyTime,
    List<String>? unlockedAchievements,
    int? totalPoints,
    DateTime? lastActiveDate,
  }) {
    return LearningStats(
      totalTimeSpent: totalTimeSpent ?? this.totalTimeSpent,
      completedModules: completedModules ?? this.completedModules,
      totalExercises: totalExercises ?? this.totalExercises,
      streakDays: streakDays ?? this.streakDays,
      moduleProgress: moduleProgress ?? this.moduleProgress,
      dailyTime: dailyTime ?? this.dailyTime,
      unlockedAchievements: unlockedAchievements ?? this.unlockedAchievements,
      totalPoints: totalPoints ?? this.totalPoints,
      lastActiveDate: lastActiveDate ?? this.lastActiveDate,
    );
  }
}

/// 成就类别
class AchievementCategory {
  static const String algorithm = 'algorithm';
  static const String dataStructure = 'dataStructure';
  static const String os = 'os';
  static const String network = 'network';
  static const String ml = 'ml';
  static const String general = 'general';
  static const String special = 'special';
  
  static String getCategoryName(String category) {
    switch (category) {
      case algorithm:
        return '算法大师';
      case dataStructure:
        return '数据结构';
      case os:
        return '操作系统';
      case network:
        return '网络协议';
      case ml:
        return '机器学习';
      case general:
        return '通用成就';
      case special:
        return '特殊成就';
      default:
        return '其他';
    }
  }
  
  static IconData getCategoryIcon(String category) {
    switch (category) {
      case algorithm:
        return Icons.sort;
      case dataStructure:
        return Icons.account_tree;
      case os:
        return Icons.computer;
      case network:
        return Icons.lan;
      case ml:
        return Icons.psychology;
      case general:
        return Icons.star;
      case special:
        return Icons.emoji_events;
      default:
        return Icons.help_outline;
    }
  }
  
  static Color getCategoryColor(String category) {
    switch (category) {
      case algorithm:
        return Colors.blue;
      case dataStructure:
        return Colors.green;
      case os:
        return Colors.purple;
      case network:
        return Colors.indigo;
      case ml:
        return Colors.deepOrange;
      case general:
        return Colors.amber;
      case special:
        return Colors.pink;
      default:
        return Colors.grey;
    }
  }
}

/// 预定义成就列表
class PredefinedAchievements {
  static List<Achievement> get all => [
    // 算法成就
    Achievement(
      id: 'FIRST_SORT',
      name: '排序入门',
      description: '完成第一个排序算法',
      iconUrl: 'assets/achievements/first_sort.png',
      category: AchievementCategory.algorithm,
      points: 10,
      criteria: {'type': 'sorting', 'count': 1},
    ),
    Achievement(
      id: 'SORT_MASTER',
      name: '排序大师',
      description: '掌握所有排序算法',
      iconUrl: 'assets/achievements/sort_master.png',
      category: AchievementCategory.algorithm,
      points: 50,
      criteria: {'type': 'sorting', 'count': 10},
      totalRequired: 10,
    ),
    
    // 数据结构成就
    Achievement(
      id: 'TREE_EXPLORER',
      name: '树形探索者',
      description: '完成5次树结构操作',
      iconUrl: 'assets/achievements/tree_explorer.png',
      category: AchievementCategory.dataStructure,
      points: 20,
      criteria: {'type': 'tree', 'count': 5},
      totalRequired: 5,
    ),
    Achievement(
      id: 'GRAPH_NAVIGATOR',
      name: '图算法导航员',
      description: '完成所有图算法演示',
      iconUrl: 'assets/achievements/graph_navigator.png',
      category: AchievementCategory.dataStructure,
      points: 30,
      criteria: {'type': 'graph', 'count': 5},
      totalRequired: 5,
    ),
    
    // 操作系统成就
    Achievement(
      id: 'PROCESS_SCHEDULER',
      name: '进程调度专家',
      description: '完成所有进程调度算法',
      iconUrl: 'assets/achievements/process_scheduler.png',
      category: AchievementCategory.os,
      points: 30,
      criteria: {'type': 'os_scheduling', 'count': 4},
      totalRequired: 4,
    ),
    Achievement(
      id: 'MEMORY_MANAGER',
      name: '内存管理大师',
      description: '掌握内存管理算法',
      iconUrl: 'assets/achievements/memory_manager.png',
      category: AchievementCategory.os,
      points: 30,
      criteria: {'type': 'os_memory', 'count': 3},
      totalRequired: 3,
    ),
    
    // 网络协议成就
    Achievement(
      id: 'TCP_EXPERT',
      name: 'TCP专家',
      description: '完成TCP协议所有演示',
      iconUrl: 'assets/achievements/tcp_expert.png',
      category: AchievementCategory.network,
      points: 25,
      criteria: {'type': 'tcp', 'count': 3},
      totalRequired: 3,
    ),
    Achievement(
      id: 'ROUTING_MASTER',
      name: '路由大师',
      description: '完成10次路由模拟',
      iconUrl: 'assets/achievements/routing_master.png',
      category: AchievementCategory.network,
      points: 30,
      criteria: {'type': 'routing', 'count': 10},
      totalRequired: 10,
    ),
    
    // 机器学习成就
    Achievement(
      id: 'FIRST_ML_EXPERIMENT',
      name: 'ML初体验',
      description: '完成第一次机器学习实验',
      iconUrl: 'assets/achievements/first_ml.png',
      category: AchievementCategory.ml,
      points: 15,
      criteria: {'type': 'ml_train', 'count': 1},
    ),
    Achievement(
      id: 'ML_RESEARCHER',
      name: 'ML研究员',
      description: '完成10次不同的ML实验',
      iconUrl: 'assets/achievements/ml_researcher.png',
      category: AchievementCategory.ml,
      points: 50,
      criteria: {'type': 'ml_train', 'count': 10},
      totalRequired: 10,
    ),
    
    // 通用成就
    Achievement(
      id: 'FIRST_DAY',
      name: '学习启航',
      description: '开始使用平台学习',
      iconUrl: 'assets/achievements/first_day.png',
      category: AchievementCategory.general,
      points: 5,
      criteria: {'type': 'login', 'count': 1},
    ),
    Achievement(
      id: 'WEEK_STREAK',
      name: '连续一周',
      description: '连续学习7天',
      iconUrl: 'assets/achievements/week_streak.png',
      category: AchievementCategory.general,
      points: 20,
      criteria: {'type': 'streak', 'days': 7},
      totalRequired: 7,
    ),
    Achievement(
      id: 'MONTH_STREAK',
      name: '学习之星',
      description: '连续学习30天',
      iconUrl: 'assets/achievements/month_streak.png',
      category: AchievementCategory.general,
      points: 100,
      criteria: {'type': 'streak', 'days': 30},
      totalRequired: 30,
    ),
    Achievement(
      id: 'NIGHT_OWL',
      name: '夜猫子',
      description: '深夜学习（23:00后）',
      iconUrl: 'assets/achievements/night_owl.png',
      category: AchievementCategory.special,
      points: 10,
      criteria: {'type': 'time', 'hour': 23},
    ),
    Achievement(
      id: 'EARLY_BIRD',
      name: '早起鸟',
      description: '清晨学习（6:00前）',
      iconUrl: 'assets/achievements/early_bird.png',
      category: AchievementCategory.special,
      points: 10,
      criteria: {'type': 'time', 'hour': 6},
    ),
    Achievement(
      id: 'COMPLETIONIST',
      name: '完美主义者',
      description: '完成所有模块的学习',
      iconUrl: 'assets/achievements/completionist.png',
      category: AchievementCategory.special,
      points: 200,
      criteria: {'type': 'complete_all', 'modules': 5},
      totalRequired: 5,
    ),
  ];
  
  static Achievement? getById(String id) {
    try {
      return all.firstWhere((a) => a.id == id);
    } catch (e) {
      return null;
    }
  }
  
  static List<Achievement> getByCategory(String category) {
    return all.where((a) => a.category == category).toList();
  }
}
