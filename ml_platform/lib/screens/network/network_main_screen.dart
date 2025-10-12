import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// 网络协议模拟器主界面
class NetworkMainScreen extends StatelessWidget {
  const NetworkMainScreen({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
          tooltip: '返回',
        ),
        title: const Text('计算机网络协议模拟器'),
        centerTitle: true,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
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
                    Colors.indigo,
                    Colors.indigo.shade700,
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: Colors.indigo.withOpacity(0.3),
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
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Icon(
                          Icons.lan,
                          color: Colors.white,
                          size: 32,
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              '网络协议可视化',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 24,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '深入理解网络协议的工作原理',
                              style: TextStyle(
                                color: Colors.white.withOpacity(0.9),
                                fontSize: 14,
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
            
            // 传输层协议
            _buildSectionTitle(context, '传输层协议', Icons.swap_horiz),
            const SizedBox(height: 16),
            _buildProtocolCard(
              context,
              title: 'TCP连接管理',
              subtitle: '三次握手、四次挥手、数据传输',
              icon: Icons.handshake,
              color: Colors.blue,
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
              color: Colors.orange,
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
              color: Colors.green,
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
              color: Colors.purple,
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
              color: Colors.teal,
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
              color: Colors.indigo,
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
    );
  }

  /// 构建章节标题
  Widget _buildSectionTitle(BuildContext context, String title, IconData icon) {
    return Row(
      children: [
        Icon(icon, color: Theme.of(context).primaryColor, size: 24),
        const SizedBox(width: 8),
        Text(
          title,
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
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
    return Card(
      elevation: 2,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: color.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(
                      icon,
                      color: color,
                      size: 32,
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              title,
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            if (isComingSoon) ...[
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.orange.withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(
                                    color: Colors.orange,
                                    width: 1,
                                  ),
                                ),
                                child: const Text(
                                  '开发中',
                                  style: TextStyle(
                                    color: Colors.orange,
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          subtitle,
                          style: TextStyle(
                            fontSize: 14,
                            color: Colors.grey[600],
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    Icons.arrow_forward_ios,
                    color: Colors.grey[400],
                    size: 20,
                  ),
                ],
              ),
              const SizedBox(height: 16),
              // 特性列表
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: features.map((feature) {
                  return Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.grey[100],
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Text(
                      feature,
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.grey[700],
                      ),
                    ),
                  );
                }).toList(),
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
