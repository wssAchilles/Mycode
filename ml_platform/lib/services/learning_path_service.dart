// 学习路径服务
import 'package:ml_platform/models/learning_path_model.dart';
import 'package:ml_platform/models/quiz_model.dart';

/// 学习路径服务
class LearningPathService {
  static final LearningPathService _instance = LearningPathService._internal();
  factory LearningPathService() => _instance;
  LearningPathService._internal();
  
  /// 获取所有学习路径
  List<LearningPath> getAllLearningPaths() {
    return [
      _createBeginnerPath(),
      _createInterviewPath(),
      _createCompetitionPath(),
      _createResearchPath(),
    ];
  }
  
  /// 创建初学者路径
  LearningPath _createBeginnerPath() {
    return LearningPath(
      id: 'beginner_path',
      name: '算法与数据结构入门',
      description: '从零开始学习算法和数据结构，适合编程初学者',
      goal: LearningGoal.beginner,
      difficulty: LearningPathDifficulty.beginner,
      tags: ['基础', '入门', '数据结构', '算法'],
      units: [
        LearningUnit(
          id: 'basic_concepts',
          title: '基础概念',
          description: '了解算法和数据结构的基本概念',
          category: KnowledgeCategory.complexity,
          stage: LearningStage.foundation,
          estimatedTime: const Duration(hours: 2),
          activities: [
            LearningActivity(
              id: 'theory_intro',
              title: '什么是算法？',
              type: ActivityType.theory,
              estimatedTime: const Duration(minutes: 30),
              description: '学习算法的定义、特征和重要性',
            ),
            LearningActivity(
              id: 'complexity_intro',
              title: '时间复杂度初步',
              type: ActivityType.demo,
              estimatedTime: const Duration(minutes: 45),
              description: '通过可视化理解时间复杂度概念',
            ),
            LearningActivity(
              id: 'first_quiz',
              title: '基础概念测试',
              type: ActivityType.quiz,
              estimatedTime: const Duration(minutes: 15),
              description: '检验基础概念的掌握情况',
            ),
          ],
          learningObjectives: [
            '理解算法的基本概念',
            '掌握时间复杂度的基本概念',
            '了解算法分析的重要性',
          ],
          keyPoints: [
            '算法是解决问题的明确指令序列',
            '好的算法具有正确性、高效性和可读性',
            '时间复杂度描述算法运行时间与输入规模的关系',
          ],
        ),
        
        LearningUnit(
          id: 'basic_sorting',
          title: '基础排序算法',
          description: '学习简单的排序算法',
          category: KnowledgeCategory.sorting,
          stage: LearningStage.foundation,
          estimatedTime: const Duration(hours: 4),
          prerequisites: ['basic_concepts'],
          activities: [
            LearningActivity(
              id: 'bubble_sort_theory',
              title: '冒泡排序原理',
              type: ActivityType.theory,
              estimatedTime: const Duration(minutes: 30),
              description: '学习冒泡排序的工作原理',
            ),
            LearningActivity(
              id: 'bubble_sort_demo',
              title: '冒泡排序可视化',
              type: ActivityType.demo,
              estimatedTime: const Duration(minutes: 20),
              description: '观看冒泡排序的执行过程',
            ),
            LearningActivity(
              id: 'selection_sort_practice',
              title: '选择排序练习',
              type: ActivityType.practice,
              estimatedTime: const Duration(minutes: 45),
              description: '动手实现选择排序算法',
            ),
            LearningActivity(
              id: 'sorting_quiz',
              title: '排序算法测试',
              type: ActivityType.quiz,
              estimatedTime: const Duration(minutes: 25),
              description: '测试对基础排序算法的理解',
            ),
          ],
          learningObjectives: [
            '掌握冒泡排序和选择排序的原理',
            '能够分析简单排序算法的时间复杂度',
            '理解排序算法的稳定性概念',
          ],
          keyPoints: [
            '冒泡排序通过相邻元素比较实现排序',
            '选择排序每次选择最小元素',
            '这些算法的时间复杂度都是O(n²)',
          ],
        ),
        
        LearningUnit(
          id: 'basic_data_structures',
          title: '基础数据结构',
          description: '学习栈、队列等基础数据结构',
          category: KnowledgeCategory.dataStructure,
          stage: LearningStage.foundation,
          estimatedTime: const Duration(hours: 3),
          prerequisites: ['basic_concepts'],
          activities: [
            LearningActivity(
              id: 'stack_theory',
              title: '栈的概念与应用',
              type: ActivityType.theory,
              estimatedTime: const Duration(minutes: 40),
              description: '学习栈的LIFO特性和应用场景',
            ),
            LearningActivity(
              id: 'queue_demo',
              title: '队列操作演示',
              type: ActivityType.demo,
              estimatedTime: const Duration(minutes: 30),
              description: '观看队列的入队和出队操作',
            ),
            LearningActivity(
              id: 'stack_practice',
              title: '栈的实现练习',
              type: ActivityType.practice,
              estimatedTime: const Duration(hours: 1),
              description: '用数组实现栈数据结构',
            ),
          ],
          learningObjectives: [
            '理解栈和队列的基本概念',
            '掌握栈和队列的基本操作',
            '了解这些数据结构的应用场景',
          ],
          keyPoints: [
            '栈是后进先出（LIFO）的数据结构',
            '队列是先进先出（FIFO）的数据结构',
            '这些结构有广泛的实际应用',
          ],
        ),
      ],
    );
  }
  
