// 算法复杂度分析模型
import 'package:flutter/material.dart';
import 'dart:math' as math;

/// 复杂度类型
enum ComplexityType {
  constant('O(1)', '常数', Colors.green),
  logarithmic('O(log n)', '对数', Colors.lightGreen),
  linear('O(n)', '线性', Colors.yellow),
  linearithmic('O(n log n)', '线性对数', Colors.orange),
  quadratic('O(n²)', '平方', Colors.deepOrange),
  cubic('O(n³)', '立方', Colors.red),
  exponential('O(2^n)', '指数', Colors.purple),
  factorial('O(n!)', '阶乘', Colors.black);
  
  final String notation;
  final String name;
  final Color color;
  const ComplexityType(this.notation, this.name, this.color);
}

/// 复杂度分析
class ComplexityAnalysis {
  final String algorithmName;
  final ComplexityType bestTimeComplexity;
  final ComplexityType averageTimeComplexity;
  final ComplexityType worstTimeComplexity;
  final ComplexityType spaceComplexity;
  final String explanation;
  final List<ComplexityFactor> factors;
  final Map<int, double> benchmarkData;
  
  ComplexityAnalysis({
    required this.algorithmName,
    required this.bestTimeComplexity,
    required this.averageTimeComplexity,
    required this.worstTimeComplexity,
    required this.spaceComplexity,
    required this.explanation,
    this.factors = const [],
    this.benchmarkData = const {},
  });
}

/// 复杂度影响因素
class ComplexityFactor {
  final String name;
  final String description;
  final ComplexityImpact impact;
  
  ComplexityFactor({
    required this.name,
    required this.description,
    required this.impact,
  });
}

/// 影响程度
enum ComplexityImpact {
  positive('正向', Colors.green),
  negative('负向', Colors.red),
  neutral('中性', Colors.grey);
  
  final String label;
  final Color color;
  const ComplexityImpact(this.label, this.color);
}

/// 复杂度对比点
class ComplexityDataPoint {
  final int inputSize;
  final double actualTime;
  final double theoreticalTime;
  final double memoryUsage;
  
  ComplexityDataPoint({
    required this.inputSize,
    required this.actualTime,
    required this.theoreticalTime,
    required this.memoryUsage,
  });
}

/// 复杂度分析服务
class ComplexityAnalysisService {
  static final ComplexityAnalysisService _instance = ComplexityAnalysisService._internal();
  factory ComplexityAnalysisService() => _instance;
  ComplexityAnalysisService._internal();
  
