// 示例场景模型
import 'package:flutter/material.dart';
import 'package:ml_platform/models/os/process_model.dart';
import 'package:ml_platform/models/os/memory_model.dart';
import 'package:ml_platform/models/os/banker_model.dart';
import 'package:ml_platform/models/algorithm_model.dart';

/// 场景类型
enum ScenarioType {
  sorting('排序算法', Icons.sort, Colors.blue),
  scheduling('进程调度', Icons.schedule, Colors.green),
  memory('内存管理', Icons.memory, Colors.orange),
  banker('银行家算法', Icons.security, Colors.purple),
  tree('树结构', Icons.account_tree, Colors.teal),
  graph('图算法', Icons.hub, Colors.red);
  
  final String label;
  final IconData icon;
  final Color color;
  const ScenarioType(this.label, this.icon, this.color);
}

/// 难度级别
enum DifficultyLevel {
  beginner('初级', Colors.green),
  intermediate('中级', Colors.orange),
  advanced('高级', Colors.red),
  expert('专家', Colors.purple);
  
  final String label;
  final Color color;
  const DifficultyLevel(this.label, this.color);
}

/// 学习场景
class LearningScenario {
  final String id;
  final String name;
  final String description;
  final ScenarioType type;
  final DifficultyLevel difficulty;
  final List<String> tags;
  final List<String> learningObjectives;
  final Map<String, dynamic> data;
  final String backgroundStory;
  final List<String> hints;
  final Map<String, dynamic>? expectedResults;
  
  LearningScenario({
    required this.id,
    required this.name,
    required this.description,
    required this.type,
    required this.difficulty,
    this.tags = const [],
    this.learningObjectives = const [],
    required this.data,
    this.backgroundStory = '',
    this.hints = const [],
    this.expectedResults,
  });
}

/// 场景库服务
class ScenarioLibrary {
  static final ScenarioLibrary _instance = ScenarioLibrary._internal();
  factory ScenarioLibrary() => _instance;
  ScenarioLibrary._internal();
  
  /// 获取所有场景
  List<LearningScenario> getAllScenarios() {
    return [
      ...getSortingScenarios(),
      ...getSchedulingScenarios(),
      ...getMemoryScenarios(),
      ...getBankerScenarios(),
      ...getTreeScenarios(),
      ...getGraphScenarios(),
    ];
  }
  
  /// 排序算法场景
  List<LearningScenario> getSortingScenarios() {
    return [
      LearningScenario(
        id: 'sort_worst_case',
        name: '最坏情况排序',
        description: '比较不同排序算法在最坏情况下的表现',
        type: ScenarioType.sorting,
        difficulty: DifficultyLevel.intermediate,
        tags: ['排序', '时间复杂度', '对比分析'],
        learningObjectives: [
          '理解各排序算法的最坏时间复杂度',
          '观察算法在逆序数据上的表现',
          '分析交换次数和比较次数的差异',
        ],
        data: {
          'arrays': [
            {'name': '小规模逆序', 'data': [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]},
            {'name': '中规模逆序', 'data': List.generate(20, (i) => 20 - i)},
            {'name': '大规模逆序', 'data': List.generate(50, (i) => 50 - i)},
          ],
          'algorithms': ['bubbleSort', 'quickSort', 'mergeSort', 'heapSort'],
        },
        backgroundStory: '在一个紧急的数据处理任务中，你需要对完全逆序的数据进行排序。'
            '哪种算法能在这种最坏情况下提供最好的性能？',
        hints: [
          '观察快速排序在逆序数据上的表现',
          '注意归并排序的稳定性能',
          '对比冒泡排序和选择排序的效率差异',
        ],
        expectedResults: {
          'best_algorithm': 'mergeSort',
          'worst_algorithm': 'bubbleSort',
        },
      ),
      
      LearningScenario(
        id: 'sort_nearly_sorted',
        name: '近似有序数据排序',
        description: '在几乎已排序的数据上测试各种排序算法',
        type: ScenarioType.sorting,
        difficulty: DifficultyLevel.beginner,
        tags: ['排序', '插入排序', '适应性'],
        learningObjectives: [
          '了解插入排序在近似有序数据上的优势',
          '观察快速排序的分区过程',
          '理解适应性算法的概念',
        ],
        data: {
          'arrays': [
            {'name': '几乎有序', 'data': [1, 2, 3, 5, 4, 6, 7, 8, 10, 9]},
            {'name': '局部乱序', 'data': [1, 3, 2, 4, 6, 5, 7, 9, 8, 10]},
          ],
          'algorithms': ['insertionSort', 'bubbleSort', 'quickSort'],
        },
        backgroundStory: '你收到了一份几乎已经排序好的数据，只有少数元素位置不对。'
            '选择合适的算法可以大大提高处理效率。',
        hints: [
          '插入排序在这种情况下表现出色',
          '观察不同算法的比较次数',
        ],
      ),
      
      LearningScenario(
        id: 'sort_duplicate_values',
        name: '重复值排序稳定性',
        description: '测试排序算法对重复值的处理和稳定性',
        type: ScenarioType.sorting,
        difficulty: DifficultyLevel.advanced,
        tags: ['排序', '稳定性', '重复值'],
        learningObjectives: [
          '理解排序算法的稳定性概念',
          '观察稳定排序与不稳定排序的差异',
          '学习如何处理重复键值',
        ],
        data: {
          'arrays': [
            {'name': '多重复值', 'data': [3, 1, 4, 1, 5, 9, 2, 6, 5, 3]},
            {'name': '大量重复', 'data': [1, 1, 1, 2, 2, 3, 3, 3, 3, 1]},
          ],
          'algorithms': ['mergeSort', 'quickSort', 'heapSort', 'insertionSort'],
        },
        backgroundStory: '在处理学生成绩数据时，相同分数的学生需要保持原有顺序。'
            '你需要选择稳定的排序算法来保证公平性。',
        hints: [
          '归并排序和插入排序是稳定的',
          '快速排序和堆排序通常不稳定',
          '观察相同元素的相对位置变化',
        ],
      ),
    ];
  }
  