  /// 创建面试准备路径
  LearningPath _createInterviewPath() {
    return LearningPath(
      id: 'interview_path',
      name: '技术面试算法准备',
      description: '针对技术面试常考算法题目的系统训练',
      goal: LearningGoal.interview,
      difficulty: LearningPathDifficulty.intermediate,
      tags: ['面试', '算法题', '编程'],
      units: [
        LearningUnit(
          id: 'array_problems',
          title: '数组问题专项',
          description: '掌握数组相关的经典面试题',
          category: KnowledgeCategory.dataStructure,
          stage: LearningStage.intermediate,
          estimatedTime: const Duration(hours: 6),
          activities: [
            LearningActivity(
              id: 'two_sum_problem',
              title: 'Two Sum问题',
              type: ActivityType.practice,
              estimatedTime: const Duration(hours: 1),
              description: '学习和练习经典的Two Sum问题',
            ),
            LearningActivity(
              id: 'sliding_window',
              title: '滑动窗口技巧',
              type: ActivityType.demo,
              estimatedTime: const Duration(minutes: 45),
              description: '掌握滑动窗口解题技巧',
            ),
            LearningActivity(
              id: 'array_quiz',
              title: '数组问题测试',
              type: ActivityType.quiz,
              estimatedTime: const Duration(minutes: 30),
              description: '测试数组问题的解题能力',
            ),
          ],
          learningObjectives: [
            '掌握数组问题的常见解题技巧',
            '熟练使用双指针和滑动窗口',
            '能够分析算法的时间空间复杂度',
          ],
          keyPoints: [
            '双指针技巧可以优化多数组问题',
            '滑动窗口适合处理子数组问题',
            '哈希表能快速查找和存储',
          ],
        ),
      ],
    );
  }
  
  /// 创建竞赛训练路径
  LearningPath _createCompetitionPath() {
    return LearningPath(
      id: 'competition_path',
      name: '算法竞赛训练',
      description: '提高算法竞赛水平的高强度训练',
      goal: LearningGoal.competition,
      difficulty: LearningPathDifficulty.advanced,
      tags: ['竞赛', '高级算法', '动态规划'],
      units: [
        LearningUnit(
          id: 'advanced_dp',
          title: '高级动态规划',
          description: '掌握复杂的动态规划问题',
          category: KnowledgeCategory.dynamic,
          stage: LearningStage.advanced,
          estimatedTime: const Duration(hours: 10),
          activities: [
            LearningActivity(
              id: 'dp_optimization',
              title: 'DP状态优化',
              type: ActivityType.theory,
              estimatedTime: const Duration(hours: 2),
              description: '学习动态规划的状态优化技巧',
            ),
            LearningActivity(
              id: 'interval_dp',
              title: '区间DP练习',
              type: ActivityType.practice,
              estimatedTime: const Duration(hours: 3),
              description: '练习区间动态规划问题',
            ),
          ],
          learningObjectives: [
            '掌握高级动态规划技巧',
            '能够设计复杂的状态转移方程',
            '理解各种DP优化方法',
          ],
          keyPoints: [
            '状态设计是DP的关键',
            '优化可以显著提高效率',
            '练习是掌握DP的不二法门',
          ],
        ),
      ],
    );
  }
  
