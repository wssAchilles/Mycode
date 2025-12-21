import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../services/ml_service.dart';

/// 机器学习实验平台主页
class MLHomeScreen extends StatefulWidget {
  const MLHomeScreen({Key? key}) : super(key: key);

  @override
  State<MLHomeScreen> createState() => _MLHomeScreenState();
}

class _MLHomeScreenState extends State<MLHomeScreen> {
  final MLService _mlService = MLService();
  List<Map<String, dynamic>> _recentExperiments = [];
  bool _isLoadingHistory = false;

  @override
  void initState() {
    super.initState();
    _loadExperimentHistory();
  }

  Future<void> _loadExperimentHistory() async {
    setState(() {
      _isLoadingHistory = true;
    });

    try {
      final experiments = await _mlService.getExperimentHistory(limit: 5);
      setState(() {
        _recentExperiments = experiments;
        _isLoadingHistory = false;
      });
    } catch (e) {
      setState(() {
        _isLoadingHistory = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
          tooltip: '返回',
        ),
        title: const Text('机器学习实验平台'),
        centerTitle: true,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 欢迎横幅
            _buildWelcomeBanner(),
            const SizedBox(height: 24),
            
            // 快速开始区域
            _buildQuickStartSection(),
            const SizedBox(height: 24),
            
            // 实验历史
            _buildExperimentHistory(),
            const SizedBox(height: 24),
            
            // 功能介绍
            _buildFeatureGrid(),
          ],
        ),
      ),
    );
  }

  /// 构建欢迎横幅
  Widget _buildWelcomeBanner() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            Theme.of(context).primaryColor,
            Theme.of(context).primaryColor.withOpacity(0.7),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Theme.of(context).primaryColor.withOpacity(0.3),
            blurRadius: 10,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.psychology,
                color: Colors.white,
                size: 48,
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '机器学习实验平台',
                      style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '上传数据集，选择模型，云端训练，结果可视化',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Colors.white.withOpacity(0.9),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: () => context.go('/ml/upload'),
            icon: const Icon(Icons.rocket_launch),
            label: const Text('开始新实验'),
            style: FilledButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: Theme.of(context).primaryColor,
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
            ),
          ),
        ],
      ),
    );
  }

  /// 构建快速开始区域
  Widget _buildQuickStartSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.flash_on, color: Theme.of(context).primaryColor),
            const SizedBox(width: 8),
            Text(
              '快速开始',
              style: Theme.of(context).textTheme.titleLarge,
            ),
          ],
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: _buildQuickStartCard(
                icon: Icons.upload_file,
                title: '上传数据',
                subtitle: '选择CSV数据集',
                onTap: () => context.go('/ml/upload'),
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: _buildQuickStartCard(
                icon: Icons.history,
                title: '历史记录',
                subtitle: '查看过往实验',
                onTap: _showFullHistory,
              ),
            ),
          ],
        ),
      ],
    );
  }

  /// 构建快速开始卡片
  Widget _buildQuickStartCard({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.05),
              blurRadius: 10,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: Theme.of(context).primaryColor.withOpacity(0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                icon,
                color: Theme.of(context).primaryColor,
                size: 28,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              title,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              subtitle,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Colors.grey,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// 构建实验历史区域
  Widget _buildExperimentHistory() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                Icon(Icons.history, color: Theme.of(context).primaryColor),
                const SizedBox(width: 8),
                Text(
                  '最近实验',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ],
            ),
            TextButton(
              onPressed: _showFullHistory,
              child: const Text('查看全部'),
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (_isLoadingHistory)
          const Center(child: CircularProgressIndicator())
        else if (_recentExperiments.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(32),
            decoration: BoxDecoration(
              color: Colors.grey.shade100,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: [
                Icon(
                  Icons.science_outlined,
                  size: 64,
                  color: Colors.grey.shade400,
                ),
                const SizedBox(height: 16),
                Text(
                  '暂无实验记录',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: Colors.grey,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  '开始您的第一个机器学习实验',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Colors.grey,
                  ),
                ),
              ],
            ),
          )
        else
          ...List.generate(
            _recentExperiments.length > 3 ? 3 : _recentExperiments.length,
            (index) => _buildExperimentCard(_recentExperiments[index]),
          ),
      ],
    );
  }

  /// 构建实验卡片
  Widget _buildExperimentCard(Map<String, dynamic> experiment) {
    final modelConfig = experiment['model_config'] ?? {};
    final metrics = experiment['metrics'] ?? {};
    final taskType = experiment['task_type'] ?? 'classification';
    
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: _getTaskTypeColor(taskType).withOpacity(0.1),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(
            _getTaskTypeIcon(taskType),
            color: _getTaskTypeColor(taskType),
          ),
        ),
        title: Text(modelConfig['model_name'] ?? '未知模型'),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _getTaskTypeText(taskType),
              style: const TextStyle(fontSize: 12),
            ),
            const SizedBox(height: 4),
            _buildMetricChips(metrics, taskType),
          ],
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              _formatTimestamp(experiment['timestamp']),
              style: const TextStyle(fontSize: 12, color: Colors.grey),
            ),
          ],
        ),
        isThreeLine: true,
        onTap: () {
          // TODO: 查看历史实验结果
        },
      ),
    );
  }

  /// 构建指标芯片
  Widget _buildMetricChips(Map<String, dynamic> metrics, String taskType) {
    return Wrap(
      spacing: 4,
      children: [
        if (taskType == 'classification' && metrics['accuracy'] != null)
          Chip(
            label: Text(
              '准确率: ${(metrics['accuracy'] * 100).toStringAsFixed(1)}%',
              style: const TextStyle(fontSize: 10),
            ),
            visualDensity: VisualDensity.compact,
          ),
        if (taskType == 'regression' && metrics['r2_score'] != null)
          Chip(
            label: Text(
              'R²: ${metrics['r2_score'].toStringAsFixed(3)}',
              style: const TextStyle(fontSize: 10),
            ),
            visualDensity: VisualDensity.compact,
          ),
        if (taskType == 'clustering' && metrics['n_clusters'] != null)
          Chip(
            label: Text(
              '聚类数: ${metrics['n_clusters']}',
              style: const TextStyle(fontSize: 10),
            ),
            visualDensity: VisualDensity.compact,
          ),
      ],
    );
  }

  /// 构建功能网格
  Widget _buildFeatureGrid() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.dashboard, color: Theme.of(context).primaryColor),
            const SizedBox(width: 8),
            Text(
              '平台功能',
              style: Theme.of(context).textTheme.titleLarge,
            ),
          ],
        ),
        const SizedBox(height: 16),
        GridView.count(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisCount: 2,
          childAspectRatio: 1.5,
          crossAxisSpacing: 16,
          mainAxisSpacing: 16,
          children: [
            _buildFeatureCard(
              icon: Icons.category,
              title: '分类算法',
              description: '支持7种经典分类算法',
              color: Colors.blue,
            ),
            _buildFeatureCard(
              icon: Icons.show_chart,
              title: '回归算法',
              description: '支持7种回归算法',
              color: Colors.green,
            ),
            _buildFeatureCard(
              icon: Icons.bubble_chart,
              title: '聚类算法',
              description: '支持4种聚类算法',
              color: Colors.orange,
            ),
            _buildFeatureCard(
              icon: Icons.auto_graph,
              title: '智能可视化',
              description: '自动生成结果图表',
              color: Colors.purple,
            ),
          ],
        ),
      ],
    );
  }

  /// 构建功能卡片
  Widget _buildFeatureCard({
    required IconData icon,
    required String title,
    required String description,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(
              icon,
              color: color,
              size: 24,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            title,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 4),
          Text(
            description,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Colors.grey,
            ),
          ),
        ],
      ),
    );
  }

  /// 获取任务类型颜色
  Color _getTaskTypeColor(String taskType) {
    switch (taskType) {
      case 'classification':
        return Colors.blue;
      case 'regression':
        return Colors.green;
      case 'clustering':
        return Colors.orange;
      default:
        return Colors.grey;
    }
  }

  /// 获取任务类型图标
  IconData _getTaskTypeIcon(String taskType) {
    switch (taskType) {
      case 'classification':
        return Icons.category;
      case 'regression':
        return Icons.show_chart;
      case 'clustering':
        return Icons.bubble_chart;
      default:
        return Icons.help_outline;
    }
  }

  /// 获取任务类型文本
  String _getTaskTypeText(String taskType) {
    switch (taskType) {
      case 'classification':
        return '分类任务';
      case 'regression':
        return '回归任务';
      case 'clustering':
        return '聚类任务';
      default:
        return '未知任务';
    }
  }

  /// 格式化时间戳
  String _formatTimestamp(dynamic timestamp) {
    if (timestamp == null) return '未知时间';
    
    try {
      final dateTime = DateTime.parse(timestamp.toString());
      final now = DateTime.now();
      final difference = now.difference(dateTime);
      
      if (difference.inDays > 0) {
        return '${difference.inDays}天前';
      } else if (difference.inHours > 0) {
        return '${difference.inHours}小时前';
      } else if (difference.inMinutes > 0) {
        return '${difference.inMinutes}分钟前';
      } else {
        return '刚刚';
      }
    } catch (e) {
      return '未知时间';
    }
  }

  /// 显示完整历史记录
  void _showFullHistory() {
    context.pushNamed('ml-history');
  }
}
