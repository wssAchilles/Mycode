// 练习题服务
import 'dart:math' as math;
import 'package:ml_platform/models/quiz_model.dart';

/// 练习题服务
class QuizService {
  static final QuizService _instance = QuizService._internal();
  factory QuizService() => _instance;
  QuizService._internal();
  
  // 题库存储
  final List<QuizQuestion> _questionBank = [];
  
  /// 初始化题库
  void initializeQuestionBank() {
    _questionBank.clear();
    _questionBank.addAll(_generateSortingQuestions());
    _questionBank.addAll(_generateComplexityQuestions());
    _questionBank.addAll(_generateDataStructureQuestions());
    _questionBank.addAll(_generateSchedulingQuestions());
    _questionBank.addAll(_generateMemoryQuestions());
  }
  
  /// 生成排序算法题目
  List<QuizQuestion> _generateSortingQuestions() {
    return [
      QuizQuestion(
        id: 'sort_001',
        title: '冒泡排序时间复杂度',
        content: '冒泡排序在最坏情况下的时间复杂度是？',
        type: QuestionType.multipleChoice,
        difficulty: QuestionDifficulty.easy,
        category: KnowledgeCategory.sorting,
        tags: ['冒泡排序', '时间复杂度'],
        options: QuizOptions(
          choices: ['O(n)', 'O(n log n)', 'O(n²)', 'O(n³)'],
          correctChoiceIndex: 2,
        ),
        explanation: '''
冒泡排序的时间复杂度分析：
- 最坏情况：数组完全逆序，需要进行 n(n-1)/2 次比较，所以是 O(n²)
- 最好情况：数组已经有序，只需要一轮遍历，是 O(n)
- 平均情况：也是 O(n²)
        ''',
        hints: [
          '考虑嵌套循环的次数',
          '最坏情况是数组完全逆序',
        ],
        points: 10,
      ),
      
      QuizQuestion(
        id: 'sort_002',
        title: '快速排序稳定性',
        content: '快速排序是稳定的排序算法吗？',
        type: QuestionType.trueFalse,
        difficulty: QuestionDifficulty.medium,
        category: KnowledgeCategory.sorting,
        tags: ['快速排序', '稳定性'],
        options: QuizOptions(
          correctBoolean: false,
        ),
        explanation: '''
快速排序不是稳定的排序算法。

稳定性定义：相等元素在排序后保持原有的相对顺序。

快速排序在分区过程中，相等的元素可能会改变相对位置，因此不是稳定的。

稳定的排序算法有：冒泡排序、插入排序、归并排序等。
        ''',
        hints: [
          '想想分区过程中相等元素的处理',
          '稳定性是指相等元素的相对位置不变',
        ],
        points: 15,
      ),
      
      QuizQuestion(
        id: 'sort_003',
        title: '归并排序分析',
        content: '对数组 [3, 1, 4, 1, 5, 9, 2, 6] 进行归并排序，第一次合并操作的结果是什么？',
        type: QuestionType.fillInBlank,
        difficulty: QuestionDifficulty.hard,
        category: KnowledgeCategory.sorting,
        tags: ['归并排序', '分治'],
        options: QuizOptions(
          correctAnswers: ['[1, 3], [1, 4], [5, 9], [2, 6]', '[1,3], [1,4], [5,9], [2,6]'],
        ),
        explanation: '''
归并排序采用分治策略：

1. 分解：将数组分成两半，递归分解直到单个元素
   [3, 1, 4, 1, 5, 9, 2, 6] → [3, 1, 4, 1] 和 [5, 9, 2, 6]
   
2. 继续分解到单个元素：
   [3], [1], [4], [1], [5], [9], [2], [6]
   
3. 第一次合并（两两合并）：
   [3] + [1] → [1, 3]
   [4] + [1] → [1, 4]  
   [5] + [9] → [5, 9]
   [2] + [6] → [2, 6]
        ''',
        hints: [
          '归并排序先分解到单个元素',
          '然后两两合并并排序',
          '第一次合并是相邻的单个元素',
        ],
        points: 20,
      ),
    ];
  }
  
