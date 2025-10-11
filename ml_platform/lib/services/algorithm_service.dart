// 算法逻辑服务
import 'dart:async';
import 'package:ml_platform/models/algorithm_model.dart';

/// 算法服务类
class AlgorithmService {
  static final AlgorithmService _instance = AlgorithmService._internal();
  factory AlgorithmService() => _instance;
  AlgorithmService._internal();

  /// 冒泡排序算法
  Future<List<SortingStep>> bubbleSort(List<int> input) async {
    final steps = <SortingStep>[];
    final array = List<int>.from(input);
    int comparisons = 0;
    int swaps = 0;

    for (int i = 0; i < array.length - 1; i++) {
      for (int j = 0; j < array.length - i - 1; j++) {
        comparisons++;
        
        // 添加比较步骤
        steps.add(SortingStep(
          array: List<int>.from(array),
          comparing1: j,
          comparing2: j + 1,
          description: '比较 ${array[j]} 和 ${array[j + 1]}',
          stepNumber: steps.length + 1,
        ));

        if (array[j] > array[j + 1]) {
          // 交换元素
          int temp = array[j];
          array[j] = array[j + 1];
          array[j + 1] = temp;
          swaps++;

          // 添加交换步骤
          steps.add(SortingStep(
            array: List<int>.from(array),
            swapping1: j,
            swapping2: j + 1,
            description: '交换 ${array[j]} 和 ${array[j + 1]}',
            stepNumber: steps.length + 1,
          ));
        }
      }
    }

    // 添加完成步骤
    steps.add(SortingStep(
      array: List<int>.from(array),
      description: '排序完成！比较次数: $comparisons, 交换次数: $swaps',
      stepNumber: steps.length + 1,
    ));

    return steps;
  }

  /// 选择排序算法
  Future<List<SortingStep>> selectionSort(List<int> input) async {
    final steps = <SortingStep>[];
    final array = List<int>.from(input);
    int comparisons = 0;
    int swaps = 0;

    for (int i = 0; i < array.length - 1; i++) {
      int minIndex = i;

      for (int j = i + 1; j < array.length; j++) {
        comparisons++;
        
        steps.add(SortingStep(
          array: List<int>.from(array),
          comparing1: minIndex,
          comparing2: j,
          description: '寻找最小值：比较 ${array[minIndex]} 和 ${array[j]}',
          stepNumber: steps.length + 1,
        ));

        if (array[j] < array[minIndex]) {
          minIndex = j;
        }
      }

      if (minIndex != i) {
        // 交换最小值到正确位置
        int temp = array[i];
        array[i] = array[minIndex];
        array[minIndex] = temp;
        swaps++;

        steps.add(SortingStep(
          array: List<int>.from(array),
          swapping1: i,
          swapping2: minIndex,
          description: '将最小值 ${array[i]} 移到位置 $i',
          stepNumber: steps.length + 1,
        ));
      }
    }

    steps.add(SortingStep(
      array: List<int>.from(array),
      description: '排序完成！比较次数: $comparisons, 交换次数: $swaps',
      stepNumber: steps.length + 1,
    ));

    return steps;
  }

  /// 插入排序算法
  Future<List<SortingStep>> insertionSort(List<int> input) async {
    final steps = <SortingStep>[];
    final array = List<int>.from(input);
    int comparisons = 0;
    int shifts = 0;

    for (int i = 1; i < array.length; i++) {
      int key = array[i];
      int j = i - 1;

      steps.add(SortingStep(
        array: List<int>.from(array),
        comparing1: i,
        description: '选择元素 $key 进行插入',
        stepNumber: steps.length + 1,
      ));

      while (j >= 0 && array[j] > key) {
        comparisons++;
        
        steps.add(SortingStep(
          array: List<int>.from(array),
          comparing1: j,
          comparing2: j + 1,
          description: '比较 ${array[j]} 和 $key',
          stepNumber: steps.length + 1,
        ));

        array[j + 1] = array[j];
        shifts++;
        j--;

        steps.add(SortingStep(
          array: List<int>.from(array),
          swapping1: j + 1,
          swapping2: j + 2,
          description: '元素右移',
          stepNumber: steps.length + 1,
        ));
      }

      array[j + 1] = key;

      steps.add(SortingStep(
        array: List<int>.from(array),
        swapping1: j + 1,
        description: '插入 $key 到位置 ${j + 1}',
        stepNumber: steps.length + 1,
      ));
    }

    steps.add(SortingStep(
      array: List<int>.from(array),
      description: '排序完成！比较次数: $comparisons, 移动次数: $shifts',
      stepNumber: steps.length + 1,
    ));

    return steps;
  }

