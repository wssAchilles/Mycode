// 算法性能对比组件
import 'package:flutter/material.dart';
import 'package:ml_platform/models/algorithm_model.dart';
import 'package:ml_platform/services/algorithm_service.dart';
import 'package:fl_chart/fl_chart.dart';

/// 算法对比结果
class ComparisonResult {
  final AlgorithmType algorithm;
  final int comparisons;
  final int swaps;
  final Duration executionTime;
  final List<SortingStep> steps;
  
  ComparisonResult({
    required this.algorithm,
    required this.comparisons,
    required this.swaps,
    required this.executionTime,
    required this.steps,
  });
}

/// 算法性能对比组件
class AlgorithmComparison extends StatefulWidget {
  const AlgorithmComparison({super.key});

  @override
  State<AlgorithmComparison> createState() => _AlgorithmComparisonState();
}

class _AlgorithmComparisonState extends State<AlgorithmComparison> {
  final AlgorithmService _algorithmService = AlgorithmService();
  List<AlgorithmType> selectedAlgorithms = [];
  List<int> testData = [];
  List<ComparisonResult> results = [];
  bool isRunning = false;
  int dataSize = 50;
  
  @override
  void initState() {
    super.initState();
    _generateTestData();
  }
  
  void _generateTestData() {
    testData = List.generate(dataSize, (index) => index + 1);
    testData.shuffle();
    setState(() {});
  }
  
  void _toggleAlgorithm(AlgorithmType algorithm) {
    setState(() {
      if (selectedAlgorithms.contains(algorithm)) {
        selectedAlgorithms.remove(algorithm);
      } else {
        selectedAlgorithms.add(algorithm);
      }
    });
  }
  
  Future<void> _runComparison() async {
    if (selectedAlgorithms.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请至少选择一个算法')),
      );
      return;
    }
    
    setState(() {
      isRunning = true;
      results.clear();
    });
    
    for (final algorithm in selectedAlgorithms) {
      final stopwatch = Stopwatch()..start();
      final steps = await _algorithmService.executeSort(algorithm, List.from(testData));
      stopwatch.stop();
      
      // 计算比较和交换次数
      int comparisons = 0;
      int swaps = 0;
      for (final step in steps) {
        if (step.comparing1 != null && step.comparing2 != null) {
          comparisons++;
        }
        if (step.swapping1 != null && step.swapping2 != null) {
          swaps++;
        }
      }
      
      results.add(ComparisonResult(
        algorithm: algorithm,
        comparisons: comparisons,
        swaps: swaps,
        executionTime: stopwatch.elapsed,
        steps: steps,
      ));
    }
    
