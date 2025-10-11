// 算法对比服务
import 'dart:async';
import 'package:ml_platform/models/comparison_model.dart' as comp;
import 'package:ml_platform/models/algorithm_model.dart' as algo;
import 'package:ml_platform/models/os/process_model.dart';
import 'package:ml_platform/models/os/memory_model.dart';
import 'package:ml_platform/services/algorithm_service.dart';
import 'package:ml_platform/services/os/scheduler_service.dart';
import 'package:ml_platform/services/os/memory_service.dart';
import 'package:ml_platform/utils/app_exceptions.dart';
import 'package:flutter/material.dart';

/// 算法对比服务
class ComparisonService {
  static final ComparisonService _instance = ComparisonService._internal();
  factory ComparisonService() => _instance;
  ComparisonService._internal();
  
  final AlgorithmService _algorithmService = AlgorithmService();
  final SchedulerService _schedulerService = SchedulerService();
  final MemoryService _memoryService = MemoryService();
  
  /// 执行算法对比
  Future<ComparisonReport> executeComparison(ComparisonConfig config) async {
    final results = <AlgorithmComparisonResult>[];
    final colors = [
      Colors.blue,
      Colors.red,
      Colors.green,
      Colors.orange,
      Colors.purple,
      Colors.teal,
      Colors.indigo,
      Colors.pink,
    ];
    
    // 生成测试用例
    final testCases = ComparisonTestCase.generateTestCases(
      config.type,
      config.testDataSize,
    );
    
    for (int i = 0; i < config.selectedAlgorithms.length; i++) {
      final algorithmName = config.selectedAlgorithms[i];
      final color = colors[i % colors.length];
      
      final result = await _runAlgorithmTest(
        algorithmName,
        config.type,
        testCases,
        config.testRounds,
        color,
      );
      
      if (result != null) {
        results.add(result);
      }
    }
    
    return ComparisonReport(
      type: config.type,
      results: results,
      config: config,
      summary: _generateSummary(results, config),
    );
  }
  
  /// 运行单个算法测试
  Future<AlgorithmComparisonResult?> _runAlgorithmTest(
    String algorithmName,
    comp.AlgorithmType type,
    List<ComparisonTestCase> testCases,
    int rounds,
    Color color,
  ) async {
    final stopwatch = Stopwatch();
    final allMetrics = <String, List<double>>{};
    
    for (final testCase in testCases) {
      for (int round = 0; round < rounds; round++) {
        stopwatch.start();
        
        final metrics = await _executeAlgorithm(
          algorithmName,
          type,
          testCase,
        );
        
        stopwatch.stop();
        
        if (metrics != null) {
          metrics['执行时间'] = stopwatch.elapsedMicroseconds / 1000.0;
          
          for (final entry in metrics.entries) {
            allMetrics.putIfAbsent(entry.key, () => []);
            allMetrics[entry.key]!.add(entry.value.toDouble());
          }
        }
        
        stopwatch.reset();
      }
    }
    
    // 计算平均值
    final averageMetrics = <String, dynamic>{};
    for (final entry in allMetrics.entries) {
      final values = entry.value;
      if (values.isNotEmpty) {
        averageMetrics[entry.key] = values.reduce((a, b) => a + b) / values.length;
      }
    }
    
    if (averageMetrics.isEmpty) return null;
    
    return AlgorithmComparisonResult(
      algorithmName: algorithmName,
      type: type,
      metrics: averageMetrics,
      executionTime: Duration(microseconds: stopwatch.elapsedMicroseconds),
      dataSize: testCases.first.data.length,
      color: color,
    );
  }
  
  /// 执行具体算法
  Future<Map<String, num>?> _executeAlgorithm(
    String algorithmName,
    comp.AlgorithmType type,
    ComparisonTestCase testCase,
  ) async {
    try {
      switch (type) {
        case comp.AlgorithmType.sorting:
          return await _executeSortingAlgorithm(algorithmName, testCase);
        case comp.AlgorithmType.scheduling:
          return await _executeSchedulingAlgorithm(algorithmName, testCase);
        case comp.AlgorithmType.memory:
          return await _executeMemoryAlgorithm(algorithmName, testCase);
        case comp.AlgorithmType.tree:
          return await _executeTreeAlgorithm(algorithmName, testCase);
        case comp.AlgorithmType.graph:
          return await _executeGraphAlgorithm(algorithmName, testCase);
      }
    } catch (e) {
      throw BusinessLogicException('算法 $algorithmName 执行失败: ${e.toString()}', originalError: e);
    }
  }
  