  /// 快速排序算法
  Future<List<SortingStep>> quickSort(List<int> input) async {
    final steps = <SortingStep>[];
    final array = List<int>.from(input);
    
    await _quickSortHelper(array, 0, array.length - 1, steps);
    
    steps.add(SortingStep(
      array: List<int>.from(array),
      description: '快速排序完成！',
      stepNumber: steps.length + 1,
    ));

    return steps;
  }

  /// 快速排序辅助方法
  Future<void> _quickSortHelper(
    List<int> array,
    int low,
    int high,
    List<SortingStep> steps,
  ) async {
    if (low < high) {
      int pivotIndex = await _partition(array, low, high, steps);
      await _quickSortHelper(array, low, pivotIndex - 1, steps);
      await _quickSortHelper(array, pivotIndex + 1, high, steps);
    }
  }

  /// 分区操作
  Future<int> _partition(
    List<int> array,
    int low,
    int high,
    List<SortingStep> steps,
  ) async {
    int pivot = array[high];
    int i = low - 1;

    steps.add(SortingStep(
      array: List<int>.from(array),
      comparing1: high,
      description: '选择基准元素: $pivot',
      stepNumber: steps.length + 1,
    ));

    for (int j = low; j < high; j++) {
      steps.add(SortingStep(
        array: List<int>.from(array),
        comparing1: j,
        comparing2: high,
        description: '比较 ${array[j]} 和基准 $pivot',
        stepNumber: steps.length + 1,
      ));

      if (array[j] < pivot) {
        i++;
        if (i != j) {
          int temp = array[i];
          array[i] = array[j];
          array[j] = temp;

          steps.add(SortingStep(
            array: List<int>.from(array),
            swapping1: i,
            swapping2: j,
            description: '交换 ${array[i]} 和 ${array[j]}',
            stepNumber: steps.length + 1,
          ));
        }
      }
    }

    if (i + 1 != high) {
      int temp = array[i + 1];
      array[i + 1] = array[high];
      array[high] = temp;

      steps.add(SortingStep(
        array: List<int>.from(array),
        swapping1: i + 1,
        swapping2: high,
        description: '将基准元素 ${array[i + 1]} 放到正确位置',
        stepNumber: steps.length + 1,
      ));
    }

    return i + 1;
  }

  /// 归并排序算法
  Future<List<SortingStep>> mergeSort(List<int> input) async {
    final steps = <SortingStep>[];
    final array = List<int>.from(input);
    final auxiliary = List<int>.filled(array.length, 0);
    
    await _mergeSortHelper(array, auxiliary, 0, array.length - 1, steps);
    
    steps.add(SortingStep(
      array: List<int>.from(array),
      description: '归并排序完成！',
      stepNumber: steps.length + 1,
    ));
    
    return steps;
  }
  
