// 算法对比模型
import 'package:flutter/material.dart';

/// 算法对比结果
class AlgorithmComparisonResult {
  final String algorithmName;
  final AlgorithmType type;
  final Map<String, dynamic> metrics;
  final Duration executionTime;
  final int dataSize;
  final Color color;
  
  AlgorithmComparisonResult({
    required this.algorithmName,
    required this.type,
    required this.metrics,
    required this.executionTime,
    required this.dataSize,
    required this.color,
  });
}

/// 算法类型
enum AlgorithmType {
  sorting('排序算法', Icons.sort),
  scheduling('调度算法', Icons.schedule),
  memory('内存管理', Icons.memory),
  tree('树算法', Icons.account_tree),
  graph('图算法', Icons.hub);
  
  final String label;
  final IconData icon;
  const AlgorithmType(this.label, this.icon);
}

/// 对比指标
class ComparisonMetric {
  final String name;
  final String unit;
  final bool lowerIsBetter;
  final Color color;
  
  const ComparisonMetric({
    required this.name,
    required this.unit,
    this.lowerIsBetter = true,
    required this.color,
  });
  
  /// 排序算法指标
  static const List<ComparisonMetric> sortingMetrics = [
    ComparisonMetric(
      name: '比较次数',
      unit: '次',
      lowerIsBetter: true,
      color: Colors.blue,
    ),
    ComparisonMetric(
      name: '交换次数',
      unit: '次',
      lowerIsBetter: true,
      color: Colors.red,
    ),
    ComparisonMetric(
      name: '执行时间',
      unit: 'ms',
      lowerIsBetter: true,
      color: Colors.green,
    ),
    ComparisonMetric(
      name: '空间复杂度',
      unit: 'KB',
      lowerIsBetter: true,
      color: Colors.orange,
    ),
  ];
  
  /// 调度算法指标
  static const List<ComparisonMetric> schedulingMetrics = [
    ComparisonMetric(
      name: '平均等待时间',
      unit: 'ms',
      lowerIsBetter: true,
      color: Colors.blue,
    ),
    ComparisonMetric(
      name: '平均周转时间',
      unit: 'ms',
      lowerIsBetter: true,
      color: Colors.red,
    ),
    ComparisonMetric(
      name: 'CPU利用率',
      unit: '%',
      lowerIsBetter: false,
      color: Colors.green,
    ),
    ComparisonMetric(
      name: '上下文切换',
      unit: '次',
      lowerIsBetter: true,
      color: Colors.orange,
    ),
  ];
  
  /// 内存管理指标
  static const List<ComparisonMetric> memoryMetrics = [
    ComparisonMetric(
      name: '内存利用率',
      unit: '%',
      lowerIsBetter: false,
      color: Colors.blue,
    ),
    ComparisonMetric(
      name: '外部碎片',
      unit: 'KB',
      lowerIsBetter: true,
      color: Colors.red,
    ),
    ComparisonMetric(
      name: '缺页次数',
      unit: '次',
      lowerIsBetter: true,
      color: Colors.orange,
    ),
    ComparisonMetric(
      name: '缺页率',
      unit: '%',
      lowerIsBetter: true,
      color: Colors.purple,
    ),
  ];
  
  /// 获取指定类型的指标
  static List<ComparisonMetric> getMetricsForType(AlgorithmType type) {
    switch (type) {
      case AlgorithmType.sorting:
        return sortingMetrics;
      case AlgorithmType.scheduling:
        return schedulingMetrics;
      case AlgorithmType.memory:
        return memoryMetrics;
      case AlgorithmType.tree:
      case AlgorithmType.graph:
        return [
          const ComparisonMetric(
            name: '节点访问次数',
            unit: '次',
            lowerIsBetter: true,
            color: Colors.blue,
          ),
          const ComparisonMetric(
            name: '路径长度',
            unit: '',
            lowerIsBetter: true,
            color: Colors.green,
          ),
        ];
    }
  }
}

/// 对比配置
class ComparisonConfig {
  final AlgorithmType type;
  final List<String> selectedAlgorithms;
  final int testDataSize;
  final int testRounds;
  final bool includeVisualization;
  
  ComparisonConfig({
    required this.type,
    required this.selectedAlgorithms,
    this.testDataSize = 100,
    this.testRounds = 10,
    this.includeVisualization = true,
  });
}