  /// 生成复杂度分析题目
  List<QuizQuestion> _generateComplexityQuestions() {
    return [
      QuizQuestion(
        id: 'complexity_001',
        title: '算法复杂度比较',
        content: '以下哪个时间复杂度的增长速度最快？',
        type: QuestionType.multipleChoice,
        difficulty: QuestionDifficulty.medium,
        category: KnowledgeCategory.complexity,
        tags: ['时间复杂度', '增长率'],
        options: QuizOptions(
          choices: ['O(n log n)', 'O(n²)', 'O(2^n)', 'O(n³)'],
          correctChoiceIndex: 2,
        ),
        explanation: '''
复杂度增长速度排序（从快到慢）：
O(n!) > O(2^n) > O(n³) > O(n²) > O(n log n) > O(n) > O(log n) > O(1)

指数复杂度 O(2^n) 增长极快，当 n=10 时就已经是 1024，
而 n²=100，n³=1000，n log n ≈ 33.2

所以 O(2^n) 是增长最快的。
        ''',
        hints: [
          '指数函数增长非常快',
          '比较 n=10 时各个函数的值',
        ],
        points: 15,
      ),
      
      QuizQuestion(
        id: 'complexity_002',
        title: '空间复杂度分析',
        content: '递归实现的快速排序的空间复杂度是？',
        type: QuestionType.fillInBlank,
        difficulty: QuestionDifficulty.hard,
        category: KnowledgeCategory.complexity,
        tags: ['快速排序', '空间复杂度', '递归'],
        options: QuizOptions(
          correctAnswers: ['O(log n)', 'O(logn)', 'log n'],
        ),
        explanation: '''
快速排序的空间复杂度分析：

1. 平均情况：O(log n)
   - 递归深度平均为 log n
   - 每层递归需要常数额外空间
   - 总空间复杂度为 O(log n)

2. 最坏情况：O(n)
   - 当每次分区都极不均匀时（如已排序数组）
   - 递归深度可达 n
   - 空间复杂度退化为 O(n)

一般讨论空间复杂度时指平均情况 O(log n)。
        ''',
        hints: [
          '考虑递归调用栈的深度',
          '平均情况下分区比较均匀',
        ],
        points: 20,
      ),
    ];
  }
  
  /// 生成数据结构题目
  List<QuizQuestion> _generateDataStructureQuestions() {
    return [
      QuizQuestion(
        id: 'ds_001',
        title: '栈的特点',
        content: '栈(Stack)数据结构的特点是？',
        type: QuestionType.multipleChoice,
        difficulty: QuestionDifficulty.easy,
        category: KnowledgeCategory.dataStructure,
        tags: ['栈', 'LIFO'],
        options: QuizOptions(
          choices: ['先进先出(FIFO)', '先进后出(LIFO)', '随机访问', '按优先级访问'],
          correctChoiceIndex: 1,
        ),
        explanation: '''
栈(Stack)是一种后进先出(LIFO - Last In First Out)的数据结构。

主要特点：
- 只能在栈顶进行插入(push)和删除(pop)操作
- 最后入栈的元素最先出栈
- 类似于叠盘子，只能从最上面取盘子

常见应用：
- 函数调用栈
- 表达式求值
- 浏览器的后退功能
        ''',
        hints: [
          '想象一下叠盘子的过程',
          'LIFO是关键词',
        ],
        points: 10,
      ),
      
      QuizQuestion(
        id: 'ds_002',
        title: '二叉搜索树查找',
        content: '在二叉搜索树中查找元素的平均时间复杂度是？',
        type: QuestionType.multipleChoice,
        difficulty: QuestionDifficulty.medium,
        category: KnowledgeCategory.tree,
        tags: ['二叉搜索树', '查找', '时间复杂度'],
        options: QuizOptions(
          choices: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
          correctChoiceIndex: 1,
        ),
        explanation: '''
二叉搜索树(BST)的查找时间复杂度：

平均情况：O(log n)
- 树相对平衡时，每次比较可以排除一半节点
- 查找路径长度约为 log n

最坏情况：O(n)
- 树退化为链表时（如插入有序数据）
- 需要遍历所有节点

这就是为什么需要自平衡二叉搜索树（如AVL树、红黑树）来保证 O(log n) 的性能。
        ''',
        hints: [
          '考虑树的高度',
          '平衡树每次比较排除一半节点',
        ],
        points: 15,
      ),
    ];
  }
  
  /// 生成进程调度题目
  List<QuizQuestion> _generateSchedulingQuestions() {
    return [
      QuizQuestion(
        id: 'sched_001',
        title: 'FCFS调度特点',
        content: '先来先服务(FCFS)调度算法可能导致什么问题？',
        type: QuestionType.multipleChoice,
        difficulty: QuestionDifficulty.medium,
        category: KnowledgeCategory.scheduling,
        tags: ['FCFS', '护航效应'],
        options: QuizOptions(
          choices: ['死锁', '护航效应', '饥饿现象', '优先级反转'],
          correctChoiceIndex: 1,
        ),
        explanation: '''
FCFS(First Come First Served)调度的护航效应：

问题描述：
- 当一个长进程先到达时，后续的短进程都要等待
- 导致平均等待时间增加，系统响应性差

例子：
- 进程A：到达时间0，服务时间24
- 进程B：到达时间1，服务时间3  
- 进程C：到达时间2，服务时间3

B和C都要等待A完成，平均等待时间很长。

解决方案：使用SJF(短作业优先)等算法。
        ''',
        hints: [
          '想象排队时前面有个办事很慢的人',
          '长进程会影响后续短进程',
        ],
        points: 15,
      ),
    ];
  }
  