  /// 归并排序辅助方法
  Future<void> _mergeSortHelper(
    List<int> array,
    List<int> auxiliary,
    int left,
    int right,
    List<SortingStep> steps,
  ) async {
    if (left >= right) return;
    
    int mid = (left + right) ~/ 2;
    
    // 记录分解步骤
    steps.add(SortingStep(
      array: List<int>.from(array),
      description: '分解：将[$left..$right]分成[$left..$mid]和[${mid+1}..$right]',
      stepNumber: steps.length + 1,
      highlightRange: [left, right],
    ));
    
    // 递归排序左半部分
    await _mergeSortHelper(array, auxiliary, left, mid, steps);
    
    // 递归排序右半部分
    await _mergeSortHelper(array, auxiliary, mid + 1, right, steps);
    
    // 合并两个已排序的部分
    await _merge(array, auxiliary, left, mid, right, steps);
  }
  
  /// 合并函数
  Future<void> _merge(
    List<int> array,
    List<int> auxiliary,
    int left,
    int mid,
    int right,
    List<SortingStep> steps,
  ) async {
    // 复制到辅助数组
    for (int i = left; i <= right; i++) {
      auxiliary[i] = array[i];
    }
    
    steps.add(SortingStep(
      array: List<int>.from(array),
      description: '开始合并[$left..$mid]和[${mid+1}..$right]',
      stepNumber: steps.length + 1,
      highlightRange: [left, right],
      auxiliaryData: List<int>.from(auxiliary.sublist(left, right + 1)),
    ));
    
    int i = left;
    int j = mid + 1;
    int k = left;
    
    // 合并过程
    while (i <= mid && j <= right) {
      steps.add(SortingStep(
        array: List<int>.from(array),
        comparing1: i,
        comparing2: j,
        description: '比较：${auxiliary[i]} vs ${auxiliary[j]}',
        stepNumber: steps.length + 1,
        auxiliaryData: List<int>.from(auxiliary.sublist(left, right + 1)),
      ));
      
      if (auxiliary[i] <= auxiliary[j]) {
        array[k] = auxiliary[i];
        i++;
      } else {
        array[k] = auxiliary[j];
        j++;
      }
      k++;
      
      steps.add(SortingStep(
        array: List<int>.from(array),
        description: '放置元素到位置${k-1}',
        stepNumber: steps.length + 1,
        highlightRange: [k-1, k-1],
        auxiliaryData: List<int>.from(auxiliary.sublist(left, right + 1)),
      ));
    }
    
    // 复制剩余元素
    while (i <= mid) {
      array[k] = auxiliary[i];
      i++;
      k++;
    }
    
    while (j <= right) {
      array[k] = auxiliary[j];
      j++;
      k++;
    }
    
    steps.add(SortingStep(
      array: List<int>.from(array),
      description: '合并完成：[$left..$right]',
      stepNumber: steps.length + 1,
      highlightRange: [left, right],
    ));
  }
  
  /// 堆排序算法
  Future<List<SortingStep>> heapSort(List<int> input) async {
    final steps = <SortingStep>[];
    final array = List<int>.from(input);
    int n = array.length;
    
    // 第一步：构建最大堆
    steps.add(SortingStep(
      array: List<int>.from(array),
      description: '开始构建最大堆',
      stepNumber: steps.length + 1,
    ));
    
    for (int i = n ~/ 2 - 1; i >= 0; i--) {
      await _heapify(array, n, i, steps);
    }
    
    steps.add(SortingStep(
      array: List<int>.from(array),
      description: '最大堆构建完成',
      stepNumber: steps.length + 1,
      heapBoundary: n,
    ));
    
    // 第二步：逐个提取最大元素
    for (int i = n - 1; i > 0; i--) {
      steps.add(SortingStep(
        array: List<int>.from(array),
        swapping1: 0,
        swapping2: i,
        description: '将最大元素${array[0]}移到位置$i',
        stepNumber: steps.length + 1,
        heapBoundary: i + 1,
      ));
      
      // 交换根节点和最后一个节点
      int temp = array[0];
      array[0] = array[i];
      array[i] = temp;
      
      steps.add(SortingStep(
        array: List<int>.from(array),
        description: '最大元素已放置到正确位置',
        stepNumber: steps.length + 1,
        heapBoundary: i,
        sortedRange: [i, n - 1],
      ));
      
      // 调整剩余的堆
      await _heapify(array, i, 0, steps);
    }
    
    steps.add(SortingStep(
      array: List<int>.from(array),
      description: '堆排序完成！',
      stepNumber: steps.length + 1,
      sortedRange: [0, n - 1],
    ));
    
    return steps;
  }
  