/// 对比报告
class ComparisonReport {
  final AlgorithmType type;
  final List<AlgorithmComparisonResult> results;
  final DateTime timestamp;
  final ComparisonConfig config;
  final Map<String, dynamic> summary;
  
  ComparisonReport({
    required this.type,
    required this.results,
    required this.config,
    Map<String, dynamic>? summary,
  }) : timestamp = DateTime.now(),
       summary = summary ?? {};
  
  /// 获取最佳算法
  String getBestAlgorithmForMetric(String metricName) {
    if (results.isEmpty) return '';
    
    final metrics = ComparisonMetric.getMetricsForType(type);
    final metric = metrics.firstWhere(
      (m) => m.name == metricName,
      orElse: () => metrics.first,
    );
    
    AlgorithmComparisonResult? best;
    for (var result in results) {
      final value = result.metrics[metricName];
      if (value == null) continue;
      
      if (best == null) {
        best = result;
      } else {
        final bestValue = best.metrics[metricName];
        if (bestValue == null) continue;
        
        if (metric.lowerIsBetter) {
          if (value < bestValue) best = result;
        } else {
          if (value > bestValue) best = result;
        }
      }
    }
    
    return best?.algorithmName ?? '';
  }
  
  /// 获取性能排名
  List<String> getPerformanceRanking() {
    if (results.isEmpty) return [];
    
    // 基于多个指标的综合评分
    final scores = <String, double>{};
    
    for (var result in results) {
      double totalScore = 0;
      int validMetrics = 0;
      
      for (var metric in ComparisonMetric.getMetricsForType(type)) {
        final value = result.metrics[metric.name];
        if (value != null && value is num) {
          // 标准化分数（0-100）
          final normalized = _normalizeScore(value.toDouble(), metric.name);
          totalScore += normalized;
          validMetrics++;
        }
      }
      
      if (validMetrics > 0) {
        scores[result.algorithmName] = totalScore / validMetrics;
      }
    }
    
    final sortedEntries = scores.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    
    return sortedEntries.map((e) => e.key).toList();
  }
  
  /// 标准化分数
  double _normalizeScore(double value, String metricName) {
    // 简化的标准化逻辑，实际应该基于所有结果的最大最小值
    final allValues = results
        .map((r) => r.metrics[metricName])
        .where((v) => v != null && v is num)
        .map((v) => (v as num).toDouble())
        .toList();
    
    if (allValues.isEmpty) return 50;
    
    final min = allValues.reduce((a, b) => a < b ? a : b);
    final max = allValues.reduce((a, b) => a > b ? a : b);
    
    if (max == min) return 50;
    
    final normalized = (value - min) / (max - min) * 100;
    
    // 对于"越小越好"的指标，需要反转分数
    final metric = ComparisonMetric.getMetricsForType(type)
        .firstWhere((m) => m.name == metricName);
    
    return metric.lowerIsBetter ? 100 - normalized : normalized;
  }
}

/// 对比测试用例
class ComparisonTestCase {
  final String name;
  final List<int> data;
  final Map<String, dynamic> parameters;
  
  ComparisonTestCase({
    required this.name,
    required this.data,
    this.parameters = const {},
  });
  
  /// 生成测试用例
  static List<ComparisonTestCase> generateTestCases(
    AlgorithmType type,
    int size,
  ) {
    switch (type) {
      case AlgorithmType.sorting:
        return _generateSortingTestCases(size);
      case AlgorithmType.scheduling:
        return _generateSchedulingTestCases(size);
      case AlgorithmType.memory:
        return _generateMemoryTestCases(size);
      case AlgorithmType.tree:
        return _generateTreeTestCases(size);
      case AlgorithmType.graph:
        return _generateGraphTestCases(size);
    }
  }
  
  static List<ComparisonTestCase> _generateSortingTestCases(int size) {
    return [
      ComparisonTestCase(
        name: '随机数据',
        data: List.generate(size, (_) => DateTime.now().millisecondsSinceEpoch % 1000),
      ),
      ComparisonTestCase(
        name: '已排序数据',
        data: List.generate(size, (i) => i),
      ),
      ComparisonTestCase(
        name: '逆序数据',
        data: List.generate(size, (i) => size - i),
      ),
      ComparisonTestCase(
        name: '部分有序',
        data: _generatePartiallyOrdered(size),
      ),
    ];
  }
  