  /// 获取算法复杂度分析
  ComplexityAnalysis getAlgorithmComplexity(String algorithmName) {
    switch (algorithmName.toLowerCase()) {
      case '冒泡排序':
      case 'bubblesort':
        return ComplexityAnalysis(
          algorithmName: '冒泡排序',
          bestTimeComplexity: ComplexityType.linear,
          averageTimeComplexity: ComplexityType.quadratic,
          worstTimeComplexity: ComplexityType.quadratic,
          spaceComplexity: ComplexityType.constant,
          explanation: '''
冒泡排序通过相邻元素的比较和交换来排序：

**时间复杂度分析：**
- 最佳情况 O(n)：数组已经有序，只需要一轮遍历
- 平均情况 O(n²)：需要大约 n²/4 次比较
- 最坏情况 O(n²)：数组完全逆序，需要 n(n-1)/2 次比较

**空间复杂度分析：**
- O(1)：只需要常数个额外变量存储临时数据

**主要特点：**
- 稳定排序算法
- 原地排序
- 简单但效率低
- 适合小规模数据或教学演示
          ''',
          factors: [
            ComplexityFactor(
              name: '数据初始顺序',
              description: '已排序的数据能显著提升性能',
              impact: ComplexityImpact.positive,
            ),
            ComplexityFactor(
              name: '数据规模',
              description: '数据量增大时性能急剧下降',
              impact: ComplexityImpact.negative,
            ),
            ComplexityFactor(
              name: '提前终止优化',
              description: '检测到有序时可以提前结束',
              impact: ComplexityImpact.positive,
            ),
          ],
        );
        
      case '快速排序':
      case 'quicksort':
        return ComplexityAnalysis(
          algorithmName: '快速排序',
          bestTimeComplexity: ComplexityType.linearithmic,
          averageTimeComplexity: ComplexityType.linearithmic,
          worstTimeComplexity: ComplexityType.quadratic,
          spaceComplexity: ComplexityType.logarithmic,
          explanation: '''
快速排序采用分治策略，选择基准元素进行分区：

**时间复杂度分析：**
- 最佳情况 O(n log n)：每次分区都均匀分割
- 平均情况 O(n log n)：随机基准选择下的期望性能
- 最坏情况 O(n²)：每次分区都极不均匀（如选择最大/最小元素作为基准）

**空间复杂度分析：**
- 平均情况 O(log n)：递归调用栈的深度
- 最坏情况 O(n)：递归深度达到n

**主要特点：**
- 不稳定排序算法
- 原地排序（不考虑递归栈）
- 实际应用中性能优秀
- 基准选择策略很重要
          ''',
          factors: [
            ComplexityFactor(
              name: '基准选择策略',
              description: '随机或三数取中法能避免最坏情况',
              impact: ComplexityImpact.positive,
            ),
            ComplexityFactor(
              name: '数据分布',
              description: '均匀分布的数据性能最佳',
              impact: ComplexityImpact.neutral,
            ),
            ComplexityFactor(
              name: '重复元素',
              description: '大量重复元素可能影响分区效果',
              impact: ComplexityImpact.negative,
            ),
          ],
        );
        
      case '归并排序':
      case 'mergesort':
        return ComplexityAnalysis(
          algorithmName: '归并排序',
          bestTimeComplexity: ComplexityType.linearithmic,
          averageTimeComplexity: ComplexityType.linearithmic,
          worstTimeComplexity: ComplexityType.linearithmic,
          spaceComplexity: ComplexityType.linear,
          explanation: '''
归并排序采用分治策略，将数组分解后合并：

**时间复杂度分析：**
- 所有情况都是 O(n log n)：性能稳定，不受数据分布影响
- 递归深度为 log n，每层需要 O(n) 时间合并

**空间复杂度分析：**
- O(n)：需要额外的数组空间进行合并

**主要特点：**
- 稳定排序算法
- 性能稳定可预测
- 适合外部排序
- 空间开销较大
          ''',
          factors: [
            ComplexityFactor(
              name: '稳定性能',
              description: '不受输入数据影响，性能可预测',
              impact: ComplexityImpact.positive,
            ),
            ComplexityFactor(
              name: '额外空间',
              description: '需要O(n)的额外空间',
              impact: ComplexityImpact.negative,
            ),
            ComplexityFactor(
              name: '缓存友好',
              description: '顺序访问模式对缓存友好',
              impact: ComplexityImpact.positive,
            ),
          ],
        );
        
      case 'fcfs':
        return ComplexityAnalysis(
          algorithmName: 'FCFS调度',
          bestTimeComplexity: ComplexityType.linear,
          averageTimeComplexity: ComplexityType.linear,
          worstTimeComplexity: ComplexityType.linear,
          spaceComplexity: ComplexityType.constant,
          explanation: '''
先来先服务(FCFS)调度算法：

**时间复杂度分析：**
- O(n)：需要遍历所有进程按到达时间执行

**空间复杂度分析：**
- O(1)：只需要常数额外空间

**主要特点：**
- 简单易实现
- 非抢占式
- 可能导致护航效应
- 平均等待时间可能较长
          ''',
          factors: [
            ComplexityFactor(
              name: '护航效应',
              description: '长进程在前会影响后续短进程',
              impact: ComplexityImpact.negative,
            ),
            ComplexityFactor(
              name: '实现简单',
              description: '算法逻辑简单，开销小',
              impact: ComplexityImpact.positive,
            ),
          ],
        );
        
      case 'sjf':
        return ComplexityAnalysis(
          algorithmName: 'SJF调度',
          bestTimeComplexity: ComplexityType.linearithmic,
          averageTimeComplexity: ComplexityType.linearithmic,
          worstTimeComplexity: ComplexityType.linearithmic,
          spaceComplexity: ComplexityType.constant,
          explanation: '''
短作业优先(SJF)调度算法：

**时间复杂度分析：**
- O(n log n)：需要按服务时间排序

**空间复杂度分析：**
- O(1)：原地排序情况下

**主要特点：**
- 理论上最优的平均等待时间
- 可能导致饥饿问题
- 难以准确预测服务时间
          ''',
          factors: [
            ComplexityFactor(
              name: '最优等待时间',
              description: '理论上能达到最短平均等待时间',
              impact: ComplexityImpact.positive,
            ),
            ComplexityFactor(
              name: '长进程饥饿',
              description: '长进程可能永远得不到执行',
              impact: ComplexityImpact.negative,
            ),
          ],
        );
        
      default:
        return ComplexityAnalysis(
          algorithmName: algorithmName,
          bestTimeComplexity: ComplexityType.linear,
          averageTimeComplexity: ComplexityType.linear,
          worstTimeComplexity: ComplexityType.quadratic,
          spaceComplexity: ComplexityType.constant,
          explanation: '暂无该算法的详细复杂度分析',
        );
    }
  }
  