  /// 进程调度场景
  List<LearningScenario> getSchedulingScenarios() {
    return [
      LearningScenario(
        id: 'scheduling_interactive',
        name: '交互式系统调度',
        description: '模拟多用户交互式系统的进程调度',
        type: ScenarioType.scheduling,
        difficulty: DifficultyLevel.intermediate,
        tags: ['调度', '交互式', '响应时间'],
        learningObjectives: [
          '理解交互式系统对响应时间的要求',
          '比较不同调度算法的响应时间',
          '学习时间片轮转算法的优势',
        ],
        data: {
          'processes': [
            {'pid': 1, 'arrival': 0, 'burst': 8, 'priority': 1},
            {'pid': 2, 'arrival': 1, 'burst': 4, 'priority': 2},
            {'pid': 3, 'arrival': 2, 'burst': 9, 'priority': 3},
            {'pid': 4, 'arrival': 3, 'burst': 5, 'priority': 1},
            {'pid': 5, 'arrival': 4, 'burst': 2, 'priority': 2},
          ],
          'algorithms': ['FCFS', 'RR', 'Priority', 'MLFQ'],
          'timeQuantum': 2,
        },
        backgroundStory: '你正在管理一个多用户计算机系统，有多个用户同时使用文字处理、'
            '网页浏览和游戏等不同类型的应用。如何调度才能保证良好的用户体验？',
        hints: [
          '交互式进程通常需要快速响应',
          '时间片不宜过长，也不宜过短',
          '观察各算法的平均响应时间',
        ],
        expectedResults: {
          'best_response_time': 'RR',
          'best_throughput': 'SJF',
        },
      ),
      
      LearningScenario(
        id: 'scheduling_batch',
        name: '批处理系统调度',
        description: '优化批处理任务的吞吐量和效率',
        type: ScenarioType.scheduling,
        difficulty: DifficultyLevel.beginner,
        tags: ['调度', '批处理', '吞吐量'],
        learningObjectives: [
          '理解批处理系统的特点',
          '学习如何优化系统吞吐量',
          '比较非抢占式调度算法',
        ],
        data: {
          'processes': [
            {'pid': 1, 'arrival': 0, 'burst': 24, 'priority': 3},
            {'pid': 2, 'arrival': 0, 'burst': 3, 'priority': 1},
            {'pid': 3, 'arrival': 0, 'burst': 3, 'priority': 1},
            {'pid': 4, 'arrival': 0, 'burst': 12, 'priority': 2},
          ],
          'algorithms': ['FCFS', 'SJF', 'Priority'],
        },
        backgroundStory: '你负责管理一个科学计算集群的批处理作业队列，包括大型仿真、'
            '数据分析和报告生成任务。如何安排才能最大化整体效率？',
        hints: [
          '批处理系统更关注吞吐量而非响应时间',
          'SJF算法通常能获得最小的平均等待时间',
          '考虑任务的优先级和处理时间',
        ],
      ),
      
      LearningScenario(
        id: 'scheduling_realtime',
        name: '实时系统调度挑战',
        description: '处理有严格时间限制的实时任务',
        type: ScenarioType.scheduling,
        difficulty: DifficultyLevel.expert,
        tags: ['调度', '实时系统', '截止时间'],
        learningObjectives: [
          '理解实时系统的调度需求',
          '学习EDF(Earliest Deadline First)概念',
          '分析任务的可调度性',
        ],
        data: {
          'processes': [
            {'pid': 1, 'arrival': 0, 'burst': 3, 'deadline': 7, 'priority': 1},
            {'pid': 2, 'arrival': 2, 'burst': 2, 'deadline': 4, 'priority': 1},
            {'pid': 3, 'arrival': 3, 'burst': 1, 'deadline': 5, 'priority': 2},
            {'pid': 4, 'arrival': 5, 'burst': 4, 'deadline': 14, 'priority': 3},
          ],
          'algorithms': ['Priority', 'FCFS'],
        },
        backgroundStory: '你正在开发一个嵌入式控制系统，处理传感器数据、执行控制算法'
            '和更新显示。每个任务都有严格的截止时间要求，错过可能导致系统故障。',
        hints: [
          '实时系统必须保证在截止时间前完成',
          '按截止时间排序可能是好策略',
          '注意任务的到达时间和执行时间',
        ],
      ),
    ];
  }
  
