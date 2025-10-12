import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// 主框架 Shell，包含底部导航栏
class MainShell extends StatelessWidget {
  final Widget child;
  final GoRouterState state;

  const MainShell({
    Key? key,
    required this.child,
    required this.state,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: child,
      bottomNavigationBar: _buildBottomNavigationBar(context),
    );
  }

  Widget? _buildBottomNavigationBar(BuildContext context) {
    // 获取当前路径
    final String location = state.uri.path;
    
    // 确定是否显示底部导航栏
    if (!_shouldShowBottomNav(location)) {
      return null;
    }

    // 确定当前选中的索引
    int currentIndex = _getSelectedIndex(location);

    return NavigationBar(
      selectedIndex: currentIndex,
      onDestinationSelected: (int index) {
        _onItemTapped(context, index);
      },
      destinations: const [
        NavigationDestination(
          icon: Icon(Icons.home_outlined),
          selectedIcon: Icon(Icons.home),
          label: '主页',
        ),
        NavigationDestination(
          icon: Icon(Icons.sort_outlined),
          selectedIcon: Icon(Icons.sort),
          label: '算法',
        ),
        NavigationDestination(
          icon: Icon(Icons.account_tree_outlined),
          selectedIcon: Icon(Icons.account_tree),
          label: '数据结构',
        ),
        NavigationDestination(
          icon: Icon(Icons.memory_outlined),
          selectedIcon: Icon(Icons.memory),
          label: '操作系统',
        ),
        NavigationDestination(
          icon: Icon(Icons.lan_outlined),
          selectedIcon: Icon(Icons.lan),
          label: '网络',
        ),
      ],
    );
  }

  bool _shouldShowBottomNav(String location) {
    // 这些路径不显示底部导航栏
    final List<String> excludedPaths = [
      '/login',
      '/register',
      '/splash',
    ];
    
    return !excludedPaths.any((path) => location.startsWith(path));
  }

  int _getSelectedIndex(String location) {
    if (location.startsWith('/home')) return 0;
    if (location.startsWith('/sorting')) return 1;
    if (location.startsWith('/data-structures')) return 2;
    if (location.startsWith('/os')) return 3;
    if (location.startsWith('/network')) return 4;
    return 0;
  }

  void _onItemTapped(BuildContext context, int index) {
    switch (index) {
      case 0:
        context.go('/home');
        break;
      case 1:
        context.go('/sorting');
        break;
      case 2:
        context.go('/data-structures');
        break;
      case 3:
        context.go('/os');
        break;
      case 4:
        context.go('/network');
        break;
    }
  }
}

/// 顶部导航栏 Shell（用于ML等模块）
class TopNavShell extends StatelessWidget {
  final Widget child;
  final GoRouterState state;
  final String title;

  const TopNavShell({
    Key? key,
    required this.child,
    required this.state,
    required this.title,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        centerTitle: true,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
          tooltip: '返回',
        ),
        actions: [
          // ML模块特有的操作按钮
          if (state.uri.path.startsWith('/ml'))
            IconButton(
              icon: const Icon(Icons.history),
              onPressed: () => context.go('/ml'),
              tooltip: '实验历史',
            ),
        ],
      ),
      body: child,
    );
  }
}

/// 侧边导航栏 Shell（用于大屏幕）
class SideNavShell extends StatelessWidget {
  final Widget child;
  final GoRouterState state;

  const SideNavShell({
    Key? key,
    required this.child,
    required this.state,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final bool isWideScreen = MediaQuery.of(context).size.width > 800;
    
    if (!isWideScreen) {
      // 小屏幕使用底部导航
      return MainShell(child: child, state: state);
    }

    // 大屏幕使用侧边导航
    return Scaffold(
      body: Row(
        children: [
          _buildNavigationRail(context),
          const VerticalDivider(thickness: 1, width: 1),
          Expanded(child: child),
        ],
      ),
    );
  }

  Widget _buildNavigationRail(BuildContext context) {
    final String location = state.uri.path;
    int selectedIndex = _getSelectedIndex(location);

    return NavigationRail(
      selectedIndex: selectedIndex,
      onDestinationSelected: (int index) {
        _onItemTapped(context, index);
      },
      labelType: NavigationRailLabelType.all,
      leading: Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Column(
          children: [
            Icon(
              Icons.school,
              size: 48,
              color: Theme.of(context).primaryColor,
            ),
            const SizedBox(height: 8),
            const Text(
              '算法学习平台',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
      destinations: const [
        NavigationRailDestination(
          icon: Icon(Icons.home_outlined),
          selectedIcon: Icon(Icons.home),
          label: Text('主页'),
        ),
        NavigationRailDestination(
          icon: Icon(Icons.sort_outlined),
          selectedIcon: Icon(Icons.sort),
          label: Text('排序算法'),
        ),
        NavigationRailDestination(
          icon: Icon(Icons.account_tree_outlined),
          selectedIcon: Icon(Icons.account_tree),
          label: Text('数据结构'),
        ),
        NavigationRailDestination(
          icon: Icon(Icons.memory_outlined),
          selectedIcon: Icon(Icons.memory),
          label: Text('操作系统'),
        ),
        NavigationRailDestination(
          icon: Icon(Icons.lan_outlined),
          selectedIcon: Icon(Icons.lan),
          label: Text('网络协议'),
        ),
        NavigationRailDestination(
          icon: Icon(Icons.psychology_outlined),
          selectedIcon: Icon(Icons.psychology),
          label: Text('机器学习'),
        ),
      ],
      trailing: Expanded(
        child: Align(
          alignment: Alignment.bottomCenter,
          child: Padding(
            padding: const EdgeInsets.only(bottom: 24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                IconButton(
                  icon: const Icon(Icons.dashboard_outlined),
                  onPressed: () => context.go('/dashboard'),
                  tooltip: '学习仪表盘',
                ),
                IconButton(
                  icon: const Icon(Icons.person_outline),
                  onPressed: () => context.go('/home/profile'),
                  tooltip: '个人中心',
                ),
                IconButton(
                  icon: const Icon(Icons.settings_outlined),
                  onPressed: () => _showSettings(context),
                  tooltip: '设置',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  int _getSelectedIndex(String location) {
    if (location.startsWith('/home')) return 0;
    if (location.startsWith('/sorting')) return 1;
    if (location.startsWith('/data-structures')) return 2;
    if (location.startsWith('/os')) return 3;
    if (location.startsWith('/network')) return 4;
    if (location.startsWith('/ml')) return 5;
    return 0;
  }

  void _onItemTapped(BuildContext context, int index) {
    switch (index) {
      case 0:
        context.go('/home');
        break;
      case 1:
        context.go('/sorting');
        break;
      case 2:
        context.go('/data-structures');
        break;
      case 3:
        context.go('/os');
        break;
      case 4:
        context.go('/network');
        break;
      case 5:
        context.go('/ml');
        break;
    }
  }

  void _showSettings(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('设置'),
        content: const Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('主题设置'),
            SizedBox(height: 8),
            Text('通知设置'),
            SizedBox(height: 8),
            Text('语言设置'),
          ],
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
