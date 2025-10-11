import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'dart:math' as math;
import '../models/achievement_model.dart';
import '../services/achievement_service.dart';
import 'package:go_router/go_router.dart';

/// 学习仪表盘界面
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({Key? key}) : super(key: key);

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen>
    with TickerProviderStateMixin {
  final AchievementService _achievementService = AchievementService();
  
  // 数据状态
  LearningStats? _stats;
  List<Achievement>? _achievements;
  Map<String, double>? _moduleProgress;
  Map<DateTime, int>? _activityHeatmap;
  List<Map<String, dynamic>>? _leaderboard;
  
  // 加载状态
  bool _isLoading = true;
  
  // 动画控制器
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  
  // 选中的时间范围
  int _selectedDays = 30;

  @override
  void initState() {
    super.initState();
    
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 1000),
      vsync: this,
    );
    
    _fadeAnimation = Tween<double>(
      begin: 0.0,
      end: 1.0,
    ).animate(CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeInOut,
    ));
    
    _loadData();
    _animationController.forward();
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  /// 加载数据
  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    
    try {
      final stats = await _achievementService.getUserStats();
      final achievements = await _achievementService.getUserAchievements();
      final moduleProgress = await _achievementService.getModuleProgressPercentage();
      final activityHeatmap = await _achievementService.getActivityHeatmap(
        days: _selectedDays,
      );
      final leaderboard = await _achievementService.getLeaderboard();
      
      if (mounted) {
        setState(() {
          _stats = stats;
          _achievements = achievements;
          _moduleProgress = moduleProgress;
          _activityHeatmap = activityHeatmap;
          _leaderboard = leaderboard;
          _isLoading = false;
        });
      }
    } catch (e) {
      print('Error loading dashboard data: $e');
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Scaffold(
      backgroundColor: Colors.grey[50],
      appBar: AppBar(
        title: const Text('学习仪表盘'),
        centerTitle: true,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadData,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : FadeTransition(
              opacity: _fadeAnimation,
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // 用户统计卡片
                    _buildStatsCards(),
                    const SizedBox(height: 24),
                    
                    // 学习活动热力图
                    _buildActivityHeatmap(),
                    const SizedBox(height: 24),
                    
                    // 模块进度
                    _buildModuleProgress(),
                    const SizedBox(height: 24),
                    
                    // 成就墙
                    _buildAchievementWall(),
                    const SizedBox(height: 24),
                    
                    // 排行榜
                    _buildLeaderboard(),
                  ],
                ),
              ),
            ),
    );
  }

  /// 构建统计卡片
  Widget _buildStatsCards() {
    if (_stats == null) return const SizedBox();
    
    return Row(
      children: [
        Expanded(
          child: _buildStatCard(
            icon: Icons.timer,
            title: '学习时长',
            value: '${_stats!.totalTimeSpent ~/ 60}',
            unit: '小时',
            color: Colors.blue,
            subtitle: '${_stats!.totalTimeSpent % 60}分钟',
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _buildStatCard(
            icon: Icons.local_fire_department,
            title: '连续天数',
            value: '${_stats!.streakDays}',
            unit: '天',
            color: Colors.orange,
            subtitle: _getStreakMessage(_stats!.streakDays),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _buildStatCard(
            icon: Icons.emoji_events,
            title: '总积分',
            value: '${_stats!.totalPoints}',
            unit: '分',
            color: Colors.amber,
            subtitle: '${_stats!.unlockedAchievements.length}个成就',
          ),
        ),
      ],
    );
  }

  /// 构建统计卡片
  Widget _buildStatCard({
    required IconData icon,
    required String title,
    required String value,
    required String unit,
    required Color color,
    String? subtitle,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: color.withOpacity(0.1),
            blurRadius: 10,
            offset: const Offset(0, 5),
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
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: color, size: 24),
          ),
          const SizedBox(height: 12),
          Text(
            title,
            style: TextStyle(
              fontSize: 12,
              color: Colors.grey[600],
            ),
          ),
          const SizedBox(height: 4),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                value,
                style: const TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(width: 4),
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  unit,
                  style: TextStyle(
                    fontSize: 14,
                    color: Colors.grey[600],
                  ),
                ),
              ),
            ],
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(
              subtitle,
              style: TextStyle(
                fontSize: 11,
                color: Colors.grey[500],
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// 构建学习活动热力图
  Widget _buildActivityHeatmap() {
    if (_activityHeatmap == null) return const SizedBox();
    
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                '学习活动',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              SegmentedButton<int>(
                segments: const [
                  ButtonSegment(value: 7, label: Text('7天')),
                  ButtonSegment(value: 30, label: Text('30天')),
                  ButtonSegment(value: 90, label: Text('90天')),
                ],
                selected: {_selectedDays},
                onSelectionChanged: (Set<int> selection) {
                  setState(() {
                    _selectedDays = selection.first;
                  });
                  _loadData();
                },
              ),
            ],
          ),
          const SizedBox(height: 20),
          SizedBox(
            height: 200,
            child: _buildActivityChart(),
          ),
        ],
      ),
    );
  }

  /// 构建活动图表
  Widget _buildActivityChart() {
    if (_activityHeatmap == null || _activityHeatmap!.isEmpty) {
      return Center(
        child: Text(
          '暂无学习记录',
          style: TextStyle(color: Colors.grey[400]),
        ),
      );
    }

    // 准备图表数据
    final now = DateTime.now();
    final spots = <FlSpot>[];
    
    for (int i = 0; i < _selectedDays; i++) {
      final date = now.subtract(Duration(days: _selectedDays - i - 1));
      final dateKey = DateTime(date.year, date.month, date.day);
      final minutes = _activityHeatmap![dateKey] ?? 0;
      spots.add(FlSpot(i.toDouble(), minutes.toDouble()));
    }

    return LineChart(
      LineChartData(
        gridData: FlGridData(
          show: true,
          drawVerticalLine: true,
          horizontalInterval: 30,
          verticalInterval: _selectedDays / 7,
          getDrawingHorizontalLine: (value) {
            return FlLine(
              color: Colors.grey[200]!,
              strokeWidth: 1,
            );
          },
          getDrawingVerticalLine: (value) {
            return FlLine(
              color: Colors.grey[200]!,
              strokeWidth: 1,
            );
          },
        ),
        titlesData: FlTitlesData(
          show: true,
          rightTitles: AxisTitles(
            sideTitles: SideTitles(showTitles: false),
          ),
          topTitles: AxisTitles(
            sideTitles: SideTitles(showTitles: false),
          ),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 30,
              interval: _selectedDays / 7,
              getTitlesWidget: (value, meta) {
                if (value.toInt() % (_selectedDays ~/ 7) != 0) {
                  return const Text('');
                }
                final date = now.subtract(
                  Duration(days: _selectedDays - value.toInt() - 1),
                );
                return Text(
                  '${date.month}/${date.day}',
                  style: const TextStyle(fontSize: 10),
                );
              },
            ),
          ),
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              interval: 30,
              reservedSize: 40,
              getTitlesWidget: (value, meta) {
                return Text(
                  '${value.toInt()}m',
                  style: const TextStyle(fontSize: 10),
                );
              },
            ),
          ),
        ),
        borderData: FlBorderData(
          show: true,
          border: Border.all(color: Colors.grey[300]!),
        ),
        minX: 0,
        maxX: (_selectedDays - 1).toDouble(),
        minY: 0,
        maxY: spots.map((s) => s.y).reduce(math.max) + 10,
        lineBarsData: [
          LineChartBarData(
            spots: spots,
            isCurved: true,
            gradient: LinearGradient(
              colors: [
                Theme.of(context).primaryColor,
                Theme.of(context).primaryColor.withOpacity(0.5),
              ],
            ),
            barWidth: 3,
            isStrokeCapRound: true,
            dotData: FlDotData(
              show: true,
              getDotPainter: (spot, percent, barData, index) {
                return FlDotCirclePainter(
                  radius: 3,
                  color: Theme.of(context).primaryColor,
                  strokeWidth: 1,
                  strokeColor: Colors.white,
                );
              },
            ),
            belowBarData: BarAreaData(
              show: true,
              gradient: LinearGradient(
                colors: [
                  Theme.of(context).primaryColor.withOpacity(0.2),
                  Theme.of(context).primaryColor.withOpacity(0.0),
                ],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// 构建模块进度
  Widget _buildModuleProgress() {
    if (_moduleProgress == null) return const SizedBox();
    
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '模块进度',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 20),
          ..._moduleProgress!.entries.map((entry) {
            return _buildProgressBar(
              label: _getModuleName(entry.key),
              progress: entry.value,
              color: _getModuleColor(entry.key),
              icon: _getModuleIcon(entry.key),
            );
          }).toList(),
        ],
      ),
    );
  }

  /// 构建进度条
  Widget _buildProgressBar({
    required String label,
    required double progress,
    required Color color,
    required IconData icon,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, color: color, size: 18),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      label,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    Text(
                      '${(progress * 100).toInt()}%',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: color,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 8,
              backgroundColor: color.withOpacity(0.1),
              valueColor: AlwaysStoppedAnimation<Color>(color),
            ),
          ),
        ],
      ),
    );
  }

  /// 构建成就墙
  Widget _buildAchievementWall() {
    if (_achievements == null) return const SizedBox();
    
    // 按类别分组
    final groupedAchievements = <String, List<Achievement>>{};
    for (final achievement in _achievements!) {
      groupedAchievements.putIfAbsent(achievement.category, () => []);
      groupedAchievements[achievement.category]!.add(achievement);
    }
    
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                '成就墙',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              Text(
                '${_achievements!.where((a) => a.isUnlocked).length}/${_achievements!.length}',
                style: TextStyle(
                  fontSize: 14,
                  color: Colors.grey[600],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          ...groupedAchievements.entries.map((entry) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      AchievementCategory.getCategoryIcon(entry.key),
                      size: 16,
                      color: AchievementCategory.getCategoryColor(entry.key),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      AchievementCategory.getCategoryName(entry.key),
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                        color: AchievementCategory.getCategoryColor(entry.key),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: entry.value.map((achievement) {
                    return _buildAchievementBadge(achievement);
                  }).toList(),
                ),
                const SizedBox(height: 16),
              ],
            );
          }).toList(),
        ],
      ),
    );
  }

  /// 构建成就徽章
  Widget _buildAchievementBadge(Achievement achievement) {
    final isUnlocked = achievement.isUnlocked;
    final color = AchievementCategory.getCategoryColor(achievement.category);
    
    return Tooltip(
      message: '${achievement.name}\n${achievement.description}\n+${achievement.points}分',
      child: Container(
        width: 60,
        height: 60,
        decoration: BoxDecoration(
          color: isUnlocked ? color.withOpacity(0.1) : Colors.grey[200],
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isUnlocked ? color : Colors.grey[400]!,
            width: 2,
          ),
        ),
        child: Stack(
          alignment: Alignment.center,
          children: [
            Icon(
              _getAchievementIcon(achievement),
              size: 28,
              color: isUnlocked ? color : Colors.grey[400],
            ),
            if (!isUnlocked)
              Container(
                width: 60,
                height: 60,
                decoration: BoxDecoration(
                  color: Colors.black.withOpacity(0.5),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(
                  Icons.lock,
                  size: 20,
                  color: Colors.white,
                ),
              ),
            if (achievement.progressPercentage > 0 && !isUnlocked)
              Positioned(
                bottom: 4,
                child: Container(
                  width: 52,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.grey[300],
                    borderRadius: BorderRadius.circular(2),
                  ),
                  child: FractionallySizedBox(
                    widthFactor: achievement.progressPercentage,
                    alignment: Alignment.centerLeft,
                    child: Container(
                      decoration: BoxDecoration(
                        color: color,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// 构建排行榜
  Widget _buildLeaderboard() {
    if (_leaderboard == null || _leaderboard!.isEmpty) return const SizedBox();
    
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '排行榜 Top 10',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 20),
          ..._leaderboard!.asMap().entries.map((entry) {
            final index = entry.key;
            final user = entry.value;
            return _buildLeaderboardItem(index + 1, user);
          }).toList(),
        ],
      ),
    );
  }

  /// 构建排行榜项
  Widget _buildLeaderboardItem(int rank, Map<String, dynamic> user) {
    Color? rankColor;
    IconData? rankIcon;
    
    if (rank == 1) {
      rankColor = Colors.amber;
      rankIcon = Icons.emoji_events;
    } else if (rank == 2) {
      rankColor = Colors.grey[400];
      rankIcon = Icons.emoji_events;
    } else if (rank == 3) {
      rankColor = Colors.brown[300];
      rankIcon = Icons.emoji_events;
    }
    
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: rank <= 3 ? rankColor!.withOpacity(0.1) : Colors.grey[50],
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: rank <= 3 ? rankColor! : Colors.grey[300]!,
          width: 1,
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: rank <= 3 ? rankColor : Colors.grey[300],
              shape: BoxShape.circle,
            ),
            child: Center(
              child: rank <= 3
                  ? Icon(rankIcon, size: 18, color: Colors.white)
                  : Text(
                      '$rank',
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
            ),
          ),
          const SizedBox(width: 12),
          CircleAvatar(
            radius: 20,
            backgroundImage: user['photoUrl'] != null
                ? NetworkImage(user['photoUrl'])
                : null,
            child: user['photoUrl'] == null
                ? Text(user['displayName'][0].toUpperCase())
                : null,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  user['displayName'],
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                Text(
                  '${user['completedModules']}个模块 · ${user['streakDays']}天连续',
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.grey[600],
                  ),
                ),
              ],
            ),
          ),
          Text(
            '${user['totalPoints']}',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: rank <= 3 ? rankColor : Theme.of(context).primaryColor,
            ),
          ),
        ],
      ),
    );
  }

  /// 获取连续天数消息
  String _getStreakMessage(int days) {
    if (days == 0) return '开始你的学习之旅';
    if (days < 7) return '继续保持！';
    if (days < 30) return '太棒了！';
    if (days < 100) return '学习达人！';
    return '学习传奇！';
  }

  /// 获取模块名称
  String _getModuleName(String module) {
    switch (module) {
      case 'algorithm':
        return '算法';
      case 'dataStructure':
        return '数据结构';
      case 'os':
        return '操作系统';
      case 'network':
        return '网络协议';
      case 'ml':
        return '机器学习';
      default:
        return module;
    }
  }

  /// 获取模块颜色
  Color _getModuleColor(String module) {
    switch (module) {
      case 'algorithm':
        return Colors.blue;
      case 'dataStructure':
        return Colors.green;
      case 'os':
        return Colors.purple;
      case 'network':
        return Colors.indigo;
      case 'ml':
        return Colors.deepOrange;
      default:
        return Colors.grey;
    }
  }

  /// 获取模块图标
  IconData _getModuleIcon(String module) {
    switch (module) {
      case 'algorithm':
        return Icons.sort;
      case 'dataStructure':
        return Icons.account_tree;
      case 'os':
        return Icons.computer;
      case 'network':
        return Icons.lan;
      case 'ml':
        return Icons.psychology;
      default:
        return Icons.folder;
    }
  }

  /// 获取成就图标
  IconData _getAchievementIcon(Achievement achievement) {
    // 根据成就ID返回特定图标
    switch (achievement.id) {
      case 'FIRST_SORT':
        return Icons.sort;
      case 'SORT_MASTER':
        return Icons.stars;
      case 'TREE_EXPLORER':
        return Icons.nature;
      case 'GRAPH_NAVIGATOR':
        return Icons.hub;
      case 'PROCESS_SCHEDULER':
        return Icons.schedule;
      case 'MEMORY_MANAGER':
        return Icons.memory;
      case 'TCP_EXPERT':
        return Icons.cable;
      case 'ROUTING_MASTER':
        return Icons.router;
      case 'FIRST_ML_EXPERIMENT':
        return Icons.science;
      case 'ML_RESEARCHER':
        return Icons.biotech;
      case 'FIRST_DAY':
        return Icons.flag;
      case 'WEEK_STREAK':
        return Icons.local_fire_department;
      case 'MONTH_STREAK':
        return Icons.whatshot;
      case 'NIGHT_OWL':
        return Icons.nights_stay;
      case 'EARLY_BIRD':
        return Icons.wb_sunny;
      case 'COMPLETIONIST':
        return Icons.workspace_premium;
      default:
        return Icons.emoji_events;
    }
  }
}
