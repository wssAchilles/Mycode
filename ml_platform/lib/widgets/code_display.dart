// 代码/伪代码展示组件
import 'package:flutter/material.dart';
import 'package:ml_platform/config/app_theme.dart';

/// 算法代码展示组件
class CodeDisplay extends StatelessWidget {
  final String algorithmName;
  final int? currentLine;
  final String language; // 'pseudocode' or 'dart'
  
  const CodeDisplay({
    Key? key,
    required this.algorithmName,
    this.currentLine,
    this.language = 'pseudocode',
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final codeLines = _getAlgorithmCode(algorithmName, language);
    
    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.primaryColor.withOpacity(0.1),
              border: Border(
                bottom: BorderSide(color: theme.dividerColor),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  language == 'pseudocode' ? '伪代码' : 'Dart代码',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  algorithmName,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.primaryColor,
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: Container(
              color: AppTheme.surface.withOpacity(0.4),
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: codeLines.asMap().entries.map((entry) {
                    final lineNumber = entry.key + 1;
                    final lineContent = entry.value;
                    final isCurrentLine = currentLine == lineNumber;
                    
                    return Container(
                      margin: const EdgeInsets.symmetric(vertical: 2),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: isCurrentLine 
                            ? AppTheme.primary.withOpacity(0.15)
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(4),
                        border: isCurrentLine
                            ? Border.all(color: AppTheme.primary.withOpacity(0.5))
                            : null,
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(
                            width: 30,
                            child: Text(
                              '$lineNumber',
                              style: const TextStyle(
                                fontFamily: AppTheme.codeFont,
                                fontSize: 12,
                                color: AppTheme.textSecondary,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              lineContent,
                              style: TextStyle(
                                fontFamily: AppTheme.codeFont,
                                fontSize: 13,
                                color: isCurrentLine 
                                    ? AppTheme.textPrimary
                                    : AppTheme.textSecondary,
                                fontWeight: isCurrentLine
                                    ? FontWeight.bold
                                    : FontWeight.normal,
                              ),
                            ),
                          ),
                        ],
                      ),
                    );
                  }).toList(),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
  
  List<String> _getAlgorithmCode(String algorithmName, String language) {
    if (language == 'pseudocode') {
      return _getPseudocode(algorithmName);
    } else {
      return _getDartCode(algorithmName);
    }
  }
  
  List<String> _getPseudocode(String algorithmName) {
    switch (algorithmName.toLowerCase()) {
      case 'bubble_sort':
      case '冒泡排序':
        return [
          'function bubbleSort(array):',
          '    n = length(array)',
          '    for i from 0 to n-2:',
          '        for j from 0 to n-2-i:',
          '            if array[j] > array[j+1]:',
          '                swap(array[j], array[j+1])',
          '    return array',
        ];
      
      case 'merge_sort':
      case '归并排序':
        return [
          'function mergeSort(array):',
          '    if length(array) <= 1:',
          '        return array',
          '    mid = length(array) / 2',
          '    left = mergeSort(array[0...mid])',
          '    right = mergeSort(array[mid...end])',
          '    return merge(left, right)',
          '',
          'function merge(left, right):',
          '    result = []',
          '    while left and right not empty:',
          '        if left[0] <= right[0]:',
          '            append left[0] to result',
          '            remove left[0]',
          '        else:',
          '            append right[0] to result',
          '            remove right[0]',
          '    append remaining elements to result',
          '    return result',
        ];
      
      case 'heap_sort':
      case '堆排序':
        return [
          'function heapSort(array):',
          '    n = length(array)',
          '    // 构建最大堆',
          '    for i from n/2-1 down to 0:',
          '        heapify(array, n, i)',
          '    // 逐个提取元素',
          '    for i from n-1 down to 1:',
          '        swap(array[0], array[i])',
          '        heapify(array, i, 0)',
          '    return array',
          '',
          'function heapify(array, n, i):',
          '    largest = i',
          '    left = 2*i + 1',
          '    right = 2*i + 2',
          '    if left < n and array[left] > array[largest]:',
          '        largest = left',
          '    if right < n and array[right] > array[largest]:',
          '        largest = right',
          '    if largest != i:',
          '        swap(array[i], array[largest])',
          '        heapify(array, n, largest)',
        ];
      
      case 'quick_sort':
      case '快速排序':
        return [
          'function quickSort(array, low, high):',
          '    if low < high:',
          '        pivot = partition(array, low, high)',
          '        quickSort(array, low, pivot-1)',
          '        quickSort(array, pivot+1, high)',
          '    return array',
          '',
          'function partition(array, low, high):',
          '    pivot = array[high]',
          '    i = low - 1',
          '    for j from low to high-1:',
          '        if array[j] < pivot:',
          '            i++',
          '            swap(array[i], array[j])',
          '    swap(array[i+1], array[high])',
          '    return i+1',
        ];
      
      case 'bst_insert':
      case 'BST插入':
        return [
          'function insert(root, value):',
          '    if root is null:',
          '        return new Node(value)',
          '    if value < root.value:',
          '        root.left = insert(root.left, value)',
          '    else if value > root.value:',
          '        root.right = insert(root.right, value)',
          '    return root',
        ];
      
      case 'avl_insert':
      case 'AVL插入':
        return [
          'function avlInsert(root, value):',
          '    // 1. 执行标准BST插入',
          '    if root is null:',
          '        return new Node(value)',
          '    if value < root.value:',
          '        root.left = avlInsert(root.left, value)',
          '    else if value > root.value:',
          '        root.right = avlInsert(root.right, value)',
          '    else:',
          '        return root',
          '    ',
          '    // 2. 更新高度',
          '    root.height = 1 + max(height(root.left), height(root.right))',
          '    ',
          '    // 3. 获取平衡因子',
          '    balance = getBalance(root)',
          '    ',
          '    // 4. 如果不平衡，执行旋转',
          '    // 左左情况',
          '    if balance > 1 and value < root.left.value:',
          '        return rightRotate(root)',
          '    // 右右情况',
          '    if balance < -1 and value > root.right.value:',
          '        return leftRotate(root)',
          '    // 左右情况',
          '    if balance > 1 and value > root.left.value:',
          '        root.left = leftRotate(root.left)',
          '        return rightRotate(root)',
          '    // 右左情况',
          '    if balance < -1 and value < root.right.value:',
          '        root.right = rightRotate(root.right)',
          '        return leftRotate(root)',
          '    ',
          '    return root',
        ];
        
      default:
        return ['// 算法代码待实现'];
    }
  }
  
  List<String> _getDartCode(String algorithmName) {
    switch (algorithmName.toLowerCase()) {
      case 'bubble_sort':
      case '冒泡排序':
        return [
          'List<int> bubbleSort(List<int> array) {',
          '  int n = array.length;',
          '  for (int i = 0; i < n - 1; i++) {',
          '    for (int j = 0; j < n - i - 1; j++) {',
          '      if (array[j] > array[j + 1]) {',
          '        // 交换元素',
          '        int temp = array[j];',
          '        array[j] = array[j + 1];',
          '        array[j + 1] = temp;',
          '      }',
          '    }',
          '  }',
          '  return array;',
          '}',
        ];
        
      case 'merge_sort':
      case '归并排序':
        return [
          'List<int> mergeSort(List<int> array) {',
          '  if (array.length <= 1) return array;',
          '  ',
          '  int mid = array.length ~/ 2;',
          '  List<int> left = mergeSort(array.sublist(0, mid));',
          '  List<int> right = mergeSort(array.sublist(mid));',
          '  ',
          '  return merge(left, right);',
          '}',
          '',
          'List<int> merge(List<int> left, List<int> right) {',
          '  List<int> result = [];',
          '  int i = 0, j = 0;',
          '  ',
          '  while (i < left.length && j < right.length) {',
          '    if (left[i] <= right[j]) {',
          '      result.add(left[i++]);',
          '    } else {',
          '      result.add(right[j++]);',
          '    }',
          '  }',
          '  ',
          '  result.addAll(left.sublist(i));',
          '  result.addAll(right.sublist(j));',
          '  return result;',
          '}',
        ];
        
      default:
        return ['// Dart代码待实现'];
    }
  }
}
