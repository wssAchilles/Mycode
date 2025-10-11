import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'dart:math' as math;
import '../models/ml_result.dart';
import '../models/experiment_config.dart';

/// 结果可视化页面
class ResultsScreen extends StatefulWidget {
  final MLResult result;
  final ExperimentConfig config;

  const ResultsScreen({
    Key? key,
    required this.result,
    required this.config,
  }) : super(key: key);

  @override
  State<ResultsScreen> createState() => _ResultsScreenState();
}

class _ResultsScreenState extends State<ResultsScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    final tabCount = _getTabCount();
    _tabController = TabController(length: tabCount, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  int _getTabCount() {
    switch (widget.config.taskType) {
      case 'classification':
        return 3;
      case 'regression':
        return 3;
      case 'clustering':
        return 2;
      default:
        return 2;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('训练结果'),
        elevation: 0,
        bottom: TabBar(
          controller: _tabController,
          tabs: _buildTabs(),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.save_alt),
            onPressed: _exportResults,
            tooltip: '导出结果',
          ),
        ],
      ),
      body: TabBarView(
        controller: _tabController,
        children: _buildTabViews(),
      ),
    );
  }

  List<Tab> _buildTabs() {
    final tabs = <Tab>[];
    
    switch (widget.config.taskType) {
      case 'classification':
        tabs.addAll([
          const Tab(text: '性能指标', icon: Icon(Icons.analytics)),
          const Tab(text: '混淆矩阵', icon: Icon(Icons.grid_on)),
          const Tab(text: '特征重要性', icon: Icon(Icons.bar_chart)),
        ]);
        break;
      case 'regression':
        tabs.addAll([
          const Tab(text: '性能指标', icon: Icon(Icons.analytics)),
          const Tab(text: '预测对比', icon: Icon(Icons.scatter_plot)),
          const Tab(text: '残差分析', icon: Icon(Icons.show_chart)),
        ]);
        break;
      case 'clustering':
        tabs.addAll([
          const Tab(text: '聚类指标', icon: Icon(Icons.analytics)),
          const Tab(text: '聚类可视化', icon: Icon(Icons.bubble_chart)),
        ]);
        break;
    }
    
    return tabs;
  }

  List<Widget> _buildTabViews() {
    final views = <Widget>[];
    
    switch (widget.config.taskType) {
      case 'classification':
        views.addAll([
          _buildClassificationMetrics(),
          _buildConfusionMatrix(),
          _buildFeatureImportance(),
        ]);
        break;
      case 'regression':
        views.addAll([
          _buildRegressionMetrics(),
          _buildPredictionScatter(),
          _buildResidualPlot(),
        ]);
        break;
      case 'clustering':
        views.addAll([
          _buildClusteringMetrics(),
          _buildClusteringVisualization(),
        ]);
        break;
    }
    
    return views;
  }

  Widget _buildClassificationMetrics() {
    final metrics = widget.result.metrics;
    
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          _buildModelInfoCard(),
          const SizedBox(height: 16),
          _buildMetricCards([
            MetricCard(
              title: '准确率',
              value: (metrics['accuracy'] * 100).toStringAsFixed(2) + '%',
              icon: Icons.check_circle,
              color: Colors.green,
            ),
            MetricCard(
              title: '精确率',
              value: (metrics['precision'] * 100).toStringAsFixed(2) + '%',
              icon: Icons.track_changes,
              color: Colors.blue,
            ),
            MetricCard(
              title: '召回率',
              value: (metrics['recall'] * 100).toStringAsFixed(2) + '%',
              icon: Icons.radar,
              color: Colors.orange,
            ),
            MetricCard(
              title: 'F1分数',
              value: (metrics['f1_score'] * 100).toStringAsFixed(2) + '%',
              icon: Icons.score,
              color: Colors.purple,
            ),
          ]),
        ],
      ),
    );
  }

  Widget _buildConfusionMatrix() {
    final confusionMatrix = widget.result.metrics['confusion_matrix'] as List?;
    if (confusionMatrix == null || confusionMatrix.isEmpty) {
      return const Center(child: Text('无混淆矩阵数据'));
    }
    
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          Text(
            '混淆矩阵',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              boxShadow: [
                BoxShadow(
                  color: Colors.grey.withOpacity(0.1),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: AspectRatio(
              aspectRatio: 1,
              child: _buildConfusionMatrixGrid(confusionMatrix),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildConfusionMatrixGrid(List confusionMatrix) {
    final size = confusionMatrix.length;
    final maxValue = confusionMatrix
        .expand((row) => (row as List).cast<num>())
        .reduce(math.max)
        .toDouble();
    
    return LayoutBuilder(
      builder: (context, constraints) {
        final cellSize = constraints.maxWidth / (size + 1);
        
        return Stack(
          children: [
            for (int i = 0; i < size; i++)
              for (int j = 0; j < size; j++)
                Positioned(
                  left: (j + 1) * cellSize,
                  top: (i + 1) * cellSize,
                  width: cellSize,
                  height: cellSize,
                  child: _buildMatrixCell(
                    confusionMatrix[i][j],
                    maxValue,
                    i == j,
                  ),
                ),
          ],
        );
      },
    );
  }

  Widget _buildMatrixCell(int value, double maxValue, bool isDiagonal) {
    final intensity = value / maxValue;
    final color = isDiagonal
        ? Color.lerp(Colors.green[100]!, Colors.green[800]!, intensity)!
        : Color.lerp(Colors.red[100]!, Colors.red[800]!, intensity)!;
    
    return Container(
      margin: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Center(
        child: Text(
          value.toString(),
          style: TextStyle(
            color: intensity > 0.5 ? Colors.white : Colors.black,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }

  Widget _buildFeatureImportance() {
    final importance = widget.result.visualizationData['feature_importance'] as List?;
    if (importance == null || importance.isEmpty) {
      return const Center(child: Text('无特征重要性数据'));
    }
    
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          Text(
            '特征重要性',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 16),
          Container(
            height: 400,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
            ),
            child: _buildFeatureImportanceChart(importance),
          ),
        ],
      ),
    );
  }

  Widget _buildFeatureImportanceChart(List importance) {
    final features = widget.config.featureColumns;
    final data = <BarChartGroupData>[];
    
    for (int i = 0; i < math.min(importance.length, features.length); i++) {
      data.add(
        BarChartGroupData(
          x: i,
          barRods: [
            BarChartRodData(
              toY: (importance[i] as num).toDouble(),
              gradient: LinearGradient(
                colors: [Colors.blue.shade400, Colors.blue.shade700],
                begin: Alignment.bottomCenter,
                end: Alignment.topCenter,
              ),
              width: 20,
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(6),
                topRight: Radius.circular(6),
              ),
            ),
          ],
        ),
      );
    }
    
    return BarChart(
      BarChartData(
        barGroups: data,
        titlesData: FlTitlesData(
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              getTitlesWidget: (value, meta) {
                final index = value.toInt();
                if (index >= 0 && index < features.length) {
                  return Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: RotatedBox(
                      quarterTurns: 1,
                      child: Text(
                        features[index],
                        style: const TextStyle(fontSize: 10),
                      ),
                    ),
                  );
                }
                return const SizedBox();
              },
              reservedSize: 60,
            ),
          ),
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 40,
            ),
          ),
          topTitles: const AxisTitles(
            sideTitles: SideTitles(showTitles: false),
          ),
          rightTitles: const AxisTitles(
            sideTitles: SideTitles(showTitles: false),
          ),
        ),
        gridData: const FlGridData(show: true),
        borderData: FlBorderData(show: false),
      ),
    );
  }

  Widget _buildRegressionMetrics() {
    final metrics = widget.result.metrics;
    
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          _buildModelInfoCard(),
          const SizedBox(height: 16),
          _buildMetricCards([
            MetricCard(
              title: 'R² 分数',
              value: metrics['r2_score'].toStringAsFixed(4),
              icon: Icons.functions,
              color: Colors.blue,
            ),
            MetricCard(
              title: '均方误差',
              value: metrics['mse'].toStringAsFixed(4),
              icon: Icons.square_foot,
              color: Colors.orange,
            ),
            MetricCard(
              title: '均方根误差',
              value: metrics['rmse'].toStringAsFixed(4),
              icon: Icons.square_foot,
              color: Colors.red,
            ),
            MetricCard(
              title: '平均绝对误差',
              value: metrics['mae'].toStringAsFixed(4),
              icon: Icons.straighten,
              color: Colors.purple,
            ),
          ]),
        ],
      ),
    );
  }

  Widget _buildPredictionScatter() {
    // 简化的散点图实现
    return const Center(
      child: Text('预测值散点图'),
    );
  }

  Widget _buildResidualPlot() {
    // 简化的残差图实现
    return const Center(
      child: Text('残差分析图'),
    );
  }

  Widget _buildClusteringMetrics() {
    final metrics = widget.result.metrics;
    
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          _buildModelInfoCard(),
          const SizedBox(height: 16),
          _buildMetricCards([
            if (metrics['silhouette_score'] != null)
              MetricCard(
                title: '轮廓系数',
                value: metrics['silhouette_score'].toStringAsFixed(4),
                icon: Icons.blur_on,
                color: Colors.blue,
              ),
            if (metrics['davies_bouldin_score'] != null)
              MetricCard(
                title: 'Davies-Bouldin指数',
                value: metrics['davies_bouldin_score'].toStringAsFixed(4),
                icon: Icons.scatter_plot,
                color: Colors.orange,
              ),
            MetricCard(
              title: '聚类数量',
              value: metrics['n_clusters'].toString(),
              icon: Icons.bubble_chart,
              color: Colors.purple,
            ),
          ]),
        ],
      ),
    );
  }

  Widget _buildClusteringVisualization() {
    // 简化的聚类可视化实现
    return const Center(
      child: Text('聚类可视化'),
    );
  }

  Widget _buildModelInfoCard() {
    final modelInfo = widget.result.modelInfo;
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.model_training, color: Theme.of(context).primaryColor),
                const SizedBox(width: 8),
                Text(
                  '模型信息',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
            const SizedBox(height: 16),
            _buildInfoRow('模型名称', modelInfo.modelName),
            _buildInfoRow('任务类型', modelInfo.taskType),
            _buildInfoRow('特征数量', modelInfo.nFeatures.toString()),
            _buildInfoRow('样本数量', modelInfo.nSamples.toString()),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.grey)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildMetricCards(List<MetricCard> cards) {
    return Wrap(
      spacing: 16,
      runSpacing: 16,
      children: cards.map((card) => _buildMetricCard(card)).toList(),
    );
  }

  Widget _buildMetricCard(MetricCard card) {
    return SizedBox(
      width: (MediaQuery.of(context).size.width - 48) / 2,
      child: Card(
        elevation: 2,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(card.icon, color: card.color, size: 32),
              const SizedBox(height: 8),
              Text(
                card.value,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 4),
              Text(
                card.title,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _exportResults() {
    // TODO: 实现导出功能
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('导出功能开发中...')),
    );
  }

  List<Color> _generateColors(int count) {
    final colors = <Color>[];
    for (int i = 0; i < count; i++) {
      colors.add(HSVColor.fromAHSV(
        1.0,
        (360.0 * i / count) % 360,
        0.7,
        0.8,
      ).toColor());
    }
    return colors;
  }
}

class MetricCard {
  final String title;
  final String value;
  final IconData icon;
  final Color color;

  const MetricCard({
    required this.title,
    required this.value,
    required this.icon,
    required this.color,
  });
}

class GridPainter extends CustomPainter {
  final int size;

  GridPainter({required this.size});

  @override
  void paint(Canvas canvas, Size canvasSize) {
    final paint = Paint()
      ..color = Colors.grey.shade300
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;

    final cellSize = canvasSize.width / size;

    for (int i = 0; i <= size; i++) {
      canvas.drawLine(
        Offset(i * cellSize, 0),
        Offset(i * cellSize, canvasSize.height),
        paint,
      );
      canvas.drawLine(
        Offset(0, i * cellSize),
        Offset(canvasSize.width, i * cellSize),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
