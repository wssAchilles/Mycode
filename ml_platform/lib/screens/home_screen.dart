// 主页
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ml_platform/services/firebase_service.dart';
import 'package:ml_platform/utils/responsive_layout.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/widgets/common/glass_widgets.dart';
import 'package:ml_platform/widgets/common/responsive_container.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final user = FirebaseService().currentUser;
    return Scaffold(
      appBar: AppBar(
        title: const Text('算法可视化学习平台'),
        actions: [
          // AI 学习助手按钮
          IconButton(
            icon: const Icon(Icons.chat_bubble_outline),
            onPressed: () => context.go('/ai-chat'),
            tooltip: 'AI 学习助手',
          ),
          IconButton(
            icon: const Icon(Icons.person_outline),
            onPressed: () => context.go('/home/profile'),
            tooltip: '个人中心',
          ),
        ],
      ),
      body: ResponsiveLayout(
        mobile: _buildContent(context, user, theme, crossAxisCount: 1),
        tablet: _buildContent(context, user, theme, crossAxisCount: 2),
        desktop: _buildContent(context, user, theme, crossAxisCount: 3),
      ),
    );
  }

  Widget _buildContent(
    BuildContext context, 
    dynamic user, 
    ThemeData theme, 
    {required int crossAxisCount}
  ) {
    return SingleChildScrollView(
      child: ResponsiveContainer(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
          // 欢迎卡片
          GlassContainer(
            borderRadius: BorderRadius.circular(AppRadii.lg),
            padding: const EdgeInsets.all(AppSpacing.lg),
            gradientColors: [
              AppTheme.primary.withOpacity(0.45),
              AppTheme.secondary.withOpacity(0.35),
            ],
            child: Container(
              width: double.infinity,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(AppRadii.lg),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '欢迎回来，${user?.displayName ?? '学习者'}！',
                    style: theme.textTheme.headlineSmall?.copyWith(
                      color: AppTheme.textPrimary,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '今天想学习什么算法呢？',
                    style: theme.textTheme.bodyLarge?.copyWith(
                      color: AppTheme.textPrimary.withOpacity(0.9),
                    ),
                  ),
                ],
              ),
            ),
          ),
          
          const SizedBox(height: AppSpacing.lg),
          
          // 功能模块标题
          Text(
            '学习模块',
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 16),
          
          // 功能卡片网格
          GridView.count(
            crossAxisCount: crossAxisCount,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisSpacing: AppSpacing.md,
            mainAxisSpacing: AppSpacing.md,
            childAspectRatio: 1.5,
            children: [
              _buildFeatureCard(
                context,
                icon: Icons.sort,
                title: '排序算法',
                description: '可视化各种排序算法的执行过程',
                color: AppTheme.primary,
                onTap: () => context.go('/sorting'),
              ),
              _buildFeatureCard(
                context,
                icon: Icons.account_tree,
                title: '数据结构',
                description: '学习和理解基础数据结构的操作',
                color: AppTheme.success,
                onTap: () => context.go('/data-structures'),
              ),
              _buildFeatureCard(
                context,
                icon: Icons.computer,
                title: '操作系统',
                description: '模拟操作系统核心算法',
                color: AppTheme.secondary,
                onTap: () => context.go('/os'),
              ),
              _buildFeatureCard(
                context,
                title: '网络协议',
                description: '可视化网络协议工作原理',
                icon: Icons.lan,
                color: AppTheme.primaryDark,
                isComingSoon: false,
                onTap: () => context.go('/network'),
              ),
              _buildFeatureCard(
                context,
                title: '机器学习',
                description: '训练模型，可视化结果',
                icon: Icons.psychology,
                color: AppTheme.warning,
                isComingSoon: false,
                onTap: () => context.go('/ml'),
              ),
              _buildFeatureCard(
                context,
                title: 'AI 学习助手',
                description: 'AI 辅助解答算法问题',
                icon: Icons.smart_toy,
                color: AppTheme.info,
                isComingSoon: false,
                onTap: () => context.go('/ai-chat'),
              ),
            ],
          ),
          
          const SizedBox(height: AppSpacing.lg),
          
          // 学习统计
          Text(
            '学习统计',
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          
          // 统计卡片 (响应式调整)
           crossAxisCount == 1 
            ? Column(
                children: [
                  _buildStatCard(context, title: '学习时长', value: '0', unit: '小时', icon: Icons.timer, color: AppTheme.primary),
                  const SizedBox(height: AppSpacing.sm),
                  _buildStatCard(context, title: '完成算法', value: '0', unit: '个', icon: Icons.check_circle, color: AppTheme.success),
                  const SizedBox(height: AppSpacing.sm),
                  _buildStatCard(context, title: '练习次数', value: '0', unit: '次', icon: Icons.refresh, color: AppTheme.warning),
                ],
              )
            : Row(
              children: [
                Expanded(
                  child: _buildStatCard(
                    context,
                    title: '学习时长',
                    value: '0',
                    unit: '小时',
                    icon: Icons.timer,
                    color: AppTheme.primary,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: _buildStatCard(
                    context,
                    title: '完成算法',
                    value: '0',
                    unit: '个',
                    icon: Icons.check_circle,
                    color: AppTheme.success,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: _buildStatCard(
                    context,
                    title: '练习次数',
                    value: '0',
                    unit: '次',
                    icon: Icons.refresh,
                    color: AppTheme.warning,
                  ),
                ),
              ],
            ),
        ],
      ),
      ),
    );
  }



  Widget _buildFeatureCard(
    BuildContext context, {
    required String title,
    required String description,
    required IconData icon,
    required Color color,
    required VoidCallback onTap,
    bool isComingSoon = false,
  }) {
    final theme = Theme.of(context);
    
    return Semantics(
      button: true,
      label: '$title，$description',
      child: Tooltip(
        message: description,
        child: GlassCard(
          onTap: onTap,
          child: Row(
            children: [
              Container(
                width: 60,
                height: 60,
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  icon,
                  size: 32,
                  color: color,
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          title,
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        if (isComingSoon) ...[
                          const SizedBox(width: AppSpacing.xs),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: AppTheme.surfaceHighlight,
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              '即将推出',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: AppTheme.textSecondary,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      description,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: AppTheme.textSecondary,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.arrow_forward_ios,
                size: 16,
                color: AppTheme.textSecondary,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatCard(
    BuildContext context, {
    required String title,
    required String value,
    required String unit,
    required IconData icon,
    required Color color,
  }) {
    final theme = Theme.of(context);
    
    return GlassContainer(
      padding: const EdgeInsets.all(AppSpacing.md),
      borderRadius: BorderRadius.circular(AppRadii.md),
      child: Column(
        children: [
          Icon(
            icon,
            size: 24,
            color: color,
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            value,
            style: theme.textTheme.headlineMedium?.copyWith(
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
          Text(
            unit,
            style: theme.textTheme.bodySmall?.copyWith(
              color: AppTheme.textSecondary,
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            title,
            style: theme.textTheme.labelMedium,
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

}
