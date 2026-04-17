// 学习路径模型
import 'package:flutter/material.dart';
import 'package:ml_platform/models/quiz_model.dart';

/// 学习目标
enum LearningGoal {
  beginner('入门学习', '掌握基础算法和数据结构', Icons.school),
  interview('面试准备', '准备技术面试，重点练习常考题目', Icons.work),
  competition('竞赛训练', '提高算法竞赛能力', Icons.emoji_events),
  research('学术研究', '深入理解算法理论', Icons.science),
  practical('实际应用', '解决实际工程问题', Icons.build);
  
  final String label;
  final String description;
  final IconData icon;
  const LearningGoal(this.label, this.description, this.icon);
}

/// 学习阶段
enum LearningStage {
  foundation('基础阶段', '学习基本概念和简单算法'),
  intermediate('进阶阶段', '掌握复杂算法和优化技巧'),
  advanced('高级阶段', '深入理解高级算法和数据结构'),
  expert('专家阶段', '算法设计和创新');
  
  final String label;
  final String description;
  const LearningStage(this.label, this.description);
}

/// 学习单元
class LearningUnit {
  final String id;
  final String title;
  final String description;
  final KnowledgeCategory category;
  final LearningStage stage;
  final Duration estimatedTime;
  final List<String> prerequisites;
  final List<LearningActivity> activities;
  final List<String> learningObjectives;
  final List<String> keyPoints;
  final Map<String, dynamic>? resources;
  
  LearningUnit({
    required this.id,
    required this.title,
    required this.description,
    required this.category,
    required this.stage,
    required this.estimatedTime,
    this.prerequisites = const [],
    required this.activities,
    required this.learningObjectives,
    required this.keyPoints,
    this.resources,
  });
}

/// 学习活动
class LearningActivity {
  final String id;
  final String title;
  final ActivityType type;
  final Duration estimatedTime;
  final String description;
  final Map<String, dynamic>? parameters;
  final bool isCompleted;
  
  LearningActivity({
    required this.id,
    required this.title,
    required this.type,
    required this.estimatedTime,
    required this.description,
    this.parameters,
    this.isCompleted = false,
  });
}

/// 活动类型
enum ActivityType {
  theory('理论学习', Icons.book, Colors.blue),
  demo('演示观看', Icons.play_circle, Colors.green),
  practice('动手练习', Icons.code, Colors.orange),
  quiz('测试练习', Icons.quiz, Colors.purple),
  project('项目实践', Icons.assignment, Colors.red);
  
  final String label;
  final IconData icon;
  final Color color;
  const ActivityType(this.label, this.icon, this.color);
}

/// 学习路径
class LearningPath {
  final String id;
  final String name;
  final String description;
  final LearningGoal goal;
  final List<LearningUnit> units;
  final Duration totalTime;
  final LearningPathDifficulty difficulty;
  final List<String> tags;
  
  LearningPath({
    required this.id,
    required this.name,
    required this.description,
    required this.goal,
    required this.units,
    required this.difficulty,
    this.tags = const [],
  }) : totalTime = units.fold(Duration.zero, (sum, unit) => sum + unit.estimatedTime);
  
  /// 计算完成进度
  double getProgress(Set<String> completedUnits) {
    if (units.isEmpty) return 0.0;
    final completed = units.where((unit) => completedUnits.contains(unit.id)).length;
    return completed / units.length;
  }
  
  /// 获取下一个学习单元
  LearningUnit? getNextUnit(Set<String> completedUnits) {
    for (final unit in units) {
      if (!completedUnits.contains(unit.id)) {
        // 检查前置条件是否满足
        if (unit.prerequisites.every((prereq) => completedUnits.contains(prereq))) {
          return unit;
        }
      }
    }
    return null;
  }
}

/// 路径难度
enum LearningPathDifficulty {
  beginner('初级', Colors.green),
  intermediate('中级', Colors.orange),
  advanced('高级', Colors.red);
  
  final String label;
  final Color color;
  const LearningPathDifficulty(this.label, this.color);
}

/// 个人学习档案
class LearningProfile {
  final String userId;
  final LearningGoal primaryGoal;
  final List<LearningGoal> secondaryGoals;
  final Map<KnowledgeCategory, ProficiencyLevel> proficiency;
  final List<String> interests;
  final StudyPreferences preferences;
  final DateTime createdAt;
  DateTime updatedAt;
  
  LearningProfile({
    required this.userId,
    required this.primaryGoal,
    this.secondaryGoals = const [],
    Map<KnowledgeCategory, ProficiencyLevel>? proficiency,
    this.interests = const [],
    StudyPreferences? preferences,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) : proficiency = proficiency ?? {},
       preferences = preferences ?? StudyPreferences(),
       createdAt = createdAt ?? DateTime.now(),
       updatedAt = updatedAt ?? DateTime.now();
}

/// 熟练程度
enum ProficiencyLevel {
  novice('新手', 0, Colors.red),
  beginner('初学者', 25, Colors.orange),
  intermediate('中级', 50, Colors.yellow),
  advanced('高级', 75, Colors.lightGreen),
  expert('专家', 100, Colors.green);
  