  /// 计算理论复杂度值
  double calculateTheoreticalComplexity(ComplexityType type, int n) {
    switch (type) {
      case ComplexityType.constant:
        return 1.0;
      case ComplexityType.logarithmic:
        return math.log(n) / math.ln2;
      case ComplexityType.linear:
        return n.toDouble();
      case ComplexityType.linearithmic:
        return n * math.log(n) / math.ln2;
      case ComplexityType.quadratic:
        return n * n.toDouble();
      case ComplexityType.cubic:
        return n * n * n.toDouble();
      case ComplexityType.exponential:
        return math.pow(2, n).toDouble();
      case ComplexityType.factorial:
        return _factorial(n);
    }
  }
  
  /// 生成复杂度对比数据
  List<ComplexityDataPoint> generateComparisonData(
    List<String> algorithms,
    List<int> inputSizes,
    Map<String, List<double>> actualTimes,
  ) {
    final dataPoints = <ComplexityDataPoint>[];
    
    for (int i = 0; i < inputSizes.length; i++) {
      final size = inputSizes[i];
      
      for (final algorithm in algorithms) {
        final analysis = getAlgorithmComplexity(algorithm);
        final theoretical = calculateTheoreticalComplexity(
          analysis.averageTimeComplexity,
          size,
        );
        final actual = actualTimes[algorithm]?[i] ?? 0.0;
        
        dataPoints.add(ComplexityDataPoint(
          inputSize: size,
          actualTime: actual,
          theoreticalTime: theoretical,
          memoryUsage: _estimateMemoryUsage(algorithm, size),
        ));
      }
    }
    
    return dataPoints;
  }
  
  /// 复杂度增长率分析
  Map<String, double> analyzeGrowthRate(
    String algorithm,
    List<int> inputSizes,
    List<double> executionTimes,
  ) {
    if (inputSizes.length < 2 || executionTimes.length < 2) {
      return {'growthRate': 0.0, 'correlation': 0.0};
    }
    
    // 计算增长率
    final growthRates = <double>[];
    for (int i = 1; i < inputSizes.length; i++) {
      final sizeRatio = inputSizes[i] / inputSizes[i - 1];
      final timeRatio = executionTimes[i] / executionTimes[i - 1];
      growthRates.add(timeRatio / sizeRatio);
    }
    
    final avgGrowthRate = growthRates.reduce((a, b) => a + b) / growthRates.length;
    
    // 计算与理论复杂度的相关性
    final analysis = getAlgorithmComplexity(algorithm);
    final theoretical = inputSizes.map((n) => 
        calculateTheoreticalComplexity(analysis.averageTimeComplexity, n)
    ).toList();
    
    final correlation = _calculateCorrelation(executionTimes, theoretical);
    
    return {
      'growthRate': avgGrowthRate,
      'correlation': correlation,
      'predictedComplexity': _predictComplexityType(growthRates),
    };
  }
  
