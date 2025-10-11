// 个人资料页面
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ml_platform/services/firebase_service.dart';
import 'package:ml_platform/widgets/common/custom_button.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final user = FirebaseService().currentUser;

    return Scaffold(
      appBar: AppBar(
        title: const Text('个人中心'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/home'),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          children: [
            // 用户头像和基本信息
            Center(
              child: Column(
                children: [
                  // 头像
                  Container(
                    width: 100,
                    height: 100,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: theme.primaryColor.withOpacity(0.1),
                      border: Border.all(
                        color: theme.primaryColor,
                        width: 3,
                      ),
                    ),
                    child: Center(
                      child: Text(
                        (user?.displayName?.isNotEmpty == true
                                ? user!.displayName![0]
                                : user?.email?[0] ?? 'U')
                            .toUpperCase(),
                        style: theme.textTheme.headlineLarge?.copyWith(
                          color: theme.primaryColor,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  // 用户名
                  Text(
                    user?.displayName ?? '学习者',
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 4),
                  // 邮箱
                  Text(
                    user?.email ?? '',
                    style: theme.textTheme.bodyLarge?.copyWith(
                      color: Colors.grey[600],
                    ),
                  ),
                  const SizedBox(height: 8),
                  // 加入时间
                  if (user?.metadata.creationTime != null)
                    Text(
                      '加入时间: ${_formatDate(user!.metadata.creationTime!)}',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: Colors.grey[500],
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 32),

            // 学习统计卡片
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '学习统计',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        _buildStatItem(
                          context,
                          icon: Icons.timer,
                          label: '学习时长',
                          value: '0',
                          unit: '小时',
                          color: Colors.blue,
                        ),
                        _buildStatItem(
                          context,
                          icon: Icons.check_circle,
                          label: '完成算法',
                          value: '0',
                          unit: '个',
                          color: Colors.green,
                        ),
                        _buildStatItem(
                          context,
                          icon: Icons.trending_up,
                          label: '连续学习',
                          value: '0',
                          unit: '天',
                          color: Colors.orange,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // 设置选项
            Card(
              child: Column(
                children: [
                  _buildSettingItem(
                    context,
                    icon: Icons.person_outline,
                    title: '编辑资料',
                    onTap: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('编辑资料功能即将推出')),
                      );
                    },
                  ),
                  const Divider(height: 1),
                  _buildSettingItem(
                    context,
                    icon: Icons.notifications_outlined,
                    title: '通知设置',
                    onTap: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('通知设置功能即将推出')),
                      );
                    },
                  ),
                  const Divider(height: 1),
                  _buildSettingItem(
                    context,
                    icon: Icons.security_outlined,
                    title: '账号安全',
                    onTap: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('账号安全功能即将推出')),
                      );
                    },
                  ),
                  const Divider(height: 1),
                  _buildSettingItem(
                    context,
                    icon: Icons.help_outline,
                    title: '帮助与反馈',
                    onTap: () {
                      _showHelpDialog(context);
                    },
                  ),
                  const Divider(height: 1),
                  _buildSettingItem(
                    context,
                    icon: Icons.info_outline,
                    title: '关于我们',
                    onTap: () {
                      _showAboutDialog(context);
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // 退出登录按钮
            CustomButton(
              text: '退出登录',
              width: double.infinity,
              isOutlined: true,
              icon: Icons.logout,
              onPressed: () async {
                // 显示确认对话框
                final shouldLogout = await showDialog<bool>(
                  context: context,
                  builder: (context) => AlertDialog(
                    title: const Text('退出登录'),
                    content: const Text('确定要退出登录吗？'),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.of(context).pop(false),
                        child: const Text('取消'),
                      ),
                      ElevatedButton(
                        onPressed: () => Navigator.of(context).pop(true),
                        child: const Text('确定'),
                      ),
                    ],
                  ),
                );

                if (shouldLogout == true) {
                  await FirebaseService().logout();
                  if (context.mounted) {
                    context.go('/login');
                  }
                }
              },
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _buildStatItem(
    BuildContext context, {
    required IconData icon,
    required String label,
    required String value,
    required String unit,
    required Color color,
  }) {
    final theme = Theme.of(context);

    return Column(
      children: [
        Icon(icon, size: 32, color: color),
        const SizedBox(height: 8),
        Text(
          value,
          style: theme.textTheme.headlineSmall?.copyWith(
            fontWeight: FontWeight.bold,
            color: color,
          ),
        ),
        Text(
          unit,
          style: theme.textTheme.bodySmall?.copyWith(
            color: Colors.grey[600],
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: theme.textTheme.labelMedium,
        ),
      ],
    );
  }

  Widget _buildSettingItem(
    BuildContext context, {
    required IconData icon,
    required String title,
    required VoidCallback onTap,
  }) {
    final theme = Theme.of(context);

    return ListTile(
      leading: Icon(icon, color: theme.primaryColor),
      title: Text(title),
      trailing: Icon(
        Icons.arrow_forward_ios,
        size: 16,
        color: Colors.grey[400],
      ),
      onTap: onTap,
    );
  }

  String _formatDate(DateTime date) {
    return '${date.year}年${date.month}月${date.day}日';
  }

  void _showHelpDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('帮助与反馈'),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('常见问题：', style: TextStyle(fontWeight: FontWeight.bold)),
              SizedBox(height: 8),
              Text('Q: 如何开始学习？'),
              Text('A: 从主页选择感兴趣的算法模块开始学习。'),
              SizedBox(height: 8),
              Text('Q: 如何保存学习进度？'),
              Text('A: 系统会自动保存您的学习进度。'),
              SizedBox(height: 8),
              Text('Q: 遇到问题怎么办？'),
              Text('A: 可以通过邮件联系我们：support@algorithm-vis.com'),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('知道了'),
          ),
        ],
      ),
    );
  }

  void _showAboutDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('关于我们'),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('算法可视化学习平台', style: TextStyle(fontWeight: FontWeight.bold)),
              SizedBox(height: 8),
              Text('版本: 1.0.0'),
              SizedBox(height: 8),
              Text('这是一个专为计算机考研学生设计的算法学习平台，通过可视化的方式帮助理解各种算法和数据结构的原理。'),
              SizedBox(height: 8),
              Text('主要功能：'),
              Text('• 排序算法可视化'),
              Text('• 数据结构操作演示'),
              Text('• 学习进度追踪'),
              Text('• 个性化学习路径'),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('关闭'),
          ),
        ],
      ),
    );
  }
}
