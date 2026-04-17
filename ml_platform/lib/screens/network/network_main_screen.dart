import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/widgets/common/glass_widgets.dart';
import 'package:ml_platform/widgets/common/responsive_container.dart';

/// 网络协议模拟器主界面
class NetworkMainScreen extends StatelessWidget {
  const NetworkMainScreen({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/home'),
          tooltip: '返回',
        ),
        title: const Text('计算机网络协议模拟器'),
        centerTitle: true,
      ),
      body: SingleChildScrollView(
        child: ResponsiveContainer(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 标题横幅
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      AppTheme.primary.withOpacity(0.9),
                      AppTheme.secondary.withOpacity(0.85),
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: [
                    BoxShadow(
                      color: AppTheme.primary.withOpacity(0.3),
                      blurRadius: 14,
                      offset: const Offset(0, 6),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppTheme.textPrimary.withOpacity(0.18),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: AppTheme.textPrimary.withOpacity(0.25),
                            ),
                          ),
                          child: const Icon(
                            Icons.lan,
                            color: AppTheme.textPrimary,
                            size: 32,
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '网络协议可视化',
                                style: Theme.of(context)
                                    .textTheme
                                    .headlineMedium
                                    ?.copyWith(
                                      color: AppTheme.textPrimary,
                                      fontWeight: FontWeight.w700,
                                    ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                '深入理解网络协议的工作原理',
                                style: Theme.of(context)
                                    .textTheme
                                    .bodyMedium
                                    ?.copyWith(
                                      color: AppTheme.textPrimary.withOpacity(0.9),
                                    ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              // 新功能：拓扑设计 (New Feature)
              _buildSectionTitle(context, '网络拓扑实验室 (新功能)', Icons.science),
              const SizedBox(height: 16),
              _buildProtocolCard(
                context,
                title: '网络拓扑设计器',
                subtitle: '自由构建网络拓扑，仿真 IP 路由与 ARP',
                icon: Icons.hub,
                color: AppTheme.error,
                features: [
                  '拖拽构建拓扑',
                  '自定义设备连线',
                  '真实 ARP 模拟',
                  'IP 路由仿真引擎',
                ],
                onTap: () => context.push('/network/topology-design'),
              ),
              const SizedBox(height: 24),

              // 传输层协议
              _buildSectionTitle(context, '传输层协议', Icons.swap_horiz),
              const SizedBox(height: 16),
              _buildProtocolCard(
                context,
                title: 'TCP连接管理',
                subtitle: '三次握手、四次挥手、数据传输',
                icon: Icons.handshake,
                color: AppTheme.primary,
                features: [
                  '三次握手建立连接',
                  '四次挥手断开连接',
                  '状态机转换可视化',
                  '数据包传输动画',
                ],
                onTap: () => context.go('/network/tcp'),
              ),
              const SizedBox(height: 16),
              _buildProtocolCard(
                context,
                title: 'TCP流量控制',
                subtitle: '滑动窗口、拥塞控制',
                icon: Icons.speed,
                color: AppTheme.warning,
                features: [
                  '滑动窗口机制',
                  '慢启动算法',
                  '拥塞避免',
                  'Nagle算法',
                ],
                isComingSoon: false,
                onTap: () => context.go('/network/tcp-flow-control'),
              ),
              const SizedBox(height: 24),

              // 网络层协议
              _buildSectionTitle(context, '网络层协议', Icons.router),
              const SizedBox(height: 16),
              _buildProtocolCard(
                context,
                title: 'IP数据包路由',
                subtitle: '路由表查询、TTL、数据包转发',
                icon: Icons.alt_route,
                color: AppTheme.success,
                features: [
                  '路由表查询过程',
                  'TTL递减机制',
                  'ICMP错误报文',
                  '数据包封装/解封装',
                ],
                isComingSoon: false,
                onTap: () => context.go('/network/ip-routing'),
              ),
              const SizedBox(height: 16),
              _buildProtocolCard(
                context,
                title: 'ARP协议',
                subtitle: '地址解析协议',
                icon: Icons.search,
                color: AppTheme.secondary,
                features: [
                  'ARP请求/应答',
                  'ARP缓存表',
                  '广播机制',
                  'MAC地址解析',
                ],
                isComingSoon: false,
                onTap: () => context.go('/network/arp'),
              ),
              const SizedBox(height: 24),

              // 应用层协议
              _buildSectionTitle(context, '应用层协议', Icons.apps),
              const SizedBox(height: 16),
              _buildProtocolCard(
                context,
                title: 'HTTP协议',
                subtitle: '请求/响应、状态码、缓存',
                icon: Icons.public,
                color: AppTheme.info,
                features: [
                  'HTTP请求方法',
                  '状态码详解',
                  '请求/响应头',
                  'Cookie机制',
                ],
                isComingSoon: false,
                onTap: () => context.go('/network/http'),
              ),
              const SizedBox(height: 16),
              _buildProtocolCard(
                context,
                title: 'DNS协议',
                subtitle: '域名解析过程',
                icon: Icons.dns,
                color: AppTheme.primaryDark,
                features: [
                  '递归查询',
                  '迭代查询',
                  'DNS缓存',
                  '域名层级结构',
                ],
                isComingSoon: true,
                onTap: () => _showComingSoon(context),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// 构建章节标题
  Widget _buildSectionTitle(BuildContext context, String title, IconData icon) {
    return Row(
      children: [
        Icon(icon, color: AppTheme.primary, size: 24),
        const SizedBox(width: 8),
        Text(
          title,
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w700,
              ),
        ),
      ],
    );
  }

  /// 构建协议卡片
  Widget _buildProtocolCard(
    BuildContext context, {
    required String title,
    required String subtitle,
    required IconData icon,
    required Color color,
    required List<String> features,
    required VoidCallback onTap,
    bool isComingSoon = false,
  }) {
    final textTheme = Theme.of(context).textTheme;

    return Semantics(
      button: true,
      label: title,
      child: Tooltip(
        message: subtitle,
        child: GlassCard(
          onTap: onTap,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: color.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: color.withOpacity(0.35)),
                    ),
                    child: Icon(
                      icon,
                      color: color,
                      size: 30,
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                title,
                                style: textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.w700,
                                  color: AppTheme.textPrimary,
                                ),
                              ),
                            ),
                            if (isComingSoon) ...[
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 10,
                                  vertical: 4,
                                ),
                                decoration: BoxDecoration(
                                  color: AppTheme.warning.withOpacity(0.12),
                                  borderRadius: BorderRadius.circular(999),
                                  border: Border.all(
                                    color: AppTheme.warning.withOpacity(0.5),
                                  ),
                                ),
                                child: Text(
                                  '开发中',
                                  style: textTheme.labelSmall?.copyWith(
                                    color: AppTheme.warning,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(
                          subtitle,
                          style: textTheme.bodySmall?.copyWith(
                            color: AppTheme.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    Icons.arrow_forward_ios,
                    color: AppTheme.textSecondary.withOpacity(0.7),
                    size: 18,
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: features
                    .map((feature) => Chip(
                          label: Text(feature),
                          labelStyle: textTheme.labelSmall?.copyWith(
                            color: AppTheme.textPrimary,
                            fontWeight: FontWeight.w600,
                          ),
                          backgroundColor: AppTheme.surfaceHighlight,
                          side: const BorderSide(color: AppTheme.borderSubtle),
                        ))
                    .toList(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// 显示即将推出提示
  void _showComingSoon(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('该功能正在开发中，敬请期待！'),
        duration: Duration(seconds: 2),
      ),
    );
  }
}
