import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'dart:math' as math;
import 'package:go_router/go_router.dart';
import '../models/achievement_model.dart';
import '../models/learning_stats.dart' as stats;
import '../services/achievement_service.dart';
import 'package:ml_platform/utils/responsive_layout.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/widgets/common/glass_widgets.dart';
import 'package:ml_platform/widgets/common/responsive_container.dart';

/// 学习仪表盘界面 - Academic Tech Dark 风格
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({Key? key}) : super(key: key);

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen>
    with TickerProviderStateMixin {
  final AchievementService _achievementService = AchievementService();
  
  // 数据状态
  stats.LearningStats? _stats;
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
      debugPrint('Error loading dashboard data: $e');
      if (mounted) setState(() => _isLoading = false);
    }
  }

  // 辅助方法：获取成就图标
  IconData _getAchievementIcon(Achievement achievement) {
    // 简单映射，实际项目中可能需要更复杂的逻辑
    switch (achievement.category) {
      case 'algorithm': return Icons.code;
      case 'os': return Icons.memory;
      case 'ml': return Icons.psychology; // ML 相关
      default: return Icons.star;
    }
  }

  String _getStreakMessage(int days) {
    if (days >= 30) return '太棒了！';
    if (days >= 7) return '保持住！';
    return '加油！';
  }
  
  String _getModuleName(String key) {
    switch (key) {
      case 'algorithm': return '数据结构与算法';
      case 'os': return '操作系统';
      case 'ml': return '机器学习';
      default: return key;
    }
  }
  
  Color _getModuleColor(String key) {
    switch (key) {
      case 'algorithm': return AppTheme.primary;
      case 'os': return AppTheme.warning;
      case 'ml': return AppTheme.secondary;
      default: return AppTheme.textSecondary;
    }
  }
  
  IconData _getModuleIcon(String key) {
    switch (key) {
      case 'algorithm': return Icons.code;
      case 'os': return Icons.memory;
      case 'ml': return Icons.psychology;
      default: return Icons.folder;
    }
  }

  @override
  Widget build(BuildContext context) {
    // 内容构建方法
    Widget buildDashboardContent(bool isMobile) {
      return SingleChildScrollView(
        child: ResponsiveContainer(
          padding: const EdgeInsets.all(24),
          child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
             // 欢迎语 / 标题区域
            Text(
              'Welcome Back, Cadet.',
              style: Theme.of(context).textTheme.displaySmall?.copyWith(
                color: AppTheme.textPrimary.withOpacity(0.9),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'System Status: Online. Ready for training.',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: AppTheme.primary,
              ),
            ),
            const SizedBox(height: 32),

            // 用户统计卡片
            _buildStatsCards(isMobile: isMobile),
            const SizedBox(height: 32),
            
            // 学习活动热力图
            _buildActivityHeatmap(isMobile: isMobile),
            const SizedBox(height: 32),
            
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 左侧栏：模块进度 (在桌面端占 60%)
                Expanded(
                  flex: isMobile ? 1 : 3,
                  child: Column(
                    children: [
                      _buildModuleProgress(),
                      const SizedBox(height: 32),
                      _buildAchievementWall(),
                    ],
                  ),
                ),
                
                if (!isMobile) ...[
                  const SizedBox(width: 32),
                  // 右侧栏：排行榜 (在桌面端占 40%)
                  Expanded(
                    flex: 2,
                    child: _buildLeaderboard(),
                  ),
                ] else ...[
                   // 移动端垂直堆叠
                   const SizedBox(height: 32),
                   _buildLeaderboard(),
                ],
              ],
            ),
          ],
        ),
      ),
    );
    }
  
    return Scaffold(
      // 使用 AppTheme.background, 并在 body 中叠加渐变
      backgroundColor: AppTheme.background, 
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        title: const Text('Dashboard'), // 英文标题更具科技感
        centerTitle: true,
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: AppTheme.primary),
            onPressed: _loadData,
            tooltip: '刷新数据',
          ),
        ],
      ),
      body: Stack(
        children: [
          // 背景装饰：深空渐变
          Positioned.fill(
            child: Container(
              decoration: BoxDecoration(
                gradient: RadialGradient(
                  center: Alignment.topLeft,
                  radius: 1.5,
                  colors: [
                    AppTheme.surfaceHighlight.withOpacity(0.3),
                    AppTheme.background,
                  ],
                ),
              ),
            ),
          ),
          
          // 主内容
          SafeArea(
            child: _isLoading
              ? const Center(child: CircularProgressIndicator(color: AppTheme.primary))
              : FadeTransition(
                  opacity: _fadeAnimation,
                  child: ResponsiveLayout(
                    mobile: buildDashboardContent(true),
                    desktop: buildDashboardContent(false),
                  ),
                ),
          ),
        ],
      ),
    );
  }

  /// 构建统计卡片
  Widget _buildStatsCards({required bool isMobile}) {
    if (_stats == null) return const SizedBox();
    
    final cards = [
      _buildStatCard(
        icon: Icons.timer_outlined, // 使用 Outlined 图标更显极简
        title: 'Total Time',
        value: '${_stats!.totalTimeSpent ~/ 60}',
        unit: 'HRS',
        color: AppTheme.primary,
        subtitle: '${_stats!.totalTimeSpent % 60} MINS',
        isMobile: isMobile,
      ),
      if (isMobile) const SizedBox(height: 16) else const SizedBox(width: 16),
      
      _buildStatCard(
        icon: Icons.local_fire_department_outlined,
        title: 'Current Streak',
        value: '${_stats!.streakDays}',
        unit: 'DAYS',
        color: AppTheme.accent, // 绿色代表活跃
        subtitle: _getStreakMessage(_stats!.streakDays),
        isMobile: isMobile,
      ),
      if (isMobile) const SizedBox(height: 16) else const SizedBox(width: 16),
      
      _buildStatCard(
        icon: Icons.emoji_events_outlined,
        title: 'Total XP',
        value: '${_stats!.totalPoints}',
        unit: 'PTS',
        color: AppTheme.warning, // 金色/黄色
        subtitle: '${_stats!.unlockedAchievements.length} ACHIEVED',
        isMobile: isMobile,
      ),
    ];

    if (isMobile) {
      return Column(children: cards);
    }

    return Row(
      children: [
        Expanded(child: cards[0]),
        const SizedBox(width: 24),
        Expanded(child: cards[2]), // skipping visual spacers
        const SizedBox(width: 24),
        Expanded(child: cards[4]),
      ],
    );
  }

  /// 构建单个统计 GlassCard
  Widget _buildStatCard({
    required IconData icon,
    required String title,
    required String value,
    required String unit,
    required Color color,
    String? subtitle,
    required bool isMobile,
  }) {
    return GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              // Icon Container
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: color.withOpacity(0.3)),
                  boxShadow: [
                    BoxShadow(
                      color: color.withOpacity(0.2),
                      blurRadius: 8,
                      offset: const Offset(0, 0),
                    )
                  ],
                ),
                child: Icon(icon, color: color, size: 24),
              ),
              // Optional: Add a small trend indicator here if data available
            ],
          ),
          const SizedBox(height: 16),
          Text(
            title.toUpperCase(),
            style: TextStyle(
              fontSize: 12,
              letterSpacing: 1.2,
              color: AppTheme.textSecondary,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              // Neon Glowing Text
              Text(
                value,
                style: TextStyle(
                  fontSize: isMobile ? 32 : 36,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.textPrimary,
                  fontFamily: 'Exo 2', // 科技感字体
                  shadows: [
                    Shadow(
                      color: color.withOpacity(0.6),
                      blurRadius: 10,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              Text(
                unit,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  color: color.withOpacity(0.8),
                ),
              ),
            ],
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 8),
            Text(
              subtitle,
              style: TextStyle(
                fontSize: 12,
                color: AppTheme.textSecondary.withOpacity(0.7),
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// 构建学习活动热力图
  Widget _buildActivityHeatmap({required bool isMobile}) {
    if (_activityHeatmap == null) return const SizedBox();
    
    return GlassCard(
      title: 'Activity Log',
      icon: Icons.bar_chart,
      child: Column(
        children: [
          if (isMobile) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: SegmentedButton<int>(
                segments: const [
                  ButtonSegment(value: 7, label: Text('7 Days')),
                  ButtonSegment(value: 30, label: Text('30 Days')),
                ],
                selected: {_selectedDays},
                style: ButtonStyle(
                   backgroundColor: MaterialStateProperty.resolveWith((states) {
                     if (states.contains(MaterialState.selected)) {
                       return AppTheme.primary.withOpacity(0.2);
                     }
                     return Colors.transparent;
                   }),
                   side: MaterialStateProperty.all(BorderSide(color: AppTheme.glassBorder)),
                   foregroundColor: MaterialStateProperty.resolveWith((states) {
                      if (states.contains(MaterialState.selected)) return AppTheme.primary;
                      return AppTheme.textSecondary;
                   }),
                ),
                onSelectionChanged: (Set<int> selection) {
                  setState(() {
                    _selectedDays = selection.first;
                  });
                  _loadData();
                },
              ),
            ),
          ] else
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                SegmentedButton<int>(
                  segments: const [
                    ButtonSegment(value: 7, label: Text('7 Days')),
                    ButtonSegment(value: 30, label: Text('30 Days')),
                    ButtonSegment(value: 90, label: Text('90 Days')),
                  ],
                  selected: {_selectedDays},
                  style: ButtonStyle(
                     backgroundColor: MaterialStateProperty.resolveWith((states) {
                       if (states.contains(MaterialState.selected)) {
                         return AppTheme.primary.withOpacity(0.2);
                       }
                       return Colors.transparent;
                     }),
                     side: MaterialStateProperty.all(BorderSide(color: AppTheme.glassBorder)),
                     foregroundColor: MaterialStateProperty.resolveWith((states) {
                        if (states.contains(MaterialState.selected)) return AppTheme.primary;
                        return AppTheme.textSecondary;
                     }),
                  ),
                  onSelectionChanged: (Set<int> selection) {
                    setState(() {
                       _selectedDays = selection.first;
                    });
                    _loadData();
                  },
                ),
              ],
            ),
          const SizedBox(height: 24),
          SizedBox(
            height: 220,
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
          'No activity recorded.',
          style: TextStyle(color: AppTheme.textSecondary),
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
              color: AppTheme.glassBorder, // 半透明网格线
              strokeWidth: 1,
            );
          },
          getDrawingVerticalLine: (value) {
            return FlLine(
              color: AppTheme.glassBorder,
              strokeWidth: 1,
            );
          },
        ),
        titlesData: FlTitlesData(
          show: true,
          rightTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
          topTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
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
                return Padding(
                  padding: const EdgeInsets.only(top: 8.0),
                  child: Text(
                    '${date.month}/${date.day}',
                    style: TextStyle(fontSize: 10, color: AppTheme.textSecondary),
                  ),
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
                  style: TextStyle(fontSize: 10, color: AppTheme.textSecondary),
                );
              },
            ),
          ),
        ),
        borderData: FlBorderData(show: false), // 去除边框
        minX: 0,
        maxX: (_selectedDays - 1).toDouble(),
        minY: 0,
        maxY: spots.map((s) => s.y).reduce(math.max) + 10,
        lineBarsData: [
          LineChartBarData(
            spots: spots,
            isCurved: true,
            curveSmoothness: 0.35,
            gradient: const LinearGradient(
              colors: [AppTheme.primary, AppTheme.secondary], // Cyan to Purple
            ),
            barWidth: 3,
            isStrokeCapRound: true,
            belowBarData: BarAreaData(
              show: true,
              gradient: LinearGradient(
                colors: [
                  AppTheme.primary.withOpacity(0.3),
                  AppTheme.secondary.withOpacity(0.0),
                ],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
            ),
            dotData: FlDotData(
              show: true,
              getDotPainter: (spot, percent, barData, index) {
                return FlDotCirclePainter(
                  radius: 3,
                  color: AppTheme.background,
                  strokeWidth: 2,
                  strokeColor: AppTheme.primary,
                );
              },
            ),
          ),
        ],
        lineTouchData: LineTouchData(
           getTouchedSpotIndicator: (LineChartBarData barData, List<int> spotIndexes) {
             return spotIndexes.map((spotIndex) {
               return TouchedSpotIndicatorData(
                 FlLine(color: AppTheme.primary, strokeWidth: 1, dashArray: [4, 4]),
                 FlDotData(show: true),
               );
             }).toList();
           },
           touchTooltipData: LineTouchTooltipData(
             getTooltipColor: (LineBarSpot spot) => AppTheme.surface.withOpacity(0.9),
             tooltipBorderRadius: BorderRadius.circular(8),
             getTooltipItems: (List<LineBarSpot> touchedBarSpots) {
               return touchedBarSpots.map((barSpot) {
                 return LineTooltipItem(
                   '${barSpot.y.toInt()} mins',
                   const TextStyle(
                     color: AppTheme.primary,
                     fontWeight: FontWeight.bold,
                   ),
                 );
               }).toList();
             },
           ),
        ),
      ),
    );
  }

  /// 构建模块进度
  Widget _buildModuleProgress() {
    if (_moduleProgress == null) return const SizedBox();
    
    return GlassCard(
      title: 'Training Modules',
      icon: Icons.folder_special,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
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
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color.withOpacity(0.8), size: 16),
              const SizedBox(width: 8),
              Expanded(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    Text(
                      '${(progress * 100).toInt()}%',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: color,
                        shadows: [
                          Shadow(color: color.withOpacity(0.5), blurRadius: 4),
                        ]
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          // 玻璃质感进度条槽
          Container(
            height: 6,
            decoration: BoxDecoration(
              color: AppTheme.textPrimary.withOpacity(0.05),
              borderRadius: BorderRadius.circular(3),
            ),
            child: Stack(
              children: [
                FractionallySizedBox(
                  widthFactor: progress,
                  child: Container(
                    decoration: BoxDecoration(
                      color: color,
                      borderRadius: BorderRadius.circular(3),
                      boxShadow: [
                         BoxShadow(
                           color: color.withOpacity(0.5),
                           blurRadius: 6,
                           spreadRadius: 1,
                         ),
                      ],
                    ),
                  ),
                ),
              ],
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
    
    return GlassCard(
      title: 'Achievement Wall',
      icon: Icons.workspace_premium, // 奖章图标
      iconColor: AppTheme.warning,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
           // 进度概览
           Row(
             mainAxisAlignment: MainAxisAlignment.spaceBetween,
             children: [
               Text(
                 'Unlocked',
                 style: TextStyle(color: AppTheme.textSecondary),
               ),
               Text(
                 '${_achievements!.where((a) => a.isUnlocked).length}/${_achievements!.length}',
                 style: const TextStyle(
                   color: AppTheme.textPrimary, 
                   fontWeight: FontWeight.bold
                 ),
               ),
             ],
           ),
           const SizedBox(height: 16),
           
           ...groupedAchievements.entries.map((entry) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text(
                    AchievementCategory.getCategoryName(entry.key).toUpperCase(),
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 1.0,
                      color: AchievementCategory.getCategoryColor(entry.key),
                    ),
                  ),
                ),
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

  /// 构建成就徽章 - Glass Style
  Widget _buildAchievementBadge(Achievement achievement) {
    final isUnlocked = achievement.isUnlocked;
    final color = AchievementCategory.getCategoryColor(achievement.category);
    
    return Tooltip(
      message: '${achievement.name}\n${achievement.description}\n+${achievement.points} XP',
      decoration: BoxDecoration(
        color: AppTheme.surface.withOpacity(0.95),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppTheme.glassBorder),
      ),
      textStyle: TextStyle(color: AppTheme.textPrimary),
      child: Container(
        width: 56,
        height: 56,
        decoration: BoxDecoration(
          color: isUnlocked
              ? color.withOpacity(0.15)
              : AppTheme.textPrimary.withOpacity(0.02),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isUnlocked
                ? color.withOpacity(0.6)
                : AppTheme.textPrimary.withOpacity(0.05),
            width: 1.5,
          ),
          boxShadow: isUnlocked ? [
            BoxShadow(
              color: color.withOpacity(0.3),
              blurRadius: 8,
              offset: const Offset(0, 2),
            )
          ] : [],
        ),
        child: Stack(
          alignment: Alignment.center,
          children: [
            Icon(
              _getAchievementIcon(achievement),
              size: 26,
              color: isUnlocked
                  ? color
                  : AppTheme.textPrimary.withOpacity(0.2),
            ),
            if (!isUnlocked)
              Icon(
                Icons.lock_outline,
                size: 16,
                color: AppTheme.textPrimary.withOpacity(0.4),
              ),
              
            // 进度条（针对未解锁但有进度的）
            if (achievement.progressPercentage > 0 && !isUnlocked)
              Positioned(
                bottom: 4,
                left: 4,
                right: 4,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(2),
                  child: LinearProgressIndicator(
                    value: achievement.progressPercentage,
                    backgroundColor: AppTheme.textPrimary.withOpacity(0.1),
                    valueColor: AlwaysStoppedAnimation(color.withOpacity(0.5)),
                    minHeight: 2,
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
    
    return GlassCard(
      title: 'Global Rankings',
      icon: Icons.public,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
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
    Color rankColor = AppTheme.textSecondary;
    IconData? rankIcon;
    
    if (rank == 1) {
      rankColor = const Color(0xFFFFD700); // Gold
      rankIcon = Icons.emoji_events;
    } else if (rank == 2) {
      rankColor = const Color(0xFFC0C0C0); // Silver
    } else if (rank == 3) {
      rankColor = const Color(0xFFCD7F32); // Bronze
    }
    
    final isTop3 = rank <= 3;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: isTop3 ? rankColor.withOpacity(0.1) : Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        border: isTop3 ? Border.all(color: rankColor.withOpacity(0.2)) : null,
      ),
      child: Row(
        children: [
          SizedBox(
            width: 32,
            child: rankIcon != null 
              ? Icon(rankIcon, color: rankColor, size: 20)
              : Text(
                  '#$rank',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: rankColor,
                    fontFamily: 'Exo 2',
                  ),
                ),
          ),
          CircleAvatar(
             backgroundColor: AppTheme.surfaceHighlight,
             radius: 16,
             child: Text(
               (user['username'] as String)[0].toUpperCase(),
               style: const TextStyle(
                 fontWeight: FontWeight.bold,
                 fontSize: 12,
                 color: AppTheme.textPrimary,
               ),
             ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              user['username'],
              style: TextStyle(
                fontWeight: isTop3 ? FontWeight.bold : FontWeight.w500,
                color: isTop3 ? AppTheme.textPrimary : AppTheme.textSecondary,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Text(
            '${user['points']} XP',
            style: TextStyle(
              fontWeight: FontWeight.bold,
              color: AppTheme.primary,
              fontFamily: 'Fira Code', // 代码字体显示数字
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}
