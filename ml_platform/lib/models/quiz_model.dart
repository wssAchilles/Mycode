// 练习题系统模型
import 'package:flutter/material.dart';

/// 题目类型
enum QuestionType {
  multipleChoice('选择题', Icons.radio_button_checked),
  trueFalse('判断题', Icons.check_box),
  fillInBlank('填空题', Icons.text_fields),
  coding('编程题', Icons.code),
  visualization('可视化题', Icons.timeline),
  analysis('分析题', Icons.analytics);
  
  final String label;
  final IconData icon;
  const QuestionType(this.label, this.icon);
}

/// 难度级别
enum QuestionDifficulty {
  easy('简单', Colors.green),
  medium('中等', Colors.orange),
  hard('困难', Colors.red),
  expert('专家', Colors.purple);
  
  final String label;
  final Color color;
  const QuestionDifficulty(this.label, this.color);
}

/// 知识点分类
enum KnowledgeCategory {
  sorting('排序算法'),
  searching('查找算法'),
  dataStructure('数据结构'),
  graph('图算法'),
  tree('树算法'),
  scheduling('进程调度'),
  memory('内存管理'),
  complexity('算法复杂度'),
  recursion('递归算法'),
  dynamic('动态规划');
  
  final String label;
  const KnowledgeCategory(this.label);
}

/// 练习题目
class QuizQuestion {
  final String id;
  final String title;
  final String content;
  final QuestionType type;
  final QuestionDifficulty difficulty;
  final KnowledgeCategory category;
  final List<String> tags;
  final QuizOptions options;
  final String explanation;
  final List<String> hints;
  final int timeLimit; // 秒数，0表示无限制
  final int points; // 分值
  
  QuizQuestion({
    required this.id,
    required this.title,
    required this.content,
    required this.type,
    required this.difficulty,
    required this.category,
    this.tags = const [],
    required this.options,
    required this.explanation,
    this.hints = const [],
    this.timeLimit = 0,
    this.points = 10,
  });
}

/// 题目选项/答案
class QuizOptions {
  final List<String>? choices; // 选择题选项
  final bool? correctBoolean; // 判断题答案
  final List<String>? correctAnswers; // 填空题答案（支持多个正确答案）
  final String? codeTemplate; // 编程题模板
  final String? correctCode; // 编程题参考答案
  final Map<String, dynamic>? visualizationData; // 可视化题数据
  final int? correctChoiceIndex; // 选择题正确答案索引
  
  QuizOptions({
    this.choices,
    this.correctBoolean,
    this.correctAnswers,
    this.codeTemplate,
    this.correctCode,
    this.visualizationData,
    this.correctChoiceIndex,
  });
}

/// 用户答题记录
class UserAnswer {
  final String questionId;
  final DateTime timestamp;
  final dynamic userAnswer; // 可以是索引、布尔值、字符串或代码
  final bool isCorrect;
  final int timeSpent; // 用时（秒）
  final int hintsUsed; // 使用的提示数量
  
  UserAnswer({
    required this.questionId,
    required this.timestamp,
    required this.userAnswer,
    required this.isCorrect,
    required this.timeSpent,
    this.hintsUsed = 0,
  });
}

/// 练习会话
class QuizSession {
  final String id;
  final String title;
  final List<QuizQuestion> questions;
  final Map<String, UserAnswer> answers;
  final DateTime startTime;
  DateTime? endTime;
  final QuizMode mode;
  final QuizSettings settings;
  
  QuizSession({
    required this.id,
    required this.title,
    required this.questions,
    Map<String, UserAnswer>? answers,
    DateTime? startTime,
    this.endTime,
    this.mode = QuizMode.practice,
    QuizSettings? settings,
  }) : answers = answers ?? {},
       startTime = startTime ?? DateTime.now(),
       settings = settings ?? QuizSettings();
  
  /// 计算得分
  double get score {
    if (questions.isEmpty) return 0;
    
    int totalPoints = questions.fold(0, (sum, q) => sum + q.points);
    int earnedPoints = 0;
    
    for (final question in questions) {
      final answer = answers[question.id];
      if (answer?.isCorrect == true) {
        earnedPoints += question.points;
      }
    }
    
    return totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;
  }
  
  /// 计算准确率
  double get accuracy {
    if (answers.isEmpty) return 0;
    
    int correctCount = answers.values.where((a) => a.isCorrect).length;
    return (correctCount / answers.length) * 100;
  }
  
  /// 计算平均用时
  double get averageTime {
    if (answers.isEmpty) return 0;
    
    int totalTime = answers.values.fold(0, (sum, a) => sum + a.timeSpent);
    return totalTime / answers.length;
  }
  
  /// 是否已完成
  bool get isCompleted => answers.length == questions.length;
  
  /// 会话持续时间
  Duration get duration {
    final end = endTime ?? DateTime.now();
    return end.difference(startTime);
  }
}

/// 练习模式
enum QuizMode {
  practice('练习模式'),
  test('测试模式'),
  challenge('挑战模式'),
  review('复习模式');
  
