// 数据结构模型

/// 数据结构类型
enum DataStructureType {
  stack('栈'),
  queue('队列'),
  linkedList('链表'),
  binaryTree('二叉树'),
  binarySearchTree('二叉搜索树'),
  avlTree('AVL树'),
  heap('堆'),
  graph('图');

  final String displayName;
  const DataStructureType(this.displayName);
}

/// 树节点
class TreeNode<T> {
  T value;
  TreeNode<T>? left;
  TreeNode<T>? right;
  TreeNode<T>? parent;
  int? height; // 用于AVL树
  int? x; // 用于可视化的x坐标
  int? y; // 用于可视化的y坐标

  TreeNode({
    required this.value,
    this.left,
    this.right,
    this.parent,
    this.height,
    this.x,
    this.y,
  });
}

/// 图节点
class GraphNode<T> {
  final String id;
  final T value;
  final List<GraphEdge<T>> edges;
  double? x; // 用于可视化的x坐标
  double? y; // 用于可视化的y坐标
  bool visited = false;

  GraphNode({
    required this.id,
    required this.value,
    List<GraphEdge<T>>? edges,
    this.x,
    this.y,
  }) : edges = edges ?? [];

  void addEdge(GraphEdge<T> edge) {
    edges.add(edge);
  }
}

/// 图边
class GraphEdge<T> {
  final GraphNode<T> from;
  final GraphNode<T> to;
  final double weight;
  bool highlighted = false;

  GraphEdge({
    required this.from,
    required this.to,
    this.weight = 1.0,
  });
}

/// 数据结构操作步骤
class DataStructureStep {
  final String operation;
  final String description;
  final dynamic currentState; // 当前数据结构状态的快照
  final List<String> highlightedElements;
  final int stepNumber;

  DataStructureStep({
    required this.operation,
    required this.description,
    required this.currentState,
    this.highlightedElements = const [],
    required this.stepNumber,
  });
}

/// 抽象数据结构基类
abstract class DataStructure<T> {
  final String name;
  final DataStructureType type;
  final List<DataStructureStep> steps = [];

  DataStructure({
    required this.name,
    required this.type,
  });

  /// 添加操作步骤
  void addStep({
    required String operation,
    required String description,
    required dynamic currentState,
    List<String> highlightedElements = const [],
  }) {
    steps.add(DataStructureStep(
      operation: operation,
      description: description,
      currentState: currentState,
      highlightedElements: highlightedElements,
      stepNumber: steps.length + 1,
    ));
  }

  /// 获取所有步骤
  List<DataStructureStep> getSteps() => steps;

  /// 重置数据结构
  void reset() {
    steps.clear();
  }
}
