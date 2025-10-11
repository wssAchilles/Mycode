import 'package:cloud_firestore/cloud_firestore.dart';

/// 教程模型
class Tutorial {
  final String id;
  final String title;
  final String description;
  final String category;
  final int difficulty; // 1-5
  final List<TutorialStep> steps;
  final Duration estimatedTime;
  final List<String> tags;
  final DateTime createdAt;

  Tutorial({
    required this.id,
    required this.title,
    required this.description,
    required this.category,
    required this.difficulty,
    required this.steps,
    required this.estimatedTime,
    this.tags = const [],
    required this.createdAt,
  });

  factory Tutorial.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return Tutorial(
      id: doc.id,
      title: data['title'] ?? '',
      description: data['description'] ?? '',
      category: data['category'] ?? '',
      difficulty: data['difficulty'] ?? 1,
      steps: (data['steps'] as List<dynamic>? ?? [])
          .map((step) => TutorialStep.fromMap(step))
          .toList(),
      estimatedTime: Duration(minutes: data['estimatedTimeMinutes'] ?? 10),
      tags: List<String>.from(data['tags'] ?? []),
      createdAt: (data['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'title': title,
      'description': description,
      'category': category,
      'difficulty': difficulty,
      'steps': steps.map((step) => step.toMap()).toList(),
      'estimatedTimeMinutes': estimatedTime.inMinutes,
      'tags': tags,
      'createdAt': Timestamp.fromDate(createdAt),
    };
  }
}

/// 教程步骤
class TutorialStep {
  final String title;
  final String content;
  final TutorialStepType type;
  final Map<String, dynamic>? interactiveData;

  TutorialStep({
    required this.title,
    required this.content,
    required this.type,
    this.interactiveData,
  });

  factory TutorialStep.fromMap(Map<String, dynamic> data) {
    return TutorialStep(
      title: data['title'] ?? '',
      content: data['content'] ?? '',
      type: TutorialStepType.values.firstWhere(
        (e) => e.name == data['type'],
        orElse: () => TutorialStepType.text,
      ),
      interactiveData: data['interactiveData'],
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'title': title,
      'content': content,
      'type': type.name,
      'interactiveData': interactiveData,
    };
  }
}

/// 教程步骤类型
enum TutorialStepType {
  text,
  code,
  interactive,
  video,
  quiz
}

/// 预定义教程
class PredefinedTutorials {
  static final bubbleSortTutorial = Tutorial(
    id: 'sorting_bubblesort',
    title: '冒泡排序算法',
    description: '学习冒泡排序的原理和实现',
    category: '排序算法',
    difficulty: 1,
    estimatedTime: Duration(minutes: 15),
    createdAt: DateTime.now(),
    steps: [
      TutorialStep(
        title: '算法原理',
        content: '冒泡排序通过重复遍历数组，比较相邻元素并交换位置来排序。',
        type: TutorialStepType.text,
      ),
      TutorialStep(
        title: '算法实现',
        content: '''
for (int i = 0; i < array.length - 1; i++) {
  for (int j = 0; j < array.length - i - 1; j++) {
    if (array[j] > array[j + 1]) {
      // 交换元素
      int temp = array[j];
      array[j] = array[j + 1];
      array[j + 1] = temp;
    }
  }
}''',
        type: TutorialStepType.code,
      ),
    ],
  );

  static final tcpHandshakeTutorial = Tutorial(
    id: 'network_tcp_handshake',
    title: 'TCP三次握手',
    description: '理解TCP连接建立的过程',
    category: '网络协议',
    difficulty: 2,
    estimatedTime: Duration(minutes: 20),
    createdAt: DateTime.now(),
    steps: [
      TutorialStep(
        title: '握手过程',
        content: 'TCP使用三次握手来建立可靠的连接。',
        type: TutorialStepType.text,
      ),
    ],
  );
}
