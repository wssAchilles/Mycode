import 'package:flutter/material.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/utils/responsive_layout.dart';
import 'package:ml_platform/widgets/common/glass_widgets.dart';

import 'arp_simulation_screen.dart';
import 'http_protocol_screen.dart';
import 'ip_routing_screen.dart';
import 'tcp_connection_screen.dart';
import 'tcp_flow_control_screen.dart';
import 'topology_design_screen.dart';

class NetworkProtocolsScreen extends StatelessWidget {
  const NetworkProtocolsScreen({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('网络协议实验室'),
        centerTitle: true,
      ),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final double width = constraints.maxWidth;
          final int columns = width >= 1100
              ? 3
              : width >= 700
                  ? 2
                  : 1;
          final double cardRatio = width >= 1100 ? 1.5 : 1.25;

          return SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '协议可视化与仿真',
                  style: textTheme.displaySmall,
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  '从链路层到应用层，选择一个实验开始交互式学习。',
                  style: textTheme.bodyMedium?.copyWith(
                    color: AppTheme.textSecondary,
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: columns,
                    crossAxisSpacing: AppSpacing.md,
                    mainAxisSpacing: AppSpacing.md,
                    childAspectRatio: cardRatio,
                  ),
                  itemCount: _protocolCards.length,
                  itemBuilder: (context, index) {
                    final card = _protocolCards[index];
                    return Semantics(
                      button: true,
                      label: card.title,
                      child: Tooltip(
                        message: card.subtitle,
                        child: GlassCard(
                          title: card.title,
                          icon: card.icon,
                          iconColor: card.accent,
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => card.screen),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                card.subtitle,
                                style: textTheme.bodyMedium?.copyWith(
                                  color: AppTheme.textSecondary,
                                ),
                              ),
                              const SizedBox(height: AppSpacing.md),
                              Wrap(
                                spacing: AppSpacing.sm,
                                runSpacing: AppSpacing.xs,
                                children: card.tags
                                    .map((tag) => Chip(
                                          label: Text(tag),
                                          labelStyle: textTheme.labelLarge?.copyWith(
                                            color: AppTheme.textPrimary,
                                          ),
                                          backgroundColor: AppTheme.surfaceHighlight,
                                          side: const BorderSide(color: AppTheme.borderSubtle),
                                        ))
                                    .toList(),
                              ),
                              const Spacer(),
                              Row(
                                children: [
                                  Text(
                                    '进入实验',
                                    style: textTheme.labelLarge?.copyWith(
                                      color: card.accent,
                                    ),
                                  ),
                                  const SizedBox(width: AppSpacing.xs),
                                  Icon(Icons.arrow_forward, size: 16, color: card.accent),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                ),
                if (ResponsiveLayout.isMobile(context))
                  const SizedBox(height: AppSpacing.xl),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _ProtocolCardData {
  final String title;
  final String subtitle;
  final IconData icon;
  final Color accent;
  final List<String> tags;
  final Widget screen;

  const _ProtocolCardData({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.accent,
    required this.tags,
    required this.screen,
  });
}

const List<_ProtocolCardData> _protocolCards = [
  _ProtocolCardData(
    title: '网络拓扑设计',
    subtitle: '拖拽式构建拓扑并进行链路仿真。',
    icon: Icons.hub_outlined,
    accent: AppTheme.primary,
    tags: ['拓扑', '可视化', '拖拽'],
    screen: TopologyDesignScreen(),
  ),
  _ProtocolCardData(
    title: 'TCP 连接管理',
    subtitle: '三次握手与四次挥手的逐步演示。',
    icon: Icons.compare_arrows,
    accent: AppTheme.secondary,
    tags: ['传输层', '连接', '状态机'],
    screen: TcpConnectionScreen(),
  ),
  _ProtocolCardData(
    title: 'TCP 流量控制',
    subtitle: '窗口滑动、丢包与重传可视化。',
    icon: Icons.tune,
    accent: AppTheme.success,
    tags: ['拥塞', '窗口', '仿真'],
    screen: TcpFlowControlScreen(),
  ),
  _ProtocolCardData(
    title: 'HTTP 协议',
    subtitle: '请求响应模型与缓存策略交互。',
    icon: Icons.http,
    accent: AppTheme.info,
    tags: ['应用层', 'REST', '缓存'],
    screen: HttpProtocolScreen(),
  ),
  _ProtocolCardData(
    title: 'ARP 地址解析',
    subtitle: '从广播到缓存的全过程演示。',
    icon: Icons.wifi_tethering,
    accent: AppTheme.warning,
    tags: ['链路层', '广播', '缓存'],
    screen: ArpSimulationScreen(),
  ),
  _ProtocolCardData(
    title: 'IP 路由转发',
    subtitle: '路由表与转发表实时更新。',
    icon: Icons.route,
    accent: AppTheme.accent,
    tags: ['网络层', '路由', '算法'],
    screen: IpRoutingScreen(),
  ),
];