  final String label;
  final int score;
  final Color color;
  const ProficiencyLevel(this.label, this.score, this.color);
}

/// 学习偏好
class StudyPreferences {
  final int dailyStudyTime; // 分钟
  final List<ActivityType> preferredActivityTypes;
  final bool prefersTheoryFirst;
  final bool likesInteractiveContent;
  final int difficultyProgression; // 1-5, 难度递增速度
  
  const StudyPreferences({
    this.dailyStudyTime = 30,
    this.preferredActivityTypes = const [
      ActivityType.demo,
      ActivityType.practice,
      ActivityType.quiz,
    ],
    this.prefersTheoryFirst = true,
    this.likesInteractiveContent = true,
    this.difficultyProgression = 3,
  });
}

/// 学习进度跟踪
class LearningProgress {
  final String userId;
  final String pathId;
  final Set<String> completedUnits;
  final Set<String> completedActivities;
  final Map<String, double> unitScores;
  final DateTime startDate;
  final DateTime? targetCompletionDate;
  final Map<String, DateTime> unitCompletionDates;
  final List<StudySession> studySessions;
  
  LearningProgress({
    required this.userId,
    required this.pathId,
    Set<String>? completedUnits,
    Set<String>? completedActivities,
    Map<String, double>? unitScores,
    DateTime? startDate,
    this.targetCompletionDate,
    Map<String, DateTime>? unitCompletionDates,
    List<StudySession>? studySessions,
  }) : completedUnits = completedUnits ?? {},
       completedActivities = completedActivities ?? {},
       unitScores = unitScores ?? {},
       startDate = startDate ?? DateTime.now(),
       unitCompletionDates = unitCompletionDates ?? {},
       studySessions = studySessions ?? [];
  
  /// 计算总体进度
  double getOverallProgress(LearningPath path) {
    return path.getProgress(completedUnits);
  }
  
  /// 计算平均分数
  double getAverageScore() {
    if (unitScores.isEmpty) return 0.0;
    final totalScore = unitScores.values.reduce((a, b) => a + b);
    return totalScore / unitScores.length;
  }
  
  /// 计算学习天数
  int getStudyDays() {
    return DateTime.now().difference(startDate).inDays + 1;
  }
  
  /// 计算总学习时间
  Duration getTotalStudyTime() {
    return studySessions.fold(
      Duration.zero,
      (total, session) => total + session.duration,
    );
  }
}

/// 学习会话
class StudySession {
  final String id;
  final DateTime startTime;
  final DateTime endTime;
  final String unitId;
  final List<String> activitiesCompleted;
  final Map<String, dynamic> performance;
  
  StudySession({
    required this.id,
    required this.startTime,
    required this.endTime,
    required this.unitId,
    this.activitiesCompleted = const [],
    this.performance = const {},
  });
  
  Duration get duration => endTime.difference(startTime);
}

/// 学习建议
class LearningRecommendation {
  final RecommendationType type;
  final String title;
  final String description;
  final String actionText;
  final Map<String, dynamic>? actionData;
  final int priority; // 1-5, 5为最高优先级
  
  LearningRecommendation({
    required this.type,
    required this.title,
    required this.description,
    required this.actionText,
    this.actionData,
    this.priority = 3,
  });
}

/// 推荐类型
enum RecommendationType {
  nextUnit('下一单元'),
  review('复习建议'),
  practice('练习推荐'),
  adjustment('学习调整');
  
  final String label;
  const RecommendationType(this.label);
}

/// 学习统计
class LearningStatistics {
  final int totalUnitsCompleted;
  final int totalActivitiesCompleted;
  final Duration totalStudyTime;
  final double averageScore;
  final Map<KnowledgeCategory, int> categoryProgress;
  final Map<ActivityType, int> activityTypeCount;
  final List<DateTime> studyDates;
  final double consistency; // 学习一致性评分 0-100
  
  LearningStatistics({
    required this.totalUnitsCompleted,
    required this.totalActivitiesCompleted,
    required this.totalStudyTime,
    required this.averageScore,
    this.categoryProgress = const {},
    this.activityTypeCount = const {},
    this.studyDates = const [],
    this.consistency = 0.0,
  });
  
  /// 计算学习效率（完成单元数/学习时间）
  double get efficiency {
    if (totalStudyTime.inHours == 0) return 0.0;
    return totalUnitsCompleted / totalStudyTime.inHours;
  }
  
  /// 计算学习强度（平均每日学习时间）
  double get intensity {
    if (studyDates.isEmpty) return 0.0;
    final daySpan = studyDates.last.difference(studyDates.first).inDays + 1;
    return totalStudyTime.inMinutes / daySpan;
  }
}