  /// 生成内存管理题目
  List<QuizQuestion> _generateMemoryQuestions() {
    return [
      QuizQuestion(
        id: 'mem_001',
        title: '页面置换算法',
        content: 'LRU页面置换算法的全称是什么？',
        type: QuestionType.fillInBlank,
        difficulty: QuestionDifficulty.easy,
        category: KnowledgeCategory.memory,
        tags: ['LRU', '页面置换'],
        options: QuizOptions(
          correctAnswers: ['Least Recently Used', '最近最少使用', '最近最久未使用'],
        ),
        explanation: '''
LRU (Least Recently Used) - 最近最少使用算法

工作原理：
- 选择最长时间没有被使用的页面进行置换
- 基于程序的时间局部性原理
- 认为最近使用过的页面在不久的将来还会被使用

实现方法：
- 计数器法：为每个页面记录最后使用时间
- 栈法：维护一个页面使用栈
- 硬件支持：使用访问位和移位寄存器

LRU是一种很有效的页面置换算法，但实现成本较高。
        ''',
        hints: [
          '关键词是"最近"和"最少使用"',
          '考虑时间局部性原理',
        ],
        points: 10,
      ),
    ];
  }
  
  /// 根据配置获取题目
  List<QuizQuestion> getQuestionsByConfig(QuestionGeneratorConfig config) {
    var questions = _questionBank.where((q) => 
        q.category == config.category && 
        q.difficulty == config.difficulty &&
        config.allowedTypes.contains(q.type)
    ).toList();
    
    // 随机打乱
    questions.shuffle();
    
    // 限制数量
    if (questions.length > config.count) {
      questions = questions.take(config.count).toList();
    }
    
    return questions;
  }
  
  /// 智能推荐题目
  List<QuizQuestion> getRecommendedQuestions(RecommendationConfig config) {
    List<QuizQuestion> recommended = [];
    
    // 如果有用户统计数据，重点推荐薄弱领域
    if (config.userStats != null) {
      final weakAreas = config.userStats!.weakAreas;
      
      for (final area in weakAreas) {
        final category = KnowledgeCategory.values.firstWhere(
          (c) => c.label == area,
          orElse: () => KnowledgeCategory.sorting,
        );
        
        final questions = _questionBank.where((q) =>
            q.category == category &&
            q.difficulty == config.targetDifficulty
        ).toList();
        
        questions.shuffle();
        recommended.addAll(questions.take(3)); // 每个薄弱领域3道题
      }
    }
    
    // 补充焦点领域的题目
    for (final category in config.focusAreas) {
      final questions = _questionBank.where((q) =>
          q.category == category &&
          q.difficulty == config.targetDifficulty
      ).toList();
      
      questions.shuffle();
      recommended.addAll(questions.take(2)); // 每个焦点领域2道题
    }
    
    // 如果数量不够，随机添加其他题目
    if (recommended.length < config.questionCount) {
      final remaining = _questionBank.where((q) => 
          !recommended.contains(q) &&
          q.difficulty == config.targetDifficulty
      ).toList();
      
      remaining.shuffle();
      final needed = config.questionCount - recommended.length;
      recommended.addAll(remaining.take(needed));
    }
    
    // 打乱顺序
    recommended.shuffle();
    
    return recommended.take(config.questionCount).toList();
  }
  
  /// 检查答案
  bool checkAnswer(QuizQuestion question, dynamic userAnswer) {
    switch (question.type) {
      case QuestionType.multipleChoice:
        return userAnswer == question.options.correctChoiceIndex;
        
      case QuestionType.trueFalse:
        return userAnswer == question.options.correctBoolean;
        
      case QuestionType.fillInBlank:
        if (userAnswer is String) {
          final correctAnswers = question.options.correctAnswers ?? [];
          return correctAnswers.any((correct) => 
              _normalizeAnswer(userAnswer).contains(_normalizeAnswer(correct)));
        }
        return false;
        
      case QuestionType.coding:
        // 简化的代码检查，实际应该更复杂
        if (userAnswer is String && question.options.correctCode != null) {
          return _checkCodeSimilarity(userAnswer, question.options.correctCode!);
        }
        return false;
        
      default:
        return false;
    }
  }
  