  final String label;
  const QuizMode(this.label);
}

/// 练习设置
class QuizSettings {
  final bool showHints;
  final bool showExplanation;
  final bool allowRetry;
  final bool shuffleQuestions;
  final bool shuffleChoices;
  final int? questionLimit;
  final List<QuestionDifficulty>? difficultyFilter;
  final List<KnowledgeCategory>? categoryFilter;
  
  const QuizSettings({
    this.showHints = true,
    this.showExplanation = true,
    this.allowRetry = true,
    this.shuffleQuestions = false,
    this.shuffleChoices = false,
    this.questionLimit,
    this.difficultyFilter,
    this.categoryFilter,
  });
}

/// 练习统计
class QuizStatistics {
  final int totalQuestions;
  final int correctAnswers;
  final int wrongAnswers;
  final double accuracy;
  final double averageScore;
  final Duration totalTime;
  final Map<KnowledgeCategory, double> categoryAccuracy;
  final Map<QuestionDifficulty, double> difficultyAccuracy;
  final List<String> weakAreas;
  final List<String> strongAreas;
  
  QuizStatistics({
    required this.totalQuestions,
    required this.correctAnswers,
    required this.wrongAnswers,
    required this.accuracy,
    required this.averageScore,
    required this.totalTime,
    this.categoryAccuracy = const {},
    this.difficultyAccuracy = const {},
    this.weakAreas = const [],
    this.strongAreas = const [],
  });
  
  factory QuizStatistics.fromSessions(List<QuizSession> sessions) {
    if (sessions.isEmpty) {
      return QuizStatistics(
        totalQuestions: 0,
        correctAnswers: 0,
        wrongAnswers: 0,
        accuracy: 0,
        averageScore: 0,
        totalTime: Duration.zero,
      );
    }
    
    int totalQuestions = 0;
    int correctAnswers = 0;
    int wrongAnswers = 0;
    double totalScore = 0;
    Duration totalTime = Duration.zero;
    
    final categoryStats = <KnowledgeCategory, List<bool>>{};
    final difficultyStats = <QuestionDifficulty, List<bool>>{};
    
    for (final session in sessions) {
      totalQuestions += session.questions.length;
      totalScore += session.score;
      totalTime += session.duration;
      
      for (final question in session.questions) {
        final answer = session.answers[question.id];
        if (answer != null) {
          if (answer.isCorrect) {
            correctAnswers++;
          } else {
            wrongAnswers++;
          }
          
          // 按分类统计
          categoryStats.putIfAbsent(question.category, () => [])
              .add(answer.isCorrect);
          difficultyStats.putIfAbsent(question.difficulty, () => [])
              .add(answer.isCorrect);
        }
      }
    }
    
    // 计算各分类准确率
    final categoryAccuracy = <KnowledgeCategory, double>{};
    final difficultyAccuracy = <QuestionDifficulty, double>{};
    
    for (final entry in categoryStats.entries) {
      final correct = entry.value.where((c) => c).length;
      categoryAccuracy[entry.key] = (correct / entry.value.length) * 100;
    }
    
    for (final entry in difficultyStats.entries) {
      final correct = entry.value.where((c) => c).length;
      difficultyAccuracy[entry.key] = (correct / entry.value.length) * 100;
    }
    
    // 识别薄弱和强项
    final weakAreas = <String>[];
    final strongAreas = <String>[];
    
    for (final entry in categoryAccuracy.entries) {
      if (entry.value < 60) {
        weakAreas.add(entry.key.label);
      } else if (entry.value >= 80) {
        strongAreas.add(entry.key.label);
      }
    }
    
    return QuizStatistics(
      totalQuestions: totalQuestions,
      correctAnswers: correctAnswers,
      wrongAnswers: wrongAnswers,
      accuracy: totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0,
      averageScore: sessions.isNotEmpty ? totalScore / sessions.length : 0,
      totalTime: totalTime,
      categoryAccuracy: categoryAccuracy,
      difficultyAccuracy: difficultyAccuracy,
      weakAreas: weakAreas,
      strongAreas: strongAreas,
    );
  }
}

/// 题目生成器配置
class QuestionGeneratorConfig {
  final KnowledgeCategory category;
  final QuestionDifficulty difficulty;
  final int count;
  final List<QuestionType> allowedTypes;
  
  const QuestionGeneratorConfig({
    required this.category,
    required this.difficulty,
    this.count = 10,
    this.allowedTypes = const [
      QuestionType.multipleChoice,
      QuestionType.trueFalse,
      QuestionType.fillInBlank,
    ],
  });
}

/// 智能推荐配置
class RecommendationConfig {
  final QuizStatistics? userStats;
  final List<KnowledgeCategory> focusAreas;
  final QuestionDifficulty targetDifficulty;
  final int questionCount;
  
  const RecommendationConfig({
    this.userStats,
    this.focusAreas = const [],
    this.targetDifficulty = QuestionDifficulty.medium,
    this.questionCount = 10,
  });
}