  /// 预测复杂度类型
  double _predictComplexityType(List<double> growthRates) {
    final avgGrowth = growthRates.reduce((a, b) => a + b) / growthRates.length;
    
    if (avgGrowth < 1.1) return 0; // O(1)
    if (avgGrowth < 1.5) return 1; // O(log n)
    if (avgGrowth < 2.5) return 2; // O(n)
    if (avgGrowth < 4.0) return 3; // O(n log n)
    if (avgGrowth < 8.0) return 4; // O(n²)
    return 5; // 更高复杂度
  }
  
  /// 计算相关系数
  double _calculateCorrelation(List<double> x, List<double> y) {
    if (x.length != y.length || x.isEmpty) return 0.0;
    
    final n = x.length;
    final sumX = x.reduce((a, b) => a + b);
    final sumY = y.reduce((a, b) => a + b);
    final sumXY = List.generate(n, (i) => x[i] * y[i]).reduce((a, b) => a + b);
    final sumX2 = x.map((v) => v * v).reduce((a, b) => a + b);
    final sumY2 = y.map((v) => v * v).reduce((a, b) => a + b);
    
    final numerator = n * sumXY - sumX * sumY;
    final denominator = math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    
    return denominator != 0 ? numerator / denominator : 0.0;
  }
  
  /// 估算内存使用
  double _estimateMemoryUsage(String algorithm, int size) {
    switch (algorithm.toLowerCase()) {
      case '归并排序':
      case 'mergesort':
        return size.toDouble(); // O(n)
      case '快速排序':
      case 'quicksort':
        return math.log(size) / math.ln2; // O(log n)
      case '堆排序':
      case 'heapsort':
        return 1.0; // O(1)
      default:
        return 1.0; // 默认常数空间
    }
  }
  
  /// 计算阶乘
  double _factorial(int n) {
    if (n <= 1) return 1.0;
    if (n > 10) return double.infinity; // 避免溢出
    
    double result = 1.0;
    for (int i = 2; i <= n; i++) {
      result *= i;
    }
    return result;
  }
  
  /// 生成复杂度建议
  String generateComplexityAdvice(String algorithm, int dataSize) {
    final analysis = getAlgorithmComplexity(algorithm);
    final worstCaseTime = calculateTheoreticalComplexity(
      analysis.worstTimeComplexity,
      dataSize,
    );
    
    if (worstCaseTime > 1000000) {
      return '⚠️ 警告：当前数据规模($dataSize)下，${algorithm}可能需要很长时间执行。'
          '建议考虑使用更高效的算法或减少数据规模。';
    } else if (worstCaseTime > 10000) {
      return '💡 提示：${algorithm}在当前数据规模下性能一般，可以考虑优化。';
    } else {
      return '✅ ${algorithm}在当前数据规模下性能良好。';
    }
  }
  
  /// 获取复杂度学习建议
  List<String> getComplexityLearningTips(ComplexityType type) {
    switch (type) {
      case ComplexityType.constant:
        return [
          '常数时间复杂度表示执行时间不随输入规模变化',
          '哈希表的理想查找操作是O(1)的例子',
          '数组的随机访问也是O(1)操作',
        ];
      case ComplexityType.logarithmic:
        return [
          '对数时间复杂度常见于分治算法',
          '二分查找是典型的O(log n)算法',
          '每次操作都能将问题规模减半',
        ];
      case ComplexityType.linear:
        return [
          '线性时间复杂度表示需要遍历所有元素',
          '简单的数组遍历是O(n)操作',
          '线性查找也是O(n)的例子',
        ];
      case ComplexityType.linearithmic:
        return [
          'O(n log n)是许多高效排序算法的复杂度',
          '归并排序和快速排序的平均情况',
          '这是基于比较的排序算法的理论下界',
        ];
      case ComplexityType.quadratic:
        return [
          '平方时间复杂度通常涉及嵌套循环',
          '冒泡排序、选择排序是O(n²)的例子',
          '当数据规模翻倍时，执行时间变为4倍',
        ];
      case ComplexityType.exponential:
        return [
          '指数时间复杂度增长非常快',
          '递归解决斐波那契数列是O(2^n)的例子',
          '通常需要使用动态规划等技术优化',
        ];
      default:
        return ['这是一个复杂的时间复杂度类型'];
    }
  }
}