  /// 堆调整函数
  Future<void> _heapify(
    List<int> array,
    int n,
    int i,
    List<SortingStep> steps,
  ) async {
    int largest = i;
    int left = 2 * i + 1;
    int right = 2 * i + 2;
    
    steps.add(SortingStep(
      array: List<int>.from(array),
      comparing1: i,
      description: '检查节点$i，左子节点${left < n ? left : "无"}，右子节点${right < n ? right : "无"}',
      stepNumber: steps.length + 1,
      heapBoundary: n,
    ));
    
    if (left < n) {
      steps.add(SortingStep(
        array: List<int>.from(array),
        comparing1: largest,
        comparing2: left,
        description: '比较：${array[largest]} vs ${array[left]}',
        stepNumber: steps.length + 1,
        heapBoundary: n,
      ));
      
      if (array[left] > array[largest]) {
        largest = left;
      }
    }
    
    if (right < n) {
      steps.add(SortingStep(
        array: List<int>.from(array),
        comparing1: largest,
        comparing2: right,
        description: '比较：${array[largest]} vs ${array[right]}',
        stepNumber: steps.length + 1,
        heapBoundary: n,
      ));
      
      if (array[right] > array[largest]) {
        largest = right;
      }
    }
    
    if (largest != i) {
      // 交换
      steps.add(SortingStep(
        array: List<int>.from(array),
        swapping1: i,
        swapping2: largest,
        description: '交换：${array[i]} ↔ ${array[largest]}',
        stepNumber: steps.length + 1,
        heapBoundary: n,
      ));
      
      int temp = array[i];
      array[i] = array[largest];
      array[largest] = temp;
      
      steps.add(SortingStep(
        array: List<int>.from(array),
        description: '交换完成',
        stepNumber: steps.length + 1,
        heapBoundary: n,
      ));
      
      // 递归调整子树
      await _heapify(array, n, largest, steps);
    }
  }
  
  /// 根据算法类型执行排序
  Future<List<SortingStep>> executeSort(
    AlgorithmType type,
    List<int> input,
  ) async {
    switch (type) {
      case AlgorithmType.bubbleSort:
        return bubbleSort(input);
      case AlgorithmType.selectionSort:
        return selectionSort(input);
      case AlgorithmType.insertionSort:
        return insertionSort(input);
      case AlgorithmType.quickSort:
        return quickSort(input);
      case AlgorithmType.mergeSort:
        return mergeSort(input);
      case AlgorithmType.heapSort:
        return heapSort(input);
    }
  }

  /// 获取算法的时间复杂度
  String getTimeComplexity(AlgorithmType type) {
    switch (type) {
      case AlgorithmType.bubbleSort:
      case AlgorithmType.selectionSort:
      case AlgorithmType.insertionSort:
        return 'O(n²)';
      case AlgorithmType.quickSort:
        return 'O(n log n) 平均, O(n²) 最坏';
      case AlgorithmType.mergeSort:
      case AlgorithmType.heapSort:
        return 'O(n log n)';
    }
  }

  /// 获取算法的空间复杂度
  String getSpaceComplexity(AlgorithmType type) {
    switch (type) {
      case AlgorithmType.bubbleSort:
      case AlgorithmType.selectionSort:
      case AlgorithmType.insertionSort:
      case AlgorithmType.heapSort:
        return 'O(1)';
      case AlgorithmType.quickSort:
        return 'O(log n)';
      case AlgorithmType.mergeSort:
        return 'O(n)';
    }
  }
}