  /// 执行排序算法
  Future<Map<String, num>?> _executeSortingAlgorithm(
    String algorithmName,
    ComparisonTestCase testCase,
  ) async {
    final algorithm = _getAlgorithmEnum(algorithmName);
    if (algorithm == null) return null;
    
    final result = _algorithmService.sort(
      data: List<int>.from(testCase.data),
      algorithm: algorithm,
    );
    
    return {
      '比较次数': result.comparisons,
      '交换次数': result.swaps,
      '数组访问': result.arrayAccesses,
      '空间复杂度': _estimateSpaceComplexity(algorithmName, testCase.data.length),
    };
  }
  
  /// 执行调度算法
  Future<Map<String, num>?> _executeSchedulingAlgorithm(
    String algorithmName,
    ComparisonTestCase testCase,
  ) async {
    final algorithm = _getSchedulingEnum(algorithmName);
    if (algorithm == null) return null;
    
    // 创建进程列表
    final processes = testCase.data.asMap().entries.map((entry) {
      return Process(
        pid: entry.key + 1,
        arrivalTime: 0,
        burstTime: entry.value,
        priority: entry.value % 10,
      );
    }).toList();
    
    final result = _schedulerService.executeScheduling(
      processes: processes,
      algorithm: algorithm,
      config: const SchedulingConfig(),
    );
    
    return {
      '平均等待时间': result.averageWaitingTime,
      '平均周转时间': result.averageTurnaroundTime,
      'CPU利用率': result.cpuUtilization * 100,
      '上下文切换': result.contextSwitches,
      '平均响应时间': result.averageResponseTime,
    };
  }
  
  /// 执行内存管理算法
  Future<Map<String, num>?> _executeMemoryAlgorithm(
    String algorithmName,
    ComparisonTestCase testCase,
  ) async {
    if (algorithmName.contains('置换')) {
      return await _executePageReplacementAlgorithm(algorithmName, testCase);
    } else {
      return await _executeMemoryAllocationAlgorithm(algorithmName, testCase);
    }
  }
  
  /// 执行页面置换算法
  Future<Map<String, num>?> _executePageReplacementAlgorithm(
    String algorithmName,
    ComparisonTestCase testCase,
  ) async {
    final algorithm = _getPageReplacementEnum(algorithmName);
    if (algorithm == null) return null;
    
    final requests = testCase.data.map((page) {
      return PageRequest(pageNumber: page);
    }).toList();
    
    final result = _memoryService.executePageReplacement(
      requests: requests,
      frameCount: 4,
      algorithm: algorithm,
    );
    
    return {
      '缺页次数': result.totalPageFaults,
      '缺页率': result.pageFaultRate * 100,
      '页框利用率': (result.frameCount > 0 ? 
          (result.totalPageFaults / result.requests.length * 100) : 0),
    };
  }
  
  /// 执行内存分配算法
  Future<Map<String, num>?> _executeMemoryAllocationAlgorithm(
    String algorithmName,
    ComparisonTestCase testCase,
  ) async {
    final algorithm = _getMemoryAllocationEnum(algorithmName);
    if (algorithm == null) return null;
    
    final memory = _memoryService.initializeMemory(1024);
    int successfulAllocations = 0;
    int totalFragmentation = 0;
    
    for (int i = 0; i < testCase.data.length; i++) {
      final request = MemoryRequest(
        processId: i + 1,
        processName: 'P${i + 1}',
        size: testCase.data[i],
        timestamp: i,
      );
      
      final result = _memoryService.allocateMemory(
        memory: memory,
        request: request,
        algorithm: algorithm,
      );
      
      if (result.success) {
        successfulAllocations++;
        memory.clear();
        memory.addAll(result.memoryState);
      }
      
      totalFragmentation += result.externalFragmentation;
    }
    
    return {
      '成功分配率': (successfulAllocations / testCase.data.length) * 100,
      '平均外部碎片': totalFragmentation / testCase.data.length,
      '内存利用率': (successfulAllocations / testCase.data.length) * 100,
    };
  }
  
