// 操作系统模拟器主页面 - Academic Tech Dark 风格优化
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/widgets/common/glass_widgets.dart';

class OSMainScreen extends StatelessWidget {
  const OSMainScreen({Key? key}) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      body: Container(
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0.0, -0.2),
            radius: 1.5,
            colors: [
              Color(0xFF1E293B), // 深蓝背景
              Color(0xFF0F172A), // 更深的主题背景
            ],
          ),
        ),
        child: Column(
          children: [
            _buildAppBar(context),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // 标题部分
                    GlassCard(
                      child: Padding(
                        padding: const EdgeInsets.all(32),
                        child: Row(
                          children: [
                            Container(
                               padding: const EdgeInsets.all(16),
                               decoration: BoxDecoration(
                                  color: AppTheme.primary.withOpacity(0.1),
                                  shape: BoxShape.circle,
                                  border: Border.all(color: AppTheme.primary.withOpacity(0.5)),
                                  boxShadow: [
                                     BoxShadow(
                                        color: AppTheme.primary.withOpacity(0.2),
                                        blurRadius: 20,
                                        spreadRadius: 5,
                                     ),
                                  ],
                               ),
                               child: const Icon(Icons.computer, size: 48, color: AppTheme.primary),
                            ),
                            const SizedBox(width: 24),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    '操作系统核心算法可视化',
                                    style: AppTheme.darkTheme.textTheme.headlineMedium?.copyWith(
                                      fontWeight: FontWeight.bold,
                                      color: AppTheme.textPrimary,
                                      letterSpacing: 1.2,
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  Text(
                                    '深入理解操作系统的进程调度、内存管理和死锁处理机制',
                                    style: AppTheme.darkTheme.textTheme.bodyLarge?.copyWith(
                                      color: AppTheme.textSecondary,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 32),
                    
                    // 功能卡片
                    LayoutBuilder(
                      builder: (context, constraints) {
                        int crossAxisCount = 3;
                        double childAspectRatio = 1.0;
                        
                        if (constraints.maxWidth < 800) {
                          crossAxisCount = 1;
                          childAspectRatio = 1.8;
                        } else if (constraints.maxWidth < 1200) {
                          crossAxisCount = 2;
                          childAspectRatio = 1.1;
                        }
                        
                        return GridView.count(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          crossAxisCount: crossAxisCount,
                          crossAxisSpacing: 24,
                          mainAxisSpacing: 24,
                          childAspectRatio: childAspectRatio,
                          children: [
                            _buildFeatureCard(
                              context,
                              icon: Icons.schedule,
                              title: '进程调度',
                              subtitle: 'CPU调度算法模拟',
                              description: '可视化FCFS、SJF、Priority、RR等调度算法的执行过程',
                              features: ['甘特图动态展示', '性能指标对比', '就绪队列可视化', '上下文切换统计'],
                              color: AppTheme.primary,
                              route: '/os/scheduling',
                            ),
                             _buildFeatureCard(
                              context,
                              icon: Icons.memory,
                              title: '内存管理',
                              subtitle: '内存分配与页面置换',
                              description: '演示动态分区分配和页面置换算法的工作原理',
                              features: ['首次/最佳/最坏适应', 'FIFO/LRU/OPT置换', '内存碎片展示', '缺页率统计'],
                              color: AppTheme.secondary,
                              route: '/os/memory',
                            ),
                             _buildFeatureCard(
                              context,
                              icon: Icons.lock,
                              title: '死锁避免',
                              subtitle: '银行家算法模拟',
                              description: '通过银行家算法演示死锁的预防和避免策略',
                              features: ['安全性检查', '资源请求处理', '安全序列生成', '矩阵可视化'],
                              color: AppTheme.accent,
                              route: '/os/banker',
                            ),
                             _buildFeatureCard(
                                context,
                                icon: Icons.view_module,
                                title: '段页式管理',
                                subtitle: '逻辑地址转换',
                                description: '可视化段页式内存管理的地址转换过程',
                                features: ['段表/页表可视化', '逻辑转物理地址', 'TLB模拟', '访问权限检查'],
                                color: AppTheme.secondary,
                                route: '/os/segment-page', // 假设这是路由，如果不存在，需要用户确认或后续添加
                             ),
                          ],
                        );
                      },
                    ),
                    
                    const SizedBox(height: 32),
                    
                    // 学习提示
                    GlassCard(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Row(
                          children: [
                            Container(
                               padding: const EdgeInsets.all(12),
                               decoration: BoxDecoration(
                                  color: AppTheme.primary.withOpacity(0.1),
                                  shape: BoxShape.circle,
                               ),
                               child: const Icon(Icons.lightbulb_outline, color: AppTheme.primary),
                            ),
                            const SizedBox(width: 16),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    '学习建议',
                                    style: TextStyle(
                                      fontWeight: FontWeight.bold,
                                      color: AppTheme.primary,
                                      fontSize: 16,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  const Text(
                                    '建议按照进程调度 → 内存管理 → 段页式管理 → 死锁避免的顺序学习，每个模块都提供了详细的步骤展示和性能分析。',
                                    style: TextStyle(
                                      color: AppTheme.textSecondary,
                                      fontSize: 14,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildAppBar(BuildContext context) {
     return GlassContainer(
        height: 70,
        width: double.infinity,
        borderRadius: BorderRadius.zero,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(
           children: [
              IconButton(
                 icon: const Icon(Icons.arrow_back, color: AppTheme.textPrimary),
                 onPressed: () {
                    if (context.canPop()) {
                       context.pop();
                    } else {
                       context.go('/home');
                    }
                 },
                 tooltip: '返回',
              ),
              const Expanded(
                 child: Text(
                    '操作系统算法模拟器',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                       fontSize: 20,
                       fontWeight: FontWeight.bold,
                       color: AppTheme.textPrimary,
                       letterSpacing: 1.0,
                    ),
                 ),
              ),
              const SizedBox(width: 48), // 占位保持标题居中
           ],
        ),
     );
  }
  
  Widget _buildFeatureCard(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    required String description,
    required List<String> features,
    required Color color,
    required String route,
  }) {
    return Semantics(
      button: true,
      label: '$title，$description',
      child: Tooltip(
        message: subtitle,
        child: GlassCard(
          child: InkWell(
            onTap: () => context.go(route),
            borderRadius: BorderRadius.circular(16),
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(AppSpacing.md),
                        decoration: BoxDecoration(
                          color: color.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(AppRadii.md),
                          border: Border.all(color: color.withOpacity(0.3)),
                          boxShadow: [
                             BoxShadow(
                                color: color.withOpacity(0.1),
                                blurRadius: 10,
                             ),
                          ],
                        ),
                        child: Icon(icon, color: color, size: 32),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              title,
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 18,
                                color: AppTheme.textPrimary,
                              ),
                            ),
                            Text(
                              subtitle,
                              style: const TextStyle(
                                color: AppTheme.textSecondary,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Text(
                    description,
                    style: const TextStyle(
                       color: AppTheme.textSecondary,
                       height: 1.5,
                    ),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const Spacer(),
                  const Divider(color: AppTheme.borderSubtle),
                  const SizedBox(height: AppSpacing.sm),
                  
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.xs,
                    children: features.map((feature) {
                      return Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.check_circle_outline, size: 14, color: color.withOpacity(0.8)),
                          const SizedBox(width: AppSpacing.xs),
                          Text(
                            feature,
                            style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                          ),
                        ],
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  
                  Align(
                    alignment: Alignment.centerRight,
                    child: NeonButton(
                       onPressed: () => context.go(route),
                       text: '进入模拟',
                       icon: Icons.arrow_forward,
                       isPrimary: false,
                       borderColor: color,
                       textColor: color,
                       height: 36,
                       width: 120,
                       fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
