// 算法复杂度可视化组件
import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:ml_platform/models/complexity_model.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'dart:math' as math;

/// 复杂度对比图表
class ComplexityComparisonChart extends StatelessWidget {
  final List<ComplexityType> complexityTypes;
  final int maxInputSize;
  
  const ComplexityComparisonChart({
    Key? key,
    required this.complexityTypes,
    this.maxInputSize = 100,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '时间复杂度增长曲线对比',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            SizedBox(
              height: 300,
              child: LineChart(
                LineChartData(
                  gridData: FlGridData(show: true),
                  titlesData: FlTitlesData(
                    leftTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        getTitlesWidget: (value, meta) {
                          return Text(
                            value.toInt().toString(),
                            style: const TextStyle(fontSize: 10),
                          );
                        },
                      ),
                    ),
                    bottomTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        getTitlesWidget: (value, meta) {
                          return Text(
                            'n=${value.toInt()}',
                            style: const TextStyle(fontSize: 10),
                          );
                        },
                      ),
                    ),
                    rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                    topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  ),
                  borderData: FlBorderData(show: true),
                  lineBarsData: _generateComplexityLines(),
                  minX: 1,
                  maxX: maxInputSize.toDouble(),
                  minY: 0,
                  maxY: _calculateMaxY(),
                ),
              ),
            ),
            const SizedBox(height: 16),
            _buildLegend(),
          ],
        ),
      ),
    );
  }
  
  List<LineChartBarData> _generateComplexityLines() {
    final service = ComplexityAnalysisService();
    final lines = <LineChartBarData>[];
    
    for (int i = 0; i < complexityTypes.length; i++) {
      final type = complexityTypes[i];
      final spots = <FlSpot>[];
      
      for (int n = 1; n <= maxInputSize; n += math.max(1, maxInputSize ~/ 50)) {
        final value = service.calculateTheoreticalComplexity(type, n);
        if (value.isFinite && value <= _calculateMaxY()) {
          spots.add(FlSpot(n.toDouble(), value));
        }
      }
      
      if (spots.isNotEmpty) {
        lines.add(
          LineChartBarData(
            spots: spots,
            isCurved: true,
            color: type.color,
            barWidth: 2,
            dotData: const FlDotData(show: false),
          ),
        );
      }
    }
    
    return lines;
  }
  
  double _calculateMaxY() {
    final service = ComplexityAnalysisService();
    double maxY = 0;
    
    for (final type in complexityTypes) {
      final value = service.calculateTheoreticalComplexity(type, maxInputSize);
      if (value.isFinite) {
        maxY = math.max(maxY, value);
      }
    }
    
    return math.max(maxY, 100); // 至少100的范围
  }
  
  Widget _buildLegend() {
    return Wrap(
      spacing: 16,
      runSpacing: 8,
      children: complexityTypes.map((type) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 20,
              height: 3,
              color: type.color,
            ),
            const SizedBox(width: 8),
            Text(
              type.notation,
              style: const TextStyle(fontSize: 12),
            ),
          ],
        );
      }).toList(),
    );
  }
}

/// 算法复杂度详情卡片
class ComplexityDetailCard extends StatelessWidget {
  final ComplexityAnalysis analysis;
  final bool showFactors;
  
  const ComplexityDetailCard({
    Key? key,
    required this.analysis,
    this.showFactors = true,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 算法名称
            Text(
              analysis.algorithmName,
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            
            // 复杂度表格
            _buildComplexityTable(),
            const SizedBox(height: 16),
            
            // 影响因素
            if (showFactors && analysis.factors.isNotEmpty) ...[
              Text(
                '影响因素',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              ...analysis.factors.map((factor) => _buildFactorItem(factor)),
              const SizedBox(height: 16),
            ],
            
            // 详细说明
            if (analysis.explanation.isNotEmpty) ...[
              Text(
                '详细分析',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceHighlight,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  analysis.explanation,
                  style: const TextStyle(fontSize: 14, height: 1.5),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
  
  Widget _buildComplexityTable() {
    return Table(
      border: TableBorder.all(color: AppTheme.borderSubtle),
      columnWidths: const {
        0: FlexColumnWidth(2),
        1: FlexColumnWidth(3),
      },
      children: [
        _buildTableRow('时间复杂度', '', isHeader: true),
        _buildTableRow('  最佳情况', analysis.bestTimeComplexity.notation, 
            color: analysis.bestTimeComplexity.color),
        _buildTableRow('  平均情况', analysis.averageTimeComplexity.notation,
            color: analysis.averageTimeComplexity.color),
        _buildTableRow('  最坏情况', analysis.worstTimeComplexity.notation,
            color: analysis.worstTimeComplexity.color),
        _buildTableRow('空间复杂度', analysis.spaceComplexity.notation,
            color: analysis.spaceComplexity.color),
      ],
    );
  }
  
  TableRow _buildTableRow(String label, String value, {bool isHeader = false, Color? color}) {
    return TableRow(
      decoration: isHeader ? const BoxDecoration(color: AppTheme.surfaceHighlight) : null,
      children: [
        Padding(
          padding: const EdgeInsets.all(8),
          child: Text(
            label,
            style: TextStyle(
              fontWeight: isHeader ? FontWeight.bold : FontWeight.normal,
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(8),
          child: isHeader 
              ? Text(
                  value,
                  style: const TextStyle(fontWeight: FontWeight.bold),
                )
              : Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: color?.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    value,
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: color?.darken(0.6),
                    ),
                  ),
                ),
        ),
      ],
    );
  }
  
  Widget _buildFactorItem(ComplexityFactor factor) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 8,
            height: 8,
            margin: const EdgeInsets.only(top: 6, right: 8),
            decoration: BoxDecoration(
              color: factor.impact.color,
              shape: BoxShape.circle,
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  factor.name,
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                Text(
                  factor.description,
                  style: TextStyle(
                    fontSize: 13,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          Chip(
            label: Text(
              factor.impact.label,
              style: const TextStyle(fontSize: 11),
            ),
            backgroundColor: factor.impact.color.withOpacity(0.2),
          ),
        ],
      ),
    );
  }
}

/// 复杂度学习提示卡片
class ComplexityLearningTips extends StatelessWidget {
  final ComplexityType complexityType;
  
  const ComplexityLearningTips({
    Key? key,
    required this.complexityType,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    final service = ComplexityAnalysisService();
    final tips = service.getComplexityLearningTips(complexityType);
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.lightbulb_outline,
                  color: complexityType.color,
                ),
                const SizedBox(width: 8),
                Text(
                  '${complexityType.notation} 学习要点',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            ...tips.map((tip) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 6,
                    height: 6,
                    margin: const EdgeInsets.only(top: 8, right: 12),
                    decoration: BoxDecoration(
                      color: complexityType.color,
                      shape: BoxShape.circle,
                    ),
                  ),
                  Expanded(
                    child: Text(
                      tip,
                      style: const TextStyle(height: 1.5),
                    ),
                  ),
                ],
              ),
            )),
          ],
        ),
      ),
    );
  }
}