  /// 创建学术研究路径
  LearningPath _createResearchPath() {
    return LearningPath(
      id: 'research_path',
      name: '算法理论研究',
      description: '深入学习算法理论和前沿研究',
      goal: LearningGoal.research,
      difficulty: LearningPathDifficulty.advanced,
      tags: ['理论', '研究', '前沿'],
      units: [
        LearningUnit(
          id: 'complexity_theory',
          title: '计算复杂性理论',
          description: '深入理解计算复杂性理论',
          category: KnowledgeCategory.complexity,
          stage: LearningStage.expert,
          estimatedTime: const Duration(hours: 15),
          activities: [
            LearningActivity(
              id: 'p_np_problem',
              title: 'P vs NP问题',
              type: ActivityType.theory,
              estimatedTime: const Duration(hours: 3),
              description: '深入理解P vs NP这一重要问题',
            ),
            LearningActivity(
              id: 'reduction_practice',
              title: '归约技术练习',
              type: ActivityType.practice,
              estimatedTime: const Duration(hours: 4),
              description: '练习问题归约的技术',
            ),
          ],
          learningObjectives: [
            '理解计算复杂性的基本概念',
            '掌握问题归约的技术',
            '了解当前的研究前沿',
          ],
          keyPoints: [
            'P和NP是复杂性理论的核心概念',
            '归约是证明问题难度的重要工具',
            '理论研究推动算法发展',
          ],
        ),
      ],
    );
  }
  
  /// 根据用户档案推荐学习路径
  List<LearningPath> recommendPaths(LearningProfile profile) {
    final allPaths = getAllLearningPaths();
    final recommendations = <LearningPath>[];
    
    // 根据主要目标筛选
    final primaryPaths = allPaths.where((path) => path.goal == profile.primaryGoal).toList();
    recommendations.addAll(primaryPaths);
    
    // 根据次要目标补充
    for (final goal in profile.secondaryGoals) {
      final secondaryPaths = allPaths.where((path) => 
          path.goal == goal && !recommendations.contains(path)).toList();
      recommendations.addAll(secondaryPaths.take(1)); // 每个次要目标最多推荐1个路径
    }
    
    // 如果没有推荐，提供默认推荐
    if (recommendations.isEmpty) {
      recommendations.add(allPaths.first);
    }
    
    return recommendations;
  }
  
  /// 生成个性化学习建议
  List<LearningRecommendation> generateRecommendations(
    LearningProfile profile,
    LearningProgress progress,
    LearningPath path,
  ) {
    final recommendations = <LearningRecommendation>[];
    
    // 检查下一个学习单元
    final nextUnit = path.getNextUnit(progress.completedUnits);
    if (nextUnit != null) {
      recommendations.add(LearningRecommendation(
        type: RecommendationType.nextUnit,
        title: '继续学习：${nextUnit.title}',
        description: nextUnit.description,
        actionText: '开始学习',
        actionData: {'unitId': nextUnit.id},
        priority: 5,
      ));
    }
    
    // 检查是否需要复习
    final weakAreas = _identifyWeakAreas(progress);
    if (weakAreas.isNotEmpty) {
      recommendations.add(LearningRecommendation(
        type: RecommendationType.review,
        title: '建议复习薄弱环节',
        description: '在${weakAreas.join('、')}方面需要加强',
        actionText: '开始复习',
        actionData: {'areas': weakAreas},
        priority: 4,
      ));
    }
    
    // 学习进度建议
    final progressRate = _calculateProgressRate(progress);
    if (progressRate < 0.1) { // 进度缓慢
      recommendations.add(LearningRecommendation(
        type: RecommendationType.adjustment,
        title: '学习进度建议',
        description: '最近的学习进度较慢，建议调整学习计划或增加学习时间',
        actionText: '调整计划',
        priority: 3,
      ));
    }
    
    // 练习建议
    if (progress.getAverageScore() < 70) {
      recommendations.add(LearningRecommendation(
        type: RecommendationType.practice,
        title: '加强练习',
        description: '当前平均分数较低，建议多做练习题巩固知识',
        actionText: '开始练习',
        priority: 4,
      ));
    }
    
    // 按优先级排序
    recommendations.sort((a, b) => b.priority.compareTo(a.priority));
    
    return recommendations;
  }
  
  /// 识别薄弱环节
  List<String> _identifyWeakAreas(LearningProgress progress) {
    final weakAreas = <String>[];
    
    // 分析分数较低的单元
    progress.unitScores.forEach((unitId, score) {
      if (score < 60) {
        weakAreas.add(unitId);
      }
    });
    
    return weakAreas;
  }
  
  /// 计算学习进度率
  double _calculateProgressRate(LearningProgress progress) {
    final studyDays = progress.getStudyDays();
    if (studyDays <= 7) return 1.0; // 新用户给予满分
    
    final recentSessions = progress.studySessions
        .where((session) => 
            DateTime.now().difference(session.startTime).inDays <= 7)
        .toList();
    
    return recentSessions.length / 7.0; // 一周内的学习频率
  }
  