  /// 内存管理场景
  List<LearningScenario> getMemoryScenarios() {
    return [
      LearningScenario(
        id: 'memory_fragmentation',
        name: '内存碎片化问题',
        description: '观察和解决内存碎片化问题',
        type: ScenarioType.memory,
        difficulty: DifficultyLevel.intermediate,
        tags: ['内存管理', '碎片化', '分配算法'],
        learningObjectives: [
          '理解内存碎片化的成因',
          '比较不同分配算法对碎片化的影响',
          '学习内存紧缩的概念',
        ],
        data: {
          'totalMemory': 1000,
          'requests': [
            {'name': 'Process A', 'size': 100},
            {'name': 'Process B', 'size': 200},
            {'name': 'Process C', 'size': 150},
            {'name': 'Process D', 'size': 80},
            {'name': 'Process E', 'size': 300},
          ],
          'operations': [
            {'type': 'allocate', 'process': 'A'},
            {'type': 'allocate', 'process': 'B'},
            {'type': 'allocate', 'process': 'C'},
            {'type': 'deallocate', 'process': 'B'},
            {'type': 'allocate', 'process': 'D'},
            {'type': 'deallocate', 'process': 'A'},
            {'type': 'allocate', 'process': 'E'},
          ],
          'algorithms': ['firstFit', 'bestFit', 'worstFit'],
        },
        backgroundStory: '你管理着一个服务器的内存分配，随着进程的创建和销毁，'
            '内存逐渐产生碎片。如何选择分配策略来减少碎片化？',
        hints: [
          '观察不同算法产生的碎片大小',
          '最佳适应可能产生很多小碎片',
          '最坏适应试图保持大的空闲块',
        ],
      ),
      
      LearningScenario(
        id: 'memory_locality',
        name: '程序局部性原理',
        description: '利用程序的时间和空间局部性优化页面置换',
        type: ScenarioType.memory,
        difficulty: DifficultyLevel.advanced,
        tags: ['页面置换', '局部性', 'LRU'],
        learningObjectives: [
          '理解程序的局部性原理',
          '观察不同访问模式对置换算法的影响',
          '学习LRU算法的优势',
        ],
        data: {
          'frameCount': 4,
          'accessPatterns': [
            {'name': '顺序访问', 'pages': [1, 2, 3, 4, 5, 6, 7, 8, 9]},
            {'name': '局部性访问', 'pages': [1, 2, 1, 3, 2, 1, 4, 3, 2]},
            {'name': '随机访问', 'pages': [1, 5, 3, 8, 2, 7, 4, 6, 9]},
            {'name': '循环访问', 'pages': [1, 2, 3, 4, 1, 2, 3, 4, 1]},
          ],
          'algorithms': ['FIFO', 'LRU', 'OPT'],
        },
        backgroundStory: '你正在优化一个图像处理程序的虚拟内存性能。程序会按不同模式'
            '访问图像数据，如何选择页面置换算法来减少缺页中断？',
        hints: [
          '局部性好的程序适合用LRU',
          '观察不同访问模式的缺页率',
          'OPT算法提供理论最优结果',
        ],
      ),
      
      LearningScenario(
        id: 'memory_thrashing',
        name: '内存抖动现象',
        description: '识别和解决内存抖动问题',
        type: ScenarioType.memory,
        difficulty: DifficultyLevel.expert,
        tags: ['页面置换', '抖动', '工作集'],
        learningObjectives: [
          '理解内存抖动的概念和危害',
          '识别导致抖动的原因',
          '学习工作集模型',
        ],
        data: {
          'frameCount': 3,
          'workingSet': [1, 2, 3, 4],
          'accessPattern': [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5],
          'algorithms': ['FIFO', 'LRU'],
        },
        backgroundStory: '你的系统出现了严重的性能下降，CPU利用率很低但磁盘访问频繁。'
            '经过分析发现是内存抖动导致的。如何解决这个问题？',
        hints: [
          '当工作集大小超过可用页框时容易发生抖动',
          '频繁的页面置换会导致系统性能急剧下降',
          '增加页框数或减少并发进程数可以缓解抖动',
        ],
      ),
    ];
  }
  
