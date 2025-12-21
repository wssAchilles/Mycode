import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'dart:math' as math;
import '../models/ml_result.dart';
import '../models/experiment_config.dart';

/// 实验详情页面 (包含高级可视化)
class ExperimentDetailScreen extends StatefulWidget {
  final MLResult result;
  final ExperimentConfig config;
  final String? experimentId;

  const ExperimentDetailScreen({
    Key? key,
    required this.result,
    required this.config,
    this.experimentId,
  }) : super(key: key);

  @override
  State<ExperimentDetailScreen> createState() => _ExperimentDetailScreenState();
}

class _ExperimentDetailScreenState extends State<ExperimentDetailScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  late List<Tab> _tabs;

  @override
  void initState() {
    super.initState();
    _tabs = _buildTabs();
    _tabController = TabController(length: _tabs.length, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('${_getTaskTypeName()} 实验报告'),
        elevation: 0,
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          tabs: _tabs,
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.share),
            onPressed: () {},
            tooltip: '分享',
          ),
        ],
      ),
      body: TabBarView(
        controller: _tabController,
        children: _buildTabViews(),
      ),
    );
  }

  String _getTaskTypeName() {
    switch (widget.config.taskType) {
      case 'classification': return '分类';
      case 'regression': return '回归';
      case 'clustering': return '聚类';
      default: return '机器学习';
    }
  }

  List<Tab> _buildTabs() {
    final tabs = <Tab>[
      const Tab(text: '概览', icon: Icon(Icons.dashboard)),
    ];
    
    // 如果有模型选择报告，添加“模型竞技场”
    if (widget.result.metrics.containsKey('model_selection_report')) {
      tabs.add(const Tab(text: '⚡️ 模型竞技场', icon: Icon(Icons.compare_arrows)));
    }

    switch (widget.config.taskType) {
      case 'classification':
        tabs.addAll([
          const Tab(text: '混淆矩阵', icon: Icon(Icons.grid_on)),
          if (_hasRocData()) const Tab(text: 'ROC曲线', icon: Icon(Icons.show_chart)),
          const Tab(text: '特征重要性', icon: Icon(Icons.bar_chart)),
        ]);
        break;
      case 'regression':
        tabs.addAll([
          const Tab(text: '预测对比', icon: Icon(Icons.scatter_plot)),
          const Tab(text: '残差分布', icon: Icon(Icons.analytics)),
          const Tab(text: '特征重要性', icon: Icon(Icons.bar_chart)),
        ]);
        break;
      case 'clustering':
        tabs.addAll([
          const Tab(text: '数据分布', icon: Icon(Icons.bubble_chart)),
        ]);
        break;
    }
    
    return tabs;
  }
  
  bool _hasRocData() {
    return widget.result.visualizationData.containsKey('roc_curve') &&
           widget.result.visualizationData['roc_curve'] != null;
  }

  List<Widget> _buildTabViews() {
    final views = <Widget>[
      _buildOverviewTab(),
    ];
    
    if (widget.result.metrics.containsKey('model_selection_report')) {
      views.add(_buildModelArenaTab());
    }

    switch (widget.config.taskType) {
      case 'classification':
        views.addAll([
          _buildConfusionMatrix(),
          if (_hasRocData()) _buildRocCurve(),
          _buildFeatureImportance(),
        ]);
        break;
      case 'regression':
        views.addAll([
          _buildPredictionScatter(),
          _buildResidualPlot(),
          _buildFeatureImportance(),
        ]);
        break;
      case 'clustering':
        views.addAll([
          _buildClusteringVisualization(),
        ]);
        break;
    }
    
    return views;
  }

  // --- 1. 概览 Tab ---
  Widget _buildOverviewTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          _buildModelInfoCard(),
          const SizedBox(height: 16),
          _buildMetricsSection(),
        ],
      ),
    );
  }
  
  Widget _buildModelInfoCard() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            ListTile(
              leading: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Theme.of(context).primaryColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(Icons.model_training, color: Theme.of(context).primaryColor),
              ),
              title: Text(widget.result.modelInfo.modelName, style: const TextStyle(fontWeight: FontWeight.bold)),
              subtitle: Text('任务: ${widget.config.taskType} | 样本: ${widget.result.modelInfo.nSamples}'),
            ),
            const Divider(),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _buildStatItem('特征数', '${widget.result.modelInfo.nFeatures}'),
                  _buildStatItem('训练时间', '2.5s'), // TODO: 从后端获取实际时间
                  _buildStatItem('部署状态', 'Ready', color: Colors.green),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildStatItem(String label, String value, {Color? color}) {
    return Column(
      children: [
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
        const SizedBox(height: 4),
        Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: color)),
      ],
    );
  }

  Widget _buildMetricsSection() {
    final metrics = widget.result.metrics;
    List<MetricItem> items = [];

    if (widget.config.taskType == 'classification') {
      items = [
        MetricItem('准确率 (Accuracy)', metrics['accuracy'], Icons.check_circle, Colors.green),
        MetricItem('精确率 (Precision)', metrics['precision'], Icons.gps_fixed, Colors.blue),
        MetricItem('召回率 (Recall)', metrics['recall'], Icons.radar, Colors.orange),
        MetricItem('F1 分数', metrics['f1_score'], Icons.grade, Colors.purple),
      ];
    } else if (widget.config.taskType == 'regression') {
      items = [
        MetricItem('R² 分数', metrics['r2_score'], Icons.functions, Colors.blue),
        MetricItem('均方误差 (MSE)', metrics['mse'], Icons.error_outline, Colors.red),
        MetricItem('RMSE', metrics['rmse'], Icons.show_chart, Colors.orange),
        MetricItem('MAE', metrics['mae'], Icons.linear_scale, Colors.teal),
      ];
    } else {
      if (metrics['silhouette_score'] != null) {
        items.add(MetricItem('轮廓系数', metrics['silhouette_score'], Icons.bubble_chart, Colors.purple));
      }
      items.add(MetricItem('聚类数', (metrics['n_clusters'] as int).toDouble(), Icons.category, Colors.blue));
    }

    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      childAspectRatio: 1.5,
      crossAxisSpacing: 12,
      mainAxisSpacing: 12,
      children: items.map((item) => _buildMetricCard(item)).toList(),
    );
  }

  Widget _buildMetricCard(MetricItem item) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(item.icon, size: 20, color: item.color),
                const SizedBox(width: 8),
                Text(item.label, style: const TextStyle(fontSize: 12, color: Colors.grey)),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              item.value.toStringAsFixed(4),
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: item.color),
            ),
          ],
        ),
      ),
    );
  }

  // --- 2. 模型竞技场 Tab ---
  Widget _buildModelArenaTab() {
    final report = widget.result.metrics['model_selection_report'] as Map<String, dynamic>;
    if (report.isEmpty) return const Center(child: Text('无竞技场数据'));

    // 将 report 转换为 List 并排序
    final List<MapEntry<String, dynamic>> sortedModels = report.entries.toList()
      ..sort((a, b) => (b.value['mean_test_score'] as num).compareTo(a.value['mean_test_score'] as num));

    // 提取数据用于图表
    final bestModelName = sortedModels.first.key;
    final maxScore = sortedModels.first.value['mean_test_score'] as num;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildBestModelBanner(bestModelName, maxScore),
        const SizedBox(height: 24),
        const Text('候选模型得分对比 (Cross-Validation Score)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 16),
        SizedBox(
          height: 300,
          child: BarChart(
            BarChartData(
              alignment: BarChartAlignment.spaceAround,
              maxY: 1.0, 
              barTouchData: BarTouchData(
                touchTooltipData: BarTouchTooltipData(
                  tooltipBgColor: Colors.blueGrey,
                  getTooltipItem: (group, groupIndex, rod, rodIndex) {
                    return BarTooltipItem(
                      '${sortedModels[group.x.toInt()].key}\n',
                      const TextStyle(color: Colors.white, fontWeight: FontWeight.bold,),
                      children: [
                        TextSpan(
                          text: rod.toY.toStringAsFixed(4),
                          style: const TextStyle(color: Colors.yellow, fontSize: 14),
                        ),
                      ],
                    );
                  },
                ),
              ),
              titlesData: FlTitlesData(
                show: true,
                bottomTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    getTitlesWidget: (val, meta) {
                      final index = val.toInt();
                      if (index >= 0 && index < sortedModels.length) {
                        // 简写模型名称
                        String name = sortedModels[index].key;
                        name = name.replaceAll('Classifier', '').replaceAll('Regressor', '');
                        return Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(name, style: const TextStyle(fontSize: 10)),
                        );
                      }
                      return const SizedBox.shrink();
                    },
                    reservedSize: 30,
                  ),
                ),
                leftTitles: AxisTitles(
                  sideTitles: SideTitles(showTitles: true, reservedSize: 40),
                ),
                topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              ),
              gridData: const FlGridData(show: true, drawVerticalLine: false),
              borderData: FlBorderData(show: false),
              barGroups: sortedModels.asMap().entries.map((entry) {
                final index = entry.key;
                final data = entry.value.value;
                final score = (data['mean_test_score'] as num).toDouble();
                final isBest = entry.value.key == bestModelName;
                
                return BarChartGroupData(
                  x: index,
                  barRods: [
                    BarChartRodData(
                      toY: score < 0 ? 0 : score, // 防止负分
                      color: isBest ? Colors.green : Colors.blue.shade300,
                      width: 20,
                      borderRadius: const BorderRadius.vertical(top: Radius.circular(6)),
                    ),
                  ],
                );
              }).toList(),
            ),
          ),
        ),
      ],
    );
  }
  
  Widget _buildBestModelBanner(String name, num score) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: [Colors.green.shade400, Colors.green.shade700]),
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(color: Colors.green.withOpacity(0.3), blurRadius: 10, offset: const Offset(0, 4)),
        ],
      ),
      child: Row(
        children: [
          const Icon(Icons.emoji_events, color: Colors.yellow, size: 40),
          const SizedBox(width: 16),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('最佳模型 (Winner)', style: TextStyle(color: Colors.white70, fontSize: 12)),
              Text(name, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
              Text('Score: ${score.toStringAsFixed(4)}', style: const TextStyle(color: Colors.white, fontSize: 14)),
            ],
          ),
        ],
      ),
    );
  }

  // --- 3. 混淆矩阵 Tab ---
  Widget _buildConfusionMatrix() {
    final matrixData = widget.result.metrics['confusion_matrix'] as List?;
    if (matrixData == null) return const Center(child: Text('无混淆矩阵数据'));

    return Center(
      child: AspectRatio(
        aspectRatio: 1,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              const Text('Confusion Matrix Heatmap', style: TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 16),
              Expanded(
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final size = matrixData.length;
                    final cellSize = constraints.maxWidth / size;
                    
                    // 展平以找到最大值用于归一化颜色
                    final flatValues = matrixData.expand((e) => (e as List).cast<int>()).toList();
                    final maxValue = flatValues.reduce(math.max);

                    return GridView.builder(
                      itemCount: size * size,
                      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: size),
                      itemBuilder: (context, index) {
                        final row = index ~/ size;
                        final col = index % size;
                        final value = matrixData[row][col] as int;
                        final intensity = value / (maxValue == 0 ? 1 : maxValue);
                        
                        // 对角线为正确预测，使用绿色；非对角线为错误，使用红色
                        final isCorrect = row == col;
                        final color = isCorrect 
                            ? Colors.green.withOpacity(0.1 + 0.9 * intensity)
                            : Colors.red.withOpacity(0.1 + 0.9 * intensity);

                        return Container(
                          decoration: BoxDecoration(
                            color: color,
                            border: Border.all(color: Colors.white),
                          ),
                          child: Center(
                            child: Text(
                              value.toString(),
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                color: intensity > 0.5 ? Colors.white : Colors.black87,
                              ),
                            ),
                          ),
                        );
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // --- 4. ROC 曲线 Tab ---
  Widget _buildRocCurve() {
    final rocData = widget.result.visualizationData['roc_curve'] as Map<String, dynamic>?;
    if (rocData == null) return const Center(child: Text('无 ROC 曲线数据'));

    final fpr = List<double>.from(rocData['fpr'] ?? []);
    final tpr = List<double>.from(rocData['tpr'] ?? []);
    final auc = widget.result.metrics['auc_score'] ?? 0.0;

    final points = <FlSpot>[];
    for (int i = 0; i < fpr.length; i++) {
        points.add(FlSpot(fpr[i], tpr[i]));
    }

    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        children: [
          Text('ROC Curve (AUC = ${(auc as num).toStringAsFixed(4)})', 
               style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 24),
          Expanded(
            child: LineChart(
              LineChartData(
                minX: 0, maxX: 1,
                minY: 0, maxY: 1,
                titlesData: FlTitlesData(
                  bottomTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 30, interval: 0.2)),
                  leftTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 40, interval: 0.2)),
                  topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                ),
                gridData: const FlGridData(show: true),
                borderData: FlBorderData(show: true, border: Border.all(color: Colors.black12)),
                lineBarsData: [
                  LineChartBarData(
                    spots: points,
                    isCurved: true,
                    color: Colors.blue,
                    barWidth: 3,
                    dotData: const FlDotData(show: false),
                    belowBarData: BarAreaData(show: true, color: Colors.blue.withOpacity(0.2)),
                  ),
                  // 对角线
                  LineChartBarData(
                    spots: [const FlSpot(0, 0), const FlSpot(1, 1)],
                    isCurved: false,
                    color: Colors.grey,
                    barWidth: 1,
                    dashArray: [5, 5],
                    dotData: const FlDotData(show: false),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          const Text('X: False Positive Rate  |  Y: True Positive Rate', style: TextStyle(color: Colors.grey)),
        ],
      ),
    );
  }

  // --- 5. 特征重要性 Tab ---
  Widget _buildFeatureImportance() {
    final importanceMap = widget.result.visualizationData['feature_importance'] as dynamic;
    List<double> importanceValues = [];
    
    // 兼容以前的 List 格式和新的 Dict 格式 (如有)
    if (importanceMap is List) {
      importanceValues = importanceMap.cast<double>();
    } else if (importanceMap is Map) {
      // 如果后端返回 Map {feat: score}，可以在这里处理，暂且假设是 List
      return const Center(child: Text('Map format not supported yet'));
    }

    if (importanceValues.isEmpty) return const Center(child: Text('无特征重要性数据'));

    // 结合特征名
    final features = widget.config.featureColumns;
    final List<MapEntry<String, double>> featImp = [];
    for (int i = 0; i < math.min(features.length, importanceValues.length); i++) {
        featImp.add(MapEntry(features[i], importanceValues[i]));
    }
    
    // 排序
    featImp.sort((a, b) => b.value.compareTo(a.value));
    
    // 只取前 10 个
    final topFeat = featImp.take(10).toList();

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          const Text('Top 10 Feature Importance', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 16),
          Expanded(
            child: BarChart(
              BarChartData(
                alignment: BarChartAlignment.spaceAround,
                maxY: (topFeat.first.value * 1.2), // 稍微留点空间
                barTouchData: BarTouchData(
                  enabled: true,
                  touchTooltipData: BarTouchTooltipData(tooltipBgColor: Colors.blueGrey),
                ),
                titlesData: FlTitlesData(
                  show: true,
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 60,
                      getTitlesWidget: (val, meta) {
                        final index = val.toInt();
                        if (index >= 0 && index < topFeat.length) {
                          return Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: RotatedBox(
                              quarterTurns: 1,
                              child: Text(
                                topFeat[index].key, 
                                style: const TextStyle(fontSize: 10),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          );
                        }
                        return const SizedBox.shrink();
                      },
                    ),
                  ),
                  leftTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 40)),
                  topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                ),
                gridData: const FlGridData(show: true, drawVerticalLine: false),
                borderData: FlBorderData(show: false),
                barGroups: topFeat.asMap().entries.map((entry) {
                   return BarChartGroupData(
                     x: entry.key,
                     barRods: [
                       BarChartRodData(
                         toY: entry.value.value,
                         color: Colors.blue,
                         width: 16,
                         borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                       )
                     ],
                   );
                }).toList(),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // --- 6. 预测散点图 Tab (回归) ---
  Widget _buildPredictionScatter() {
    final scatterData = widget.result.visualizationData['prediction_scatter'] as Map<String, dynamic>?;
    if (scatterData == null) return const Center(child: Text('无预测散点数据'));
    
    final yTrue = List<double>.from(scatterData['y_true'] ?? []);
    final yPred = List<double>.from(scatterData['y_pred'] ?? []);
    
    // 降采样
    final points = <ScatterSpot>[];
    const maxPoints = 500;
    final step = math.max(1, (yTrue.length / maxPoints).ceil());
    
    for (int i = 0; i < yTrue.length; i += step) {
      points.add(ScatterSpot(yTrue[i], yPred[i], dotPainter: FlDotCirclePainter(radius: 3, color: Colors.blue.withOpacity(0.5))));
    }
    
    double minVal = 0, maxVal = 1;
    if (yTrue.isNotEmpty) {
       final allVals = [...yTrue, ...yPred];
       minVal = allVals.reduce(math.min);
       maxVal = allVals.reduce(math.max);
       // Add some padding
       final range = maxVal - minVal;
       minVal -= range * 0.05;
       maxVal += range * 0.05;
    }

    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        children: [
          const Text('Predicted vs Actual', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 24),
          Expanded(
            child: ScatterChart(
              ScatterChartData(
                scatterSpots: points,
                minX: minVal, maxX: maxVal,
                minY: minVal, maxY: maxVal,
                titlesData: FlTitlesData(
                  bottomTitles: AxisTitles(
                    axisNameWidget: const Text("Actual Value"),
                    sideTitles: SideTitles(showTitles: true, reservedSize: 30),
                  ),
                  leftTitles: AxisTitles(
                    axisNameWidget: const Text("Predicted Value"),
                    sideTitles: SideTitles(showTitles: true, reservedSize: 40),
                  ),
                  topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                ),
                gridData: const FlGridData(show: true),
                borderData: FlBorderData(show: true, border: Border.all(color: Colors.black12)),
                // 绘制参考线 (通过 extraLinesData ? 但 ScatterChart 不支持 LineBars easily)
                // 简单起见，我们只画散点。如果需要参考线，可能需要 Stack 叠加一个 LineChart 或 CustomPainter
              ),
            ),
          ),
        ],
      ),
    );
  }
  
  // --- 7. 残差分析 Tab ---
  Widget _buildResidualPlot() {
    final residuals = List<double>.from(widget.result.visualizationData['residuals'] ?? []);
    if (residuals.isEmpty) return const Center(child: Text('无残差数据'));
    
    final points = <FlSpot>[];
    for (int i = 0; i < residuals.length; i++) {
      points.add(FlSpot(i.toDouble(), residuals[i]));
    }
    
    // 找出最大绝对值以对称显示
    double maxRes = 0;
    if (residuals.isNotEmpty) {
      maxRes = residuals.map((e) => e.abs()).reduce(math.max);
    }
    
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          const Text('Residuals (Sampled)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 24),
          Expanded(
             child: LineChart(
               LineChartData(
                 minY: -maxRes * 1.1,
                 maxY: maxRes * 1.1,
                 titlesData: FlTitlesData(
                   bottomTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                   leftTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 40)),
                   topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                   rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                 ),
                 gridData: const FlGridData(show: true),
                 borderData: FlBorderData(show: true, border: Border.all(color: Colors.black12)),
                 lineBarsData: [
                   LineChartBarData(
                     spots: points,
                     isCurved: false,
                     color: Colors.redAccent,
                     barWidth: 1,
                     dotData: const FlDotData(show: true, checkToShowDot: _showDot),
                     belowBarData: BarAreaData(show: false),
                   ),
                   // Zero line
                   LineChartBarData(
                     spots: [FlSpot(0, 0), FlSpot(residuals.length.toDouble(), 0)],
                     color: Colors.black54,
                     barWidth: 2,
                     dashArray: [5, 5],
                     dotData: const FlDotData(show: false),
                   )
                 ]
               ),
             ),
          ),
        ],
      ),
    );
  }
  
  static bool _showDot(FlSpot spot, LineChartBarData barData) {
     return false; // too many dots
  }

  // 专门的 Scatter Chart 封装
  Widget _buildClusteringVisualization() {
    final pcaMap = widget.result.visualizationData['pca'] as Map<String, dynamic>?;
    if (pcaMap == null) return const Center(child: Text('无 2D 聚类可视化数据 (需特征数>2)'));
    
    final xList = List<double>.from(pcaMap['x'] ?? []);
    final yList = List<double>.from(pcaMap['y'] ?? []);
    final labels = List<int>.from(pcaMap['labels'] ?? []);
    
    if (xList.isEmpty) return const Center(child: Text('暂无数据'));
    
    // 生成颜色映射
    final uniqueLabels = labels.toSet().toList();
    final colors = [
      Colors.blue, Colors.red, Colors.green, Colors.orange, 
      Colors.purple, Colors.teal, Colors.pink, Colors.amber
    ];
    
    final points = <ScatterSpot>[];
    for (int i = 0; i < xList.length; i++) {
       final label = labels[i];
       final colorIdx = uniqueLabels.indexOf(label) % colors.length;
       points.add(ScatterSpot(
         xList[i], 
         yList[i], 
         dotPainter: FlDotCirclePainter(
           radius: 4, 
           color: colors[colorIdx].withOpacity(0.6),
           strokeWidth: 0,
         ),
       ));
    }
    
    // 计算边界
    double minX = xList.reduce(math.min);
    double maxX = xList.reduce(math.max);
    double minY = yList.reduce(math.min);
    double maxY = yList.reduce(math.max);
    
    final paddingX = (maxX - minX) * 0.1;
    final paddingY = (maxY - minY) * 0.1;

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          const Text('PCA 2D Projection', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: uniqueLabels.map((l) {
               final idx = uniqueLabels.indexOf(l);
               return Padding(
                 padding: const EdgeInsets.symmetric(horizontal: 4),
                 child: Chip(
                   label: Text('Cluster $l'),
                   backgroundColor: colors[idx % colors.length].withOpacity(0.2),
                   visualDensity: VisualDensity.compact,
                 ),
               );
            }).toList(),
          ),
          const SizedBox(height: 16),
          Expanded(
            child: ScatterChart(
              ScatterChartData(
                scatterSpots: points,
                minX: minX - paddingX,
                maxX: maxX + paddingX,
                minY: minY - paddingY,
                maxY: maxY + paddingY,
                titlesData: FlTitlesData(show: false),
                gridData: const FlGridData(show: true),
                borderData: FlBorderData(show: true, border: Border.all(color: Colors.black12)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class MetricItem {
  final String label;
  final num value;
  final IconData icon;
  final Color color;
  MetricItem(this.label, this.value, this.icon, this.color);
}