  /// 执行树算法
  Future<Map<String, num>?> _executeTreeAlgorithm(
    String algorithmName,
    ComparisonTestCase testCase,
  ) async {
    // 简化的树算法测试
    int nodeAccesses = 0;
    int maxDepth = 0;
    
    // 模拟树操作
    for (final value in testCase.data) {
      nodeAccesses += (value.bitLength); // 模拟查找深度
      maxDepth = maxDepth > value ? maxDepth : value;
    }
    
    return {
      '节点访问次数': nodeAccesses,
      '最大深度': maxDepth,
      '平均查找长度': nodeAccesses / testCase.data.length,
    };
  }
  
  /// 执行图算法
  Future<Map<String, num>?> _executeGraphAlgorithm(
    String algorithmName,
    ComparisonTestCase testCase,
  ) async {
    // 简化的图算法测试
    int edgeTraversals = 0;
    int pathLength = 0;
    
    // 模拟图遍历
    for (int i = 0; i < testCase.data.length - 1; i++) {
      edgeTraversals++;
      pathLength += (testCase.data[i] - testCase.data[i + 1]).abs();
    }
    
    return {
      '边遍历次数': edgeTraversals,
      '路径长度': pathLength,
      '平均路径成本': edgeTraversals > 0 ? pathLength / edgeTraversals : 0,
    };
  }
  
  /// 生成对比总结
  Map<String, dynamic> _generateSummary(
    List<AlgorithmComparisonResult> results,
    ComparisonConfig config,
  ) {
    if (results.isEmpty) return {};
    
    final summary = <String, dynamic>{};
    final metrics = ComparisonMetric.getMetricsForType(config.type);
    
    // 找出每个指标的最佳算法
    for (final metric in metrics) {
      AlgorithmComparisonResult? best;
      for (final result in results) {
        final value = result.metrics[metric.name];
        if (value == null) continue;
        
        if (best == null) {
          best = result;
        } else {
          final bestValue = best.metrics[metric.name];
          if (bestValue == null) continue;
          
          if (metric.lowerIsBetter) {
            if (value < bestValue) best = result;
          } else {
            if (value > bestValue) best = result;
          }
        }
      }
      
      if (best != null) {
        summary['best_${metric.name}'] = best.algorithmName;
      }
    }
    
    // 计算整体推荐
    final scores = <String, double>{};
    for (final result in results) {
      double score = 0;
      int validMetrics = 0;
      
      for (final metric in metrics) {
        final value = result.metrics[metric.name];
        if (value != null && value is num) {
          score += _calculateNormalizedScore(value.toDouble(), metric, results);
          validMetrics++;
        }
      }
      
      if (validMetrics > 0) {
        scores[result.algorithmName] = score / validMetrics;
      }
    }
    
    final bestOverall = scores.entries
        .reduce((a, b) => a.value > b.value ? a : b);
    summary['overall_best'] = bestOverall.key;
    summary['scores'] = scores;
    
    return summary;
  }
  
  /// 计算标准化分数
  double _calculateNormalizedScore(
    double value,
    ComparisonMetric metric,
    List<AlgorithmComparisonResult> allResults,
  ) {
    final allValues = allResults
        .map((r) => r.metrics[metric.name])
        .where((v) => v != null && v is num)
        .map((v) => (v as num).toDouble())
        .toList();
    
    if (allValues.isEmpty || allValues.length == 1) return 50;
    
    final min = allValues.reduce((a, b) => a < b ? a : b);
    final max = allValues.reduce((a, b) => a > b ? a : b);
    
    if (max == min) return 50;
    
    final normalized = (value - min) / (max - min) * 100;
    return metric.lowerIsBetter ? 100 - normalized : normalized;
  }
  
  /// 估算空间复杂度
  int _estimateSpaceComplexity(String algorithmName, int dataSize) {
    switch (algorithmName) {
      case '归并排序':
        return dataSize; // O(n)
      case '快速排序':
        return (dataSize * 0.1).toInt(); // O(log n) 平均
      case '堆排序':
        return 1; // O(1)
      case '冒泡排序':
      case '选择排序':
      case '插入排序':
        return 1; // O(1)
      default:
        return dataSize ~/ 2; // 默认估算
    }
  }
  