    setState(() {
      isRunning = false;
    });
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Container(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 标题
          Text(
            '算法性能对比',
            style: theme.textTheme.headlineSmall,
          ),
          const SizedBox(height: 16),
          
          // 算法选择
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '选择算法',
                    style: theme.textTheme.titleMedium,
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: AlgorithmType.values.map((algorithm) {
                      final isSelected = selectedAlgorithms.contains(algorithm);
                      return FilterChip(
                        label: Text(algorithm.displayName),
                        selected: isSelected,
                        onSelected: (_) => _toggleAlgorithm(algorithm),
                      );
                    }).toList(),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          
          // 数据配置
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '数据配置',
                    style: theme.textTheme.titleMedium,
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Text('数据规模: $dataSize'),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Slider(
                          value: dataSize.toDouble(),
                          min: 10,
                          max: 200,
                          divisions: 19,
                          label: dataSize.toString(),
                          onChanged: (value) {
                            setState(() {
                              dataSize = value.toInt();
                              _generateTestData();
                            });
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      ElevatedButton.icon(
                        onPressed: _generateTestData,
                        icon: const Icon(Icons.refresh),
                        label: const Text('重新生成数据'),
                      ),
                      const SizedBox(width: 16),
                      ElevatedButton.icon(
                        onPressed: isRunning ? null : _runComparison,
                        icon: isRunning 
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.play_arrow),
                        label: Text(isRunning ? '运行中...' : '开始对比'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          
          // 结果展示
          if (results.isNotEmpty) ...[
            Text(
              '对比结果',
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            Expanded(
              child: Row(
                children: [
                  // 表格结果
                  Expanded(
                    flex: 1,
                    child: Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: _buildResultTable(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                  // 图表结果
                  Expanded(
                    flex: 1,
                    child: Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: _buildResultChart(),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
  
  Widget _buildResultTable() {
    return SingleChildScrollView(
      scrollDirection: Axis.vertical,
      child: DataTable(
        columns: const [
          DataColumn(label: Text('算法')),
          DataColumn(label: Text('比较次数'), numeric: true),
          DataColumn(label: Text('交换次数'), numeric: true),
          DataColumn(label: Text('执行时间'), numeric: true),
          DataColumn(label: Text('时间复杂度')),
        ],
        rows: results.map((result) {
          return DataRow(cells: [
            DataCell(Text(result.algorithm.displayName)),
            DataCell(Text(result.comparisons.toString())),
            DataCell(Text(result.swaps.toString())),
            DataCell(Text('${result.executionTime.inMicroseconds} μs')),
            DataCell(Text(_algorithmService.getTimeComplexity(result.algorithm))),
          ]);
        }).toList(),
      ),
    );
  }
  
  Widget _buildResultChart() {
    if (results.isEmpty) return const Center(child: Text('暂无数据'));
    
    // 准备图表数据
    final comparisonsData = results.asMap().entries.map((entry) {
      return BarChartGroupData(
        x: entry.key,
        barRods: [
          BarChartRodData(
            toY: entry.value.comparisons.toDouble(),
            color: Colors.blue,
            width: 20,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
          ),
        ],
        showingTooltipIndicators: [0],
      );
    }).toList();
    
    final swapsData = results.asMap().entries.map((entry) {
      return BarChartGroupData(
        x: entry.key,
        barRods: [
          BarChartRodData(
            toY: entry.value.swaps.toDouble(),
            color: Colors.orange,
            width: 20,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
          ),
        ],
      );
    }).toList();
    
    return Column(
      children: [
        const Text('性能对比图表', style: TextStyle(fontWeight: FontWeight.bold)),
        const SizedBox(height: 16),
        Expanded(
          child: BarChart(
            BarChartData(
              alignment: BarChartAlignment.spaceEvenly,
              maxY: results.map((r) => r.comparisons.toDouble()).reduce((a, b) => a > b ? a : b) * 1.2,
              barTouchData: BarTouchData(
                enabled: true,
                touchTooltipData: BarTouchTooltipData(
                  getTooltipItem: (group, groupIndex, rod, rodIndex) {
                    return BarTooltipItem(
                      '${results[groupIndex].algorithm.displayName}\n${rod.toY.toInt()}',
                      const TextStyle(color: Colors.white, fontSize: 12),
                    );
                  },
                ),
              ),
              titlesData: FlTitlesData(
                show: true,
                bottomTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    getTitlesWidget: (value, meta) {
                      if (value.toInt() >= results.length) return const Text('');
                      return Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          results[value.toInt()].algorithm.displayName.substring(0, 2),
                          style: const TextStyle(fontSize: 10),
                        ),
                      );
                    },
                  ),
                ),
                leftTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 40,
                    getTitlesWidget: (value, meta) {
                      return Text(
                        value.toInt().toString(),
                        style: const TextStyle(fontSize: 10),
                      );
                    },
                  ),
                ),
                rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              ),
              borderData: FlBorderData(show: false),
              barGroups: comparisonsData,
            ),
          ),
        ),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _buildLegendItem(Colors.blue, '比较次数'),
            const SizedBox(width: 24),
            _buildLegendItem(Colors.orange, '交换次数'),
          ],
        ),
      ],
    );
  }
  
  Widget _buildLegendItem(Color color, String label) {
    return Row(
      children: [
        Container(
          width: 16,
          height: 16,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 8),
        Text(label, style: const TextStyle(fontSize: 12)),
      ],
    );
  }
}