  /// 创建学习统计
  LearningStatistics generateStatistics(
    List<LearningProgress> allProgress,
    LearningProfile profile,
  ) {
    if (allProgress.isEmpty) {
      return LearningStatistics(
        totalUnitsCompleted: 0,
        totalActivitiesCompleted: 0,
        totalStudyTime: Duration.zero,
        averageScore: 0,
      );
    }
    
    int totalUnits = 0;
    int totalActivities = 0;
    Duration totalTime = Duration.zero;
    double totalScore = 0;
    int scoreCount = 0;
    final categoryProgress = <KnowledgeCategory, int>{};
    final activityTypeCount = <ActivityType, int>{};
    final studyDates = <DateTime>[];
    
    for (final progress in allProgress) {
      totalUnits += progress.completedUnits.length;
      totalActivities += progress.completedActivities.length;
      totalTime += progress.getTotalStudyTime();
      
      // 统计分数
      progress.unitScores.values.forEach((score) {
        totalScore += score;
        scoreCount++;
      });
      
      // 统计学习日期
      for (final session in progress.studySessions) {
        if (!studyDates.any((date) => 
            date.year == session.startTime.year &&
            date.month == session.startTime.month &&
            date.day == session.startTime.day)) {
          studyDates.add(DateTime(
            session.startTime.year,
            session.startTime.month,
            session.startTime.day,
          ));
        }
      }
    }
    
    final averageScore = scoreCount > 0 ? (totalScore / scoreCount).toDouble() : 0.0;
    
    // 计算学习一致性（基于学习日期的分布）
    final consistency = _calculateConsistency(studyDates);
    
    return LearningStatistics(
      totalUnitsCompleted: totalUnits,
      totalActivitiesCompleted: totalActivities,
      totalStudyTime: totalTime,
      averageScore: averageScore,
      categoryProgress: categoryProgress,
      activityTypeCount: activityTypeCount,
      studyDates: studyDates,
      consistency: consistency,
    );
  }
  
  /// 计算学习一致性
  double _calculateConsistency(List<DateTime> studyDates) {
    if (studyDates.length < 2) return 0;
    
    studyDates.sort();
    final totalDays = studyDates.last.difference(studyDates.first).inDays + 1;
    final studyDays = studyDates.length;
    
    // 一致性 = 学习天数 / 总天数 * 100
    return (studyDays / totalDays) * 100;
  }
  
  /// 评估用户熟练程度
  ProficiencyLevel assessProficiency(
    KnowledgeCategory category,
    List<LearningProgress> progressList,
  ) {
    if (progressList.isEmpty) return ProficiencyLevel.novice;
    
    // 简化的评估逻辑
    int categoryUnits = 0;
    double totalScore = 0;
    int scoreCount = 0;
    
    for (final progress in progressList) {
      // 这里需要更复杂的逻辑来判断单元是否属于特定类别
      categoryUnits += progress.completedUnits.length;
      
      progress.unitScores.values.forEach((score) {
        totalScore += score;
        scoreCount++;
      });
    }
    
    final averageScore = scoreCount > 0 ? (totalScore / scoreCount).toDouble() : 0.0;
    
    // 基于完成单元数和平均分数评估
    if (categoryUnits >= 10 && averageScore >= 90) return ProficiencyLevel.expert;
    if (categoryUnits >= 7 && averageScore >= 80) return ProficiencyLevel.advanced;
    if (categoryUnits >= 4 && averageScore >= 70) return ProficiencyLevel.intermediate;
    if (categoryUnits >= 2 && averageScore >= 60) return ProficiencyLevel.beginner;
    
    return ProficiencyLevel.novice;
  }
  
  /// 调整学习路径难度
  LearningPath adjustPathDifficulty(
    LearningPath originalPath,
    LearningProfile profile,
    LearningStatistics stats,
  ) {
    // 基于用户表现调整路径难度
    if (stats.averageScore >= 85 && stats.consistency >= 80) {
      // 表现优秀，可以提升难度
      return _upgradePathDifficulty(originalPath);
    } else if (stats.averageScore < 60 || stats.consistency < 40) {
      // 表现不佳，降低难度
      return _downgradePathDifficulty(originalPath);
    }
    
    return originalPath; // 保持原有难度
  }
  
  /// 提升路径难度
  LearningPath _upgradePathDifficulty(LearningPath path) {
    // 简化实现：返回更高级的路径
    final allPaths = getAllLearningPaths();
    final higherPaths = allPaths.where((p) => 
        p.goal == path.goal && 
        p.difficulty.index > path.difficulty.index
    ).toList();
    
    return higherPaths.isNotEmpty ? higherPaths.first : path;
  }
  
  /// 降低路径难度
  LearningPath _downgradePathDifficulty(LearningPath path) {
    // 简化实现：返回更低级的路径
    final allPaths = getAllLearningPaths();
    final lowerPaths = allPaths.where((p) => 
        p.goal == path.goal && 
        p.difficulty.index < path.difficulty.index
    ).toList();
    
    return lowerPaths.isNotEmpty ? lowerPaths.last : path;
  }
}