/// 性能基准测试图表
class PerformanceBenchmarkChart extends StatelessWidget {
  final Map<String, List<double>> benchmarkData;
  final List<int> inputSizes;
  
  const PerformanceBenchmarkChart({
    Key? key,
    required this.benchmarkData,
    required this.inputSizes,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '实际性能测试结果',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            SizedBox(
              height: 300,
              child: LineChart(
                LineChartData(
                  gridData: FlGridData(show: true),
                  titlesData: FlTitlesData(
                    leftTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        getTitlesWidget: (value, meta) {
                          return Text(
                            '${value.toInt()}ms',
                            style: const TextStyle(fontSize: 10),
                          );
                        },
                      ),
                    ),
                    bottomTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
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
                  borderData: FlBorderData(show: true),
                  lineBarsData: _generateBenchmarkLines(),
                ),
              ),
            ),
            const SizedBox(height: 16),
            _buildBenchmarkLegend(),
          ],
        ),
      ),
    );
  }
  
  List<LineChartBarData> _generateBenchmarkLines() {
    final lines = <LineChartBarData>[];
    final colors = [
      AppTheme.primary,
      AppTheme.error,
      AppTheme.success,
      AppTheme.warning,
      AppTheme.secondary,
    ];
    int colorIndex = 0;
    
    for (final entry in benchmarkData.entries) {
      final algorithmName = entry.key;
      final times = entry.value;
      final spots = <FlSpot>[];
      
      for (int i = 0; i < math.min(inputSizes.length, times.length); i++) {
        spots.add(FlSpot(inputSizes[i].toDouble(), times[i]));
      }
      
      if (spots.isNotEmpty) {
        lines.add(
          LineChartBarData(
            spots: spots,
            isCurved: true,
            color: colors[colorIndex % colors.length],
            barWidth: 2,
            dotData: const FlDotData(show: true),
          ),
        );
        colorIndex++;
      }
    }
    
    return lines;
  }
  
  Widget _buildBenchmarkLegend() {
    final colors = [
      AppTheme.primary,
      AppTheme.error,
      AppTheme.success,
      AppTheme.warning,
      AppTheme.secondary,
    ];
    int colorIndex = 0;
    
    return Wrap(
      spacing: 16,
      runSpacing: 8,
      children: benchmarkData.keys.map((algorithm) {
        final color = colors[colorIndex % colors.length];
        colorIndex++;
        
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 20,
              height: 3,
              color: color,
            ),
            const SizedBox(width: 8),
            Text(
              algorithm,
              style: const TextStyle(fontSize: 12),
            ),
          ],
        );
      }).toList(),
    );
  }
}

/// 复杂度建议卡片
class ComplexityAdviceCard extends StatelessWidget {
  final String algorithm;
  final int dataSize;
  final ComplexityAnalysisService service = ComplexityAnalysisService();
  
  ComplexityAdviceCard({
    Key? key,
    required this.algorithm,
    required this.dataSize,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    final advice = service.generateComplexityAdvice(algorithm, dataSize);
    final IconData icon;
    final Color color;
    
    if (advice.contains('⚠️')) {
      icon = Icons.warning;
      color = AppTheme.error;
    } else if (advice.contains('💡')) {
      icon = Icons.lightbulb_outline;
      color = AppTheme.warning;
    } else {
      icon = Icons.check_circle;
      color = AppTheme.success;
    }
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(icon, color: color, size: 24),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                advice,
                style: TextStyle(color: color.darken(0.3)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// 颜色扩展方法
extension ColorExtension on Color {
  Color darken(double amount) {
    final hsl = HSLColor.fromColor(this);
    return hsl.withLightness((hsl.lightness - amount).clamp(0.0, 1.0)).toColor();
  }
}