  /// 银行家算法场景
  List<LearningScenario> getBankerScenarios() {
    return [
      LearningScenario(
        id: 'banker_safe_state',
        name: '安全状态分析',
        description: '判断系统是否处于安全状态',
        type: ScenarioType.banker,
        difficulty: DifficultyLevel.beginner,
        tags: ['银行家算法', '安全状态', '死锁预防'],
        learningObjectives: [
          '理解安全状态的概念',
          '学习安全性检查算法',
          '掌握安全序列的生成方法',
        ],
        data: BankerExample.getExamples().first.state,
        backgroundStory: '你是一个小型银行的风险控制经理，需要决定是否批准新的贷款申请。'
            '必须确保即使在最坏情况下，银行也能收回所有资金。',
        hints: [
          '安全序列的存在意味着系统安全',
          '按Need <= Available的原则选择进程',
          '模拟进程完成后释放资源的过程',
        ],
      ),
      
      LearningScenario(
        id: 'banker_resource_request',
        name: '资源请求处理',
        description: '安全地处理进程的资源请求',
        type: ScenarioType.banker,
        difficulty: DifficultyLevel.intermediate,
        tags: ['银行家算法', '资源请求', '死锁避免'],
        learningObjectives: [
          '掌握资源请求的处理流程',
          '理解试探性分配的概念',
          '学习如何避免死锁',
        ],
        data: {
          'state': BankerExample.getExamples()[1].state,
          'requests': [
            {'process': 0, 'resources': [1, 0, 2]},
            {'process': 1, 'resources': [0, 1, 0]},
            {'process': 2, 'resources': [2, 0, 0]},
          ],
        },
        backgroundStory: '多个部门同时向你申请设备和资源。你需要仔细评估每个申请，'
            '确保批准后不会导致资源分配僵局。',
        hints: [
          '先检查请求是否超过进程的最大需求',
          '再检查系统是否有足够的可用资源',
          '最后用安全性算法验证分配后的状态',
        ],
      ),
      
      LearningScenario(
        id: 'banker_deadlock_detection',
        name: '死锁检测与恢复',
        description: '检测系统中的死锁并制定恢复策略',
        type: ScenarioType.banker,
        difficulty: DifficultyLevel.advanced,
        tags: ['死锁检测', '资源分配图', '恢复策略'],
        learningObjectives: [
          '学习死锁检测算法',
          '理解资源分配图',
          '掌握死锁恢复方法',
        ],
        data: {
          'processes': ['P1', 'P2', 'P3', 'P4'],
          'resources': ['R1', 'R2', 'R3'],
          'allocation': [
            [0, 1, 0],
            [2, 0, 0],
            [3, 0, 3],
            [2, 1, 1],
          ],
          'request': [
            [0, 0, 0],
            [2, 0, 2],
            [0, 0, 0],
            [1, 0, 0],
          ],
        },
        backgroundStory: '系统出现了异常，多个进程似乎都在等待资源，但没有进程能够继续执行。'
            '你需要检测是否发生了死锁，并制定解决方案。',
        hints: [
          '构建资源分配图检测环路',
          '尝试找到能够完成的进程',
          '考虑终止部分进程或回收部分资源',
        ],
      ),
    ];
  }
  