  static List<ComparisonTestCase> _generateSchedulingTestCases(int size) {
    return [
      ComparisonTestCase(
        name: '短作业优先',
        data: List.generate(size, (i) => i + 1),
        parameters: {'type': 'short_jobs'},
      ),
      ComparisonTestCase(
        name: '长作业优先',
        data: List.generate(size, (i) => (size - i) * 10),
        parameters: {'type': 'long_jobs'},
      ),
      ComparisonTestCase(
        name: '混合负载',
        data: _generateMixedWorkload(size),
        parameters: {'type': 'mixed'},
      ),
    ];
  }
  
  static List<ComparisonTestCase> _generateMemoryTestCases(int size) {
    return [
      ComparisonTestCase(
        name: '顺序访问',
        data: List.generate(size, (i) => i % 10),
        parameters: {'pattern': 'sequential'},
      ),
      ComparisonTestCase(
        name: '随机访问',
        data: List.generate(size, (_) => DateTime.now().millisecondsSinceEpoch % 10),
        parameters: {'pattern': 'random'},
      ),
      ComparisonTestCase(
        name: '局部性访问',
        data: _generateLocalityPattern(size),
        parameters: {'pattern': 'locality'},
      ),
    ];
  }
  
  static List<ComparisonTestCase> _generateTreeTestCases(int size) {
    return [
      ComparisonTestCase(
        name: '平衡插入',
        data: _generateBalancedInsert(size),
      ),
      ComparisonTestCase(
        name: '顺序插入',
        data: List.generate(size, (i) => i),
      ),
    ];
  }
  
  static List<ComparisonTestCase> _generateGraphTestCases(int size) {
    return [
      ComparisonTestCase(
        name: '稀疏图',
        data: _generateSparseGraph(size),
      ),
      ComparisonTestCase(
        name: '密集图',
        data: _generateDenseGraph(size),
      ),
    ];
  }
  
  static List<int> _generatePartiallyOrdered(int size) {
    final result = List.generate(size, (i) => i);
    // 随机交换一些元素
    for (int i = 0; i < size ~/ 4; i++) {
      final a = DateTime.now().millisecondsSinceEpoch % size;
      final b = DateTime.now().millisecondsSinceEpoch % size;
      final temp = result[a];
      result[a] = result[b];
      result[b] = temp;
    }
    return result;
  }
  
  static List<int> _generateMixedWorkload(int size) {
    final result = <int>[];
    for (int i = 0; i < size; i++) {
      if (i % 3 == 0) {
        result.add(1); // 短作业
      } else if (i % 3 == 1) {
        result.add(10); // 中等作业
      } else {
        result.add(50); // 长作业
      }
    }
    return result;
  }
  
  static List<int> _generateLocalityPattern(int size) {
    final result = <int>[];
    int current = 0;
    for (int i = 0; i < size; i++) {
      result.add(current);
      if (i % 5 == 4) {
        current = (current + 1) % 10;
      }
    }
    return result;
  }
  
  static List<int> _generateBalancedInsert(int size) {
    if (size <= 1) return [1];
    
    final result = <int>[];
    final middle = size ~/ 2;
    result.add(middle);
    
    // 递归添加左右子树
    for (int i = 1; i < size; i++) {
      if (i % 2 == 1) {
        result.add(middle - (i ~/ 2) - 1);
      } else {
        result.add(middle + (i ~/ 2));
      }
    }
    
    return result.where((x) => x >= 0 && x < size).toList();
  }
  
  static List<int> _generateSparseGraph(int size) {
    // 生成稀疏图的边列表
    final edges = <int>[];
    for (int i = 0; i < size - 1; i++) {
      edges.add(i);
      edges.add(i + 1);
    }
    return edges;
  }
  
  static List<int> _generateDenseGraph(int size) {
    // 生成密集图的边列表
    final edges = <int>[];
    for (int i = 0; i < size; i++) {
      for (int j = i + 1; j < size; j++) {
        if (edges.length < size * 2) {
          edges.add(i);
          edges.add(j);
        }
      }
    }
    return edges;
  }
}
