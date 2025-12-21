import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../services/ml_service.dart';

class ExperimentHistoryScreen extends StatefulWidget {
  const ExperimentHistoryScreen({Key? key}) : super(key: key);

  @override
  State<ExperimentHistoryScreen> createState() => _ExperimentHistoryScreenState();
}

class _ExperimentHistoryScreenState extends State<ExperimentHistoryScreen> {
  final MLService _mlService = MLService();
  final ScrollController _scrollController = ScrollController();
  
  List<Map<String, dynamic>> _experiments = [];
  bool _isLoading = true;
  String? _error;
  
  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  Future<void> _loadHistory() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    
    try {
      // TODO: Replace with actual user ID from auth service
      final history = await MLService.getExperimentHistory(userId: 'anonymous', limit: 20);
      setState(() {
        _experiments = history;
        _isLoading = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('实验历史'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadHistory,
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 48, color: Colors.grey),
            const SizedBox(height: 16),
            Text('加载失败: $_error'),
            TextButton(onPressed: _loadHistory, child: const Text('重试')),
          ],
        ),
      );
    }
    
    if (_experiments.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.history, size: 48, color: Colors.grey),
            SizedBox(height: 16),
            Text('暂无实验记录'),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadHistory,
      child: ListView.builder(
        controller: _scrollController,
        padding: const EdgeInsets.all(16),
        itemCount: _experiments.length,
        itemBuilder: (context, index) {
          final experiment = _experiments[index];
          return _buildExperimentCard(experiment);
        },
      ),
    );
  }

  Widget _buildExperimentCard(Map<String, dynamic> experiment) {
    final taskType = experiment['taskType'] ?? experiment['task_type'] ?? 'unknown';
    final modelConfig = experiment['modelConfig'] ?? experiment['model_config'] ?? {};
    final modelName = modelConfig['model_name'] ?? 'Unknown Model';
    final timestamp = experiment['timestamp'];
    final metrics = experiment['metrics'] ?? {};
    
    DateTime time;
    try {
      time = DateTime.parse(timestamp);
    } catch (e) {
      time = DateTime.now();
    }

    Color typeColor = Colors.blue;
    IconData typeIcon = Icons.help;
    
    switch (taskType) {
      case 'classification':
        typeColor = Colors.green;
        typeIcon = Icons.category;
        break;
      case 'regression':
        typeColor = Colors.orange;
        typeIcon = Icons.trending_up;
        break;
      case 'clustering':
        typeColor = Colors.purple;
        typeIcon = Icons.bubble_chart;
        break;
    }

    return Card(
      elevation: 2,
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _navigateToDetail(experiment),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: typeColor.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Row(
                      children: [
                        Icon(typeIcon, size: 16, color: typeColor),
                        const SizedBox(width: 4),
                        Text(taskType.toUpperCase(), style: TextStyle(color: typeColor, fontWeight: FontWeight.bold, fontSize: 12)),
                      ],
                    ),
                  ),
                  Text(
                    DateFormat('yyyy-MM-dd HH:mm').format(time),
                    style: TextStyle(color: Colors.grey[600], fontSize: 12),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                modelName,
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
              ),
              const SizedBox(height: 8),
              _buildMetricsSummary(taskType, metrics),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMetricsSummary(String taskType, Map<String, dynamic> metrics) {
    final List<Widget> items = [];
    
    if (taskType == 'classification') {
      if (metrics.containsKey('accuracy')) items.add(_buildMetricItem('Accuracy', metrics['accuracy']));
      if (metrics.containsKey('f1_score')) items.add(_buildMetricItem('F1', metrics['f1_score']));
    } else if (taskType == 'regression') {
      if (metrics.containsKey('r2_score')) items.add(_buildMetricItem('R²', metrics['r2_score']));
      if (metrics.containsKey('mse')) items.add(_buildMetricItem('MSE', metrics['mse']));
    } else {
      if (metrics.containsKey('n_clusters')) items.add(_buildMetricItem('Clusters', metrics['n_clusters']));
      if (metrics.containsKey('silhouette_score')) items.add(_buildMetricItem('Silhouette', metrics['silhouette_score']));
    }

    if (items.isEmpty) return const Text('No metrics available', style: TextStyle(color: Colors.grey));

    return Row(children: items);
  }

  Widget _buildMetricItem(String label, dynamic value) {
    String displayValue = value.toString();
    if (value is num) {
      displayValue = value.toStringAsFixed(4);
    }
    
    return Padding(
      padding: const EdgeInsets.only(right: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: Colors.grey, fontSize: 10)),
          Text(displayValue, style: const TextStyle(fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
  
  void _navigateToDetail(Map<String, dynamic> experiment) {
    final config = experiment['modelConfig'] ?? experiment['model_config'] ?? {};
    final featureColumns = (experiment['feature_columns'] as List?)?.cast<String>() ?? [];
    
    context.pushNamed(
      'experiment-results',
      pathParameters: {'experimentId': experiment['id'] ?? 'history'},
      extra: {
        'metrics': experiment['metrics'] ?? {},
        'visualizationData': {}, // History doesn't typically have full viz data stored currently
        'taskType': experiment['taskType'] ?? experiment['task_type'],
        'modelName': config['model_name'],
        'featureColumns': featureColumns,
      },
    );
  }
}