  /// 树结构场景
  List<LearningScenario> getTreeScenarios() {
    return [
      LearningScenario(
        id: 'tree_search_performance',
        name: '二叉搜索树性能对比',
        description: '比较不同插入序列对BST性能的影响',
        type: ScenarioType.tree,
        difficulty: DifficultyLevel.intermediate,
        tags: ['BST', 'AVL树', '平衡'],
        learningObjectives: [
          '理解BST退化为链表的情况',
          '观察AVL树的自平衡特性',
          '比较平衡树与非平衡树的性能差异',
        ],
        data: {
          'insertSequences': [
            {'name': '顺序插入', 'values': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]},
            {'name': '平衡插入', 'values': [5, 3, 7, 2, 4, 6, 8, 1, 9, 10]},
            {'name': '随机插入', 'values': [3, 7, 1, 9, 5, 2, 8, 4, 6, 10]},
          ],
          'operations': [
            {'type': 'search', 'value': 1},
            {'type': 'search', 'value': 5},
            {'type': 'search', 'value': 10},
          ],
        },
        backgroundStory: '你正在设计一个电话簿系统，需要快速查找联系人。不同的数据插入顺序'
            '会如何影响查找性能？',
        hints: [
          '顺序插入会让BST退化为链表',
          'AVL树通过旋转保持平衡',
          '观察树的高度和查找深度',
        ],
      ),
    ];
  }
  
  /// 图算法场景
  List<LearningScenario> getGraphScenarios() {
    return [
      LearningScenario(
        id: 'graph_shortest_path',
        name: '最短路径导航',
        description: '在城市地图中找到最短路径',
        type: ScenarioType.graph,
        difficulty: DifficultyLevel.intermediate,
        tags: ['图算法', '最短路径', 'Dijkstra'],
        learningObjectives: [
          '理解最短路径问题',
          '学习Dijkstra算法的原理',
          '观察算法的执行过程',
        ],
        data: {
          'graph': {
            'nodes': ['A', 'B', 'C', 'D', 'E', 'F'],
            'edges': [
              {'from': 'A', 'to': 'B', 'weight': 4},
              {'from': 'A', 'to': 'C', 'weight': 2},
              {'from': 'B', 'to': 'C', 'weight': 1},
              {'from': 'B', 'to': 'D', 'weight': 5},
              {'from': 'C', 'to': 'D', 'weight': 8},
              {'from': 'C', 'to': 'E', 'weight': 10},
              {'from': 'D', 'to': 'E', 'weight': 2},
              {'from': 'D', 'to': 'F', 'weight': 6},
              {'from': 'E', 'to': 'F', 'weight': 3},
            ],
          },
          'startNode': 'A',
          'endNode': 'F',
        },
        backgroundStory: '你是一个导航应用的开发者，需要为用户找到从起点到终点的最短路径。'
            '道路有不同的长度和拥堵程度，如何快速计算最优路线？',
        hints: [
          'Dijkstra算法适合处理非负权重的图',
          '使用优先队列可以提高效率',
          '观察距离标签的更新过程',
        ],
      ),
    ];
  }
  
  /// 根据类型获取场景
  List<LearningScenario> getScenariosByType(ScenarioType type) {
    return getAllScenarios().where((s) => s.type == type).toList();
  }
  
  /// 根据难度获取场景
  List<LearningScenario> getScenariosByDifficulty(DifficultyLevel difficulty) {
    return getAllScenarios().where((s) => s.difficulty == difficulty).toList();
  }
  
  /// 根据标签搜索场景
  List<LearningScenario> searchScenariosByTag(String tag) {
    return getAllScenarios().where((s) => 
        s.tags.any((t) => t.toLowerCase().contains(tag.toLowerCase()))
    ).toList();
  }
  
  /// 获取推荐场景
  List<LearningScenario> getRecommendedScenarios({
    DifficultyLevel? preferredDifficulty,
    List<ScenarioType>? interestedTypes,
  }) {
    var scenarios = getAllScenarios();
    
    if (preferredDifficulty != null) {
      scenarios = scenarios.where((s) => s.difficulty == preferredDifficulty).toList();
    }
    
    if (interestedTypes != null && interestedTypes.isNotEmpty) {
      scenarios = scenarios.where((s) => interestedTypes.contains(s.type)).toList();
    }
    
    // 简单的推荐算法：按类型分布返回
    final result = <LearningScenario>[];
    final typeGroups = <ScenarioType, List<LearningScenario>>{};
    
    for (var scenario in scenarios) {
      typeGroups.putIfAbsent(scenario.type, () => []).add(scenario);
    }
    
    for (var group in typeGroups.values) {
      if (group.isNotEmpty) {
        result.add(group.first); // 每个类型取一个
      }
    }
    
    return result.take(6).toList(); // 最多返回6个推荐
  }
}
