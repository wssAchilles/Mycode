// 算法数据模型

/// 排序算法步骤
class SortingStep {
  final List<int> array;
  final int? comparing1; // 正在比较的元素1索引
  final int? comparing2; // 正在比较的元素2索引
  final int? swapping1; // 正在交换的元素1索引
  final int? swapping2; // 正在交换的元素2索引
  final String description;
  final int stepNumber;
  
  // 归并排序专用字段
  final List<int>? auxiliaryData; // 辅助数组数据
  final List<int>? highlightRange; // 高亮范围 [start, end]
  
  // 堆排序专用字段
  final int? heapBoundary; // 堆的边界（区分堆和已排序部分）
  final List<int>? sortedRange; // 已排序范围 [start, end]

  SortingStep({
    required this.array,
    this.comparing1,
    this.comparing2,
    this.swapping1,
    this.swapping2,
    required this.description,
    required this.stepNumber,
    this.auxiliaryData,
    this.highlightRange,
    this.heapBoundary,
    this.sortedRange,
  });
}

/// 算法类型枚举
enum AlgorithmType {
  bubbleSort('冒泡排序'),
  selectionSort('选择排序'),
  insertionSort('插入排序'),
  quickSort('快速排序'),
  mergeSort('归并排序'),
  heapSort('堆排序');

  final String displayName;
  const AlgorithmType(this.displayName);
}

/// 算法性能指标
class AlgorithmMetrics {
  final int comparisons;
  final int swaps;
  final Duration executionTime;
  final String timeComplexity;
  final String spaceComplexity;

  AlgorithmMetrics({
    required this.comparisons,
    required this.swaps,
    required this.executionTime,
    required this.timeComplexity,
    required this.spaceComplexity,
  });
}

/// 抽象算法基类
abstract class Algorithm {
  final String name;
  final AlgorithmType type;
  final List<int> inputData;
  final List<SortingStep> steps = [];
  AlgorithmMetrics? metrics;

  Algorithm({
    required this.name,
    required this.type,
    required this.inputData,
  });

  /// 执行算法
  Future<void> execute();

  /// 获取算法步骤
  List<SortingStep> getSteps() => steps;

  /// 重置算法状态
  void reset() {
    steps.clear();
    metrics = null;
  }

  /// 添加一个步骤
  void addStep({
    required List<int> array,
    int? comparing1,
    int? comparing2,
    int? swapping1,
    int? swapping2,
    required String description,
  }) {
    steps.add(SortingStep(
      array: List<int>.from(array),
      comparing1: comparing1,
      comparing2: comparing2,
      swapping1: swapping1,
      swapping2: swapping2,
      description: description,
      stepNumber: steps.length + 1,
    ));
  }
}