  /// 标准化答案（去除空格、转小写）
  String _normalizeAnswer(String answer) {
    return answer.toLowerCase().replaceAll(RegExp(r'\s+'), '');
  }
  
  /// 简化的代码相似度检查
  bool _checkCodeSimilarity(String userCode, String correctCode) {
    final userNormalized = _normalizeAnswer(userCode);
    final correctNormalized = _normalizeAnswer(correctCode);
    
    // 简单的包含检查，实际应该使用更复杂的算法
    return userNormalized.contains(correctNormalized) || 
           correctNormalized.contains(userNormalized) ||
           _calculateSimilarity(userNormalized, correctNormalized) > 0.8;
  }
  
  /// 计算字符串相似度
  double _calculateSimilarity(String a, String b) {
    if (a.isEmpty && b.isEmpty) return 1.0;
    if (a.isEmpty || b.isEmpty) return 0.0;
    
    final maxLen = math.max(a.length, b.length);
    final distance = _levenshteinDistance(a, b);
    
    return 1.0 - (distance / maxLen);
  }
  
  /// 计算编辑距离
  int _levenshteinDistance(String a, String b) {
    final matrix = List.generate(a.length + 1, 
        (i) => List.filled(b.length + 1, 0));
    
    for (int i = 0; i <= a.length; i++) {
      matrix[i][0] = i;
    }
    
    for (int j = 0; j <= b.length; j++) {
      matrix[0][j] = j;
    }
    
    for (int i = 1; i <= a.length; i++) {
      for (int j = 1; j <= b.length; j++) {
        final cost = a[i - 1] == b[j - 1] ? 0 : 1;
        matrix[i][j] = [
          matrix[i - 1][j] + 1,      // 删除
          matrix[i][j - 1] + 1,      // 插入
          matrix[i - 1][j - 1] + cost // 替换
        ].reduce(math.min);
      }
    }
    
    return matrix[a.length][b.length];
  }
  
  /// 创建练习会话
  QuizSession createQuizSession({
    required String title,
    required List<QuizQuestion> questions,
    QuizMode mode = QuizMode.practice,
    QuizSettings? settings,
  }) {
    return QuizSession(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      title: title,
      questions: questions,
      mode: mode,
      settings: settings,
    );
  }
  
  /// 提交答案
  void submitAnswer(QuizSession session, String questionId, dynamic answer, int timeSpent) {
    final question = session.questions.firstWhere((q) => q.id == questionId);
    final isCorrect = checkAnswer(question, answer);
    
    session.answers[questionId] = UserAnswer(
      questionId: questionId,
      timestamp: DateTime.now(),
      userAnswer: answer,
      isCorrect: isCorrect,
      timeSpent: timeSpent,
    );
    
    // 如果是最后一题，结束会话
    if (session.isCompleted) {
      session.endTime = DateTime.now();
    }
  }
  
  /// 获取学习建议
  List<String> getStudyRecommendations(QuizStatistics stats) {
    final recommendations = <String>[];
    
    if (stats.accuracy < 60) {
      recommendations.add('建议加强基础知识的学习，当前准确率偏低');
    }
    
    if (stats.weakAreas.isNotEmpty) {
      recommendations.add('重点复习：${stats.weakAreas.join('、')}');
    }
    
    if (stats.strongAreas.isNotEmpty) {
      recommendations.add('继续保持：${stats.strongAreas.join('、')}方面表现优秀');
    }
    
    // 根据难度表现给建议
    final hardAccuracy = stats.difficultyAccuracy[QuestionDifficulty.hard] ?? 0;
    if (hardAccuracy < 50) {
      recommendations.add('可以多练习中等难度题目，再挑战困难题目');
    }
    
    if (recommendations.isEmpty) {
      recommendations.add('继续保持良好的学习状态！');
    }
    
    return recommendations;
  }
  
  /// 获取所有题目
  List<QuizQuestion> getAllQuestions() {
    if (_questionBank.isEmpty) {
      initializeQuestionBank();
    }
    return List.from(_questionBank);
  }
  
  /// 按分类获取题目数量统计
  Map<KnowledgeCategory, int> getCategoryStatistics() {
    final stats = <KnowledgeCategory, int>{};
    
    for (final question in _questionBank) {
      stats[question.category] = (stats[question.category] ?? 0) + 1;
    }
    
    return stats;
  }
  
  /// 按难度获取题目数量统计
  Map<QuestionDifficulty, int> getDifficultyStatistics() {
    final stats = <QuestionDifficulty, int>{};
    
    for (final question in _questionBank) {
      stats[question.difficulty] = (stats[question.difficulty] ?? 0) + 1;
    }
    
    return stats;
  }
}