  /// 获取排序算法枚举
  Algorithm? _getAlgorithmEnum(String name) {
    switch (name) {
      case '冒泡排序':
        return Algorithm.bubbleSort;
      case '选择排序':
        return Algorithm.selectionSort;
      case '插入排序':
        return Algorithm.insertionSort;
      case '快速排序':
        return Algorithm.quickSort;
      case '归并排序':
        return Algorithm.mergeSort;
      case '堆排序':
        return Algorithm.heapSort;
      default:
        return null;
    }
  }
  
  /// 获取调度算法枚举
  SchedulingAlgorithm? _getSchedulingEnum(String name) {
    switch (name) {
      case 'FCFS':
        return SchedulingAlgorithm.fcfs;
      case 'SJF':
        return SchedulingAlgorithm.sjf;
      case 'Priority':
        return SchedulingAlgorithm.priority;
      case 'RR':
        return SchedulingAlgorithm.rr;
      case 'MLFQ':
        return SchedulingAlgorithm.mlfq;
      default:
        return null;
    }
  }
  
  /// 获取页面置换算法枚举
  PageReplacementAlgorithm? _getPageReplacementEnum(String name) {
    switch (name) {
      case 'FIFO置换':
        return PageReplacementAlgorithm.fifo;
      case 'LRU置换':
        return PageReplacementAlgorithm.lru;
      case 'OPT置换':
        return PageReplacementAlgorithm.opt;
      default:
        return null;
    }
  }
  
  /// 获取内存分配算法枚举
  MemoryAllocationAlgorithm? _getMemoryAllocationEnum(String name) {
    switch (name) {
      case '首次适应':
        return MemoryAllocationAlgorithm.firstFit;
      case '最佳适应':
        return MemoryAllocationAlgorithm.bestFit;
      case '最坏适应':
        return MemoryAllocationAlgorithm.worstFit;
      default:
        return null;
    }
  }
  
  /// 获取可用算法列表
  List<String> getAvailableAlgorithms(comp.AlgorithmType type) {
    switch (type) {
      case comp.AlgorithmType.sorting:
        return ['冒泡排序', '选择排序', '插入排序', '快速排序', '归并排序', '堆排序'];
      case comp.AlgorithmType.scheduling:
        return ['FCFS', 'SJF', 'Priority', 'RR', 'MLFQ'];
      case comp.AlgorithmType.memory:
        return ['首次适应', '最佳适应', '最坏适应', 'FIFO置换', 'LRU置换', 'OPT置换'];
      case comp.AlgorithmType.tree:
        return ['二叉搜索树', 'AVL树', '红黑树'];
      case comp.AlgorithmType.graph:
        return ['DFS', 'BFS', 'Dijkstra'];
    }
  }
  
  /// 导出对比结果
  String exportComparisonResult(ComparisonReport report) {
    final buffer = StringBuffer();
    
    buffer.writeln('算法对比报告');
    buffer.writeln('=' * 50);
    buffer.writeln('算法类型: ${report.type.label}');
    buffer.writeln('测试时间: ${report.timestamp}');
    buffer.writeln('数据规模: ${report.config.testDataSize}');
    buffer.writeln('测试轮次: ${report.config.testRounds}');
    buffer.writeln();
    
    // 算法结果
    buffer.writeln('算法测试结果:');
    buffer.writeln('-' * 30);
    
    for (final result in report.results) {
      buffer.writeln('${result.algorithmName}:');
      for (final entry in result.metrics.entries) {
        buffer.writeln('  ${entry.key}: ${entry.value}');
      }
      buffer.writeln();
    }
    
    // 最佳推荐
    buffer.writeln('推荐结果:');
    buffer.writeln('-' * 30);
    
    final metrics = ComparisonMetric.getMetricsForType(report.type);
    for (final metric in metrics) {
      final best = report.getBestAlgorithmForMetric(metric.name);
      if (best.isNotEmpty) {
        buffer.writeln('${metric.name}最佳: $best');
      }
    }
    
    final ranking = report.getPerformanceRanking();
    if (ranking.isNotEmpty) {
      buffer.writeln('\n综合性能排名:');
      for (int i = 0; i < ranking.length; i++) {
        buffer.writeln('${i + 1}. ${ranking[i]}');
      }
    }
    
    return buffer.toString();
  }
}
