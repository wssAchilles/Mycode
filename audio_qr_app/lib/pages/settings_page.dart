import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:permission_handler/permission_handler.dart';

import '../theme/theme_provider.dart' as theme_provider;
import '../widgets/responsive_layout.dart';
import '../widgets/animated_card.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('设置'),
        leading: IconButton(
          icon: Icon(PhosphorIcons.arrowLeft()),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: SafeArea(
        child: AdaptiveContainer(
          child: SingleChildScrollView(
            child: Column(
              children: [
                _buildAppearanceSection(context),
                const AdaptiveSpacing(),
                _buildPermissionsSection(context),
                const AdaptiveSpacing(),
                _buildGeneralSection(context),
                const AdaptiveSpacing(),
                _buildAdvancedSection(context),
                const AdaptiveSpacing(),
                _buildAboutSection(context),
                const SizedBox(height: 16), // 底部安全间距
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildAppearanceSection(BuildContext context) {
    return AnimatedCard(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primaryContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  PhosphorIcons.palette(),
                  color: Theme.of(context).colorScheme.onPrimaryContainer,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '外观设置',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Consumer<theme_provider.ThemeProvider>(
            builder: (context, themeProvider, child) {
              return Column(
                children: [
                  _buildThemeOption(
                    context,
                    title: '浅色模式',
                    subtitle: '使用明亮的界面主题',
                    icon: PhosphorIcons.sun(),
                    isSelected: themeProvider.themeMode == theme_provider.ThemeMode.light,
                    onTap: () => themeProvider.setThemeMode(theme_provider.ThemeMode.light),
                  ),
                  const SizedBox(height: 12),
                  _buildThemeOption(
                    context,
                    title: '深色模式',
                    subtitle: '使用深色的界面主题',
                    icon: PhosphorIcons.moon(),
                    isSelected: themeProvider.themeMode == theme_provider.ThemeMode.dark,
                    onTap: () => themeProvider.setThemeMode(theme_provider.ThemeMode.dark),
                  ),
                  const SizedBox(height: 12),
                  _buildThemeOption(
                    context,
                    title: '跟随系统',
                    subtitle: '根据系统设置自动切换',
                    icon: PhosphorIcons.gear(),
                    isSelected: themeProvider.themeMode == theme_provider.ThemeMode.system,
                    onTap: () => themeProvider.setThemeMode(theme_provider.ThemeMode.system),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildGeneralSection(BuildContext context) {
    return AnimatedCard(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.secondaryContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  PhosphorIcons.gear(),
                  color: Theme.of(context).colorScheme.onSecondaryContainer,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '通用设置',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _buildSettingsTile(
            context,
            title: '默认文件大小限制',
            subtitle: '100 MB',
            icon: PhosphorIcons.fileArchive(),
            onTap: () {
              // TODO: 实现文件大小设置
            },
          ),
          const Divider(height: 24),
          _buildSettingsTile(
            context,
            title: '支持的音频格式',
            subtitle: 'MP3, WAV, AAC, FLAC...',
            icon: PhosphorIcons.musicNote(),
            onTap: () {
              // TODO: 显示支持格式列表
            },
          ),
          const Divider(height: 24),
          _buildSettingsTile(
            context,
            title: '自动保存历史记录',
            subtitle: '保存最近生成的二维码',
            icon: PhosphorIcons.clockCounterClockwise(),
            trailing: Switch(
              value: true,
              onChanged: (value) {
                // TODO: 实现历史记录开关
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAdvancedSection(BuildContext context) {
    return AnimatedCard(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.tertiaryContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  PhosphorIcons.wrench(),
                  color: Theme.of(context).colorScheme.onTertiaryContainer,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '高级设置',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _buildSettingsTile(
            context,
            title: '清除缓存',
            subtitle: '清理临时文件和缓存数据',
            icon: PhosphorIcons.trash(),
            onTap: () async {
              final confirmed = await showDialog<bool>(
                context: context,
                builder: (context) => AlertDialog(
                  title: const Text('清除缓存'),
                  content: const Text('确定要清除所有缓存数据吗？这个操作不能撤销。'),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(false),
                      child: const Text('取消'),
                    ),
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(true),
                      child: const Text('确定'),
                    ),
                  ],
                ),
              );
              
              if (confirmed == true && context.mounted) {
                // TODO: 实现清除缓存功能
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('缓存已清除')),
                );
              }
            },
          ),
          const Divider(height: 24),
          _buildSettingsTile(
            context,
            title: '导出设置',
            subtitle: '备份当前应用设置',
            icon: PhosphorIcons.export(),
            onTap: () {
              // TODO: 实现设置导出
            },
          ),
          const Divider(height: 24),
          _buildSettingsTile(
            context,
            title: '重置应用',
            subtitle: '恢复所有设置到默认值',
            icon: PhosphorIcons.arrowCounterClockwise(),
            onTap: () async {
              final confirmed = await showDialog<bool>(
                context: context,
                builder: (context) => AlertDialog(
                  title: const Text('重置应用'),
                  content: const Text('确定要重置所有设置吗？这个操作不能撤销。'),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(false),
                      child: const Text('取消'),
                    ),
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(true),
                      child: const Text('确定'),
                    ),
                  ],
                ),
              );
              
              if (confirmed == true && context.mounted) {
                // TODO: 实现重置功能
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('应用已重置')),
                );
              }
            },
          ),
        ],
      ),
    );
  }

  Widget _buildAboutSection(BuildContext context) {
    return AnimatedCard(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  PhosphorIcons.info(),
                  color: Theme.of(context).colorScheme.onSurface,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '关于应用',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _buildSettingsTile(
            context,
            title: '使用帮助',
            subtitle: '了解如何使用应用功能',
            icon: PhosphorIcons.question(),
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (context) => const HelpPage(),
                ),
              );
            },
          ),
          const Divider(height: 24),
          _buildSettingsTile(
            context,
            title: '版本信息',
            subtitle: 'v1.0.0 (Build 1)',
            icon: PhosphorIcons.package(),
            onTap: () {
              showAboutDialog(
                context: context,
                applicationName: '音频二维码生成器',
                applicationVersion: 'v1.0.0',
                applicationIcon: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        Theme.of(context).colorScheme.primary,
                        Theme.of(context).colorScheme.secondary,
                      ],
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    PhosphorIcons.qrCode(),
                    color: Colors.white,
                    size: 32,
                  ),
                ),
                children: [
                  const Text('一个简单易用的音频文件二维码生成工具，帮助您快速分享音频文件。'),
                ],
              );
            },
          ),
          const Divider(height: 24),
          _buildSettingsTile(
            context,
            title: '隐私政策',
            subtitle: '了解我们如何保护您的隐私',
            icon: PhosphorIcons.shieldCheck(),
            onTap: () {
              // TODO: 显示隐私政策
            },
          ),
        ],
      ),
    );
  }

  Widget _buildThemeOption(
    BuildContext context, {
    required String title,
    required String subtitle,
    required IconData icon,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    final theme = Theme.of(context);
    
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected
                ? theme.colorScheme.primary
                : theme.colorScheme.outline.withOpacity(0.3),
            width: isSelected ? 2 : 1,
          ),
          color: isSelected
              ? theme.colorScheme.primaryContainer.withOpacity(0.3)
              : null,
        ),
        child: Row(
          children: [
            Icon(
              icon,
              color: isSelected
                  ? theme.colorScheme.primary
                  : theme.colorScheme.onSurfaceVariant,
              size: 24,
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: isSelected
                          ? theme.colorScheme.primary
                          : theme.colorScheme.onSurface,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            if (isSelected)
              Icon(
                PhosphorIcons.checkCircle(),
                color: theme.colorScheme.primary,
                size: 20,
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildSettingsTile(
    BuildContext context, {
    required String title,
    required String subtitle,
    required IconData icon,
    Widget? trailing,
    VoidCallback? onTap,
  }) {
    return ListTile(
      leading: Icon(
        icon,
        color: Theme.of(context).colorScheme.onSurfaceVariant,
      ),
      title: Text(
        title,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
          fontWeight: FontWeight.w500,
        ),
      ),
      subtitle: Text(subtitle),
      trailing: trailing ?? Icon(
        PhosphorIcons.caretRight(),
        color: Theme.of(context).colorScheme.onSurfaceVariant,
      ),
      onTap: onTap,
      contentPadding: EdgeInsets.zero,
    );
  }

  /// 构建权限管理区域
  Widget _buildPermissionsSection(BuildContext context) {
    return AnimatedCard(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.tertiaryContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  PhosphorIcons.shieldCheck(),
                  color: Theme.of(context).colorScheme.onTertiaryContainer,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '权限管理',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            '为了正常使用应用功能，需要获取以下权限：',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 16),
          
          // 存储权限
          _buildPermissionTile(
            context,
            title: '存储权限',
            subtitle: '用于访问和保存音频文件',
            icon: PhosphorIcons.folder(),
            permissions: [Permission.storage, Permission.manageExternalStorage],
            onTap: () => _requestStoragePermissions(context),
          ),
          const Divider(height: 24),
          
          // 相册权限
          _buildPermissionTile(
            context,
            title: '相册权限',
            subtitle: '用于保存二维码图片到相册',
            icon: PhosphorIcons.image(),
            permissions: [Permission.photos],
            onTap: () => _requestPhotosPermission(context),
          ),
          const Divider(height: 24),
          
          // 媒体权限
          _buildPermissionTile(
            context,
            title: '媒体权限',
            subtitle: '用于访问音频和图片文件',
            icon: PhosphorIcons.fileAudio(),
            permissions: [Permission.audio, Permission.mediaLibrary],
            onTap: () => _requestMediaPermissions(context),
          ),
          const Divider(height: 24),
          
          // 网络权限状态（只显示，不需要请求）
          _buildPermissionTile(
            context,
            title: '网络权限',
            subtitle: '用于上传文件到云端',
            icon: PhosphorIcons.wifiHigh(),
            permissions: [],
            isNetworkPermission: true,
            onTap: null,
          ),
          
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                Icon(
                  PhosphorIcons.info(),
                  color: Theme.of(context).colorScheme.primary,
                  size: 16,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '点击权限项可以请求权限或跳转到系统设置页面',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.primary,
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

  /// 构建权限项
  Widget _buildPermissionTile(
    BuildContext context, {
    required String title,
    required String subtitle,
    required IconData icon,
    required List<Permission> permissions,
    VoidCallback? onTap,
    bool isNetworkPermission = false,
  }) {
    return FutureBuilder<Map<Permission, bool>>(
      future: _checkPermissionsStatus(permissions),
      builder: (context, snapshot) {
        final permissionsStatus = snapshot.data ?? {};
        final bool allGranted = isNetworkPermission ? true : 
            permissions.isEmpty ? false : permissions.every((p) => permissionsStatus[p] == true);

        return InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: allGranted 
                        ? Colors.green.withValues(alpha: 0.1)
                        : Colors.orange.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(
                    icon,
                    color: allGranted ? Colors.green : Colors.orange,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: allGranted 
                        ? Colors.green.withValues(alpha: 0.1)
                        : Colors.orange.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    allGranted ? '已授权' : (isNetworkPermission ? '默认授权' : '未授权'),
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: allGranted ? Colors.green : Colors.orange,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
                if (onTap != null) ...[
                  const SizedBox(width: 8),
                  Icon(
                    PhosphorIcons.caretRight(),
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                    size: 16,
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  /// 检查权限状态
  Future<Map<Permission, bool>> _checkPermissionsStatus(List<Permission> permissions) async {
    final Map<Permission, bool> status = {};
    for (final permission in permissions) {
      final result = await permission.status;
      status[permission] = result == PermissionStatus.granted;
    }
    return status;
  }

  /// 请求存储权限
  Future<void> _requestStoragePermissions(BuildContext context) async {
    final permissions = [Permission.storage, Permission.manageExternalStorage];
    await _handlePermissionRequest(context, permissions, '存储权限');
  }

  /// 请求相册权限
  Future<void> _requestPhotosPermission(BuildContext context) async {
    final permissions = [Permission.photos];
    await _handlePermissionRequest(context, permissions, '相册权限');
  }

  /// 请求媒体权限
  Future<void> _requestMediaPermissions(BuildContext context) async {
    final permissions = [Permission.audio, Permission.mediaLibrary];
    await _handlePermissionRequest(context, permissions, '媒体权限');
  }

  /// 处理权限请求
  Future<void> _handlePermissionRequest(
    BuildContext context, 
    List<Permission> permissions, 
    String permissionName
  ) async {
    try {
      // 首先检查当前权限状态
      final Map<Permission, PermissionStatus> statuses = {};
      for (final permission in permissions) {
        statuses[permission] = await permission.status;
      }

      // 找出需要请求的权限
      final List<Permission> needRequest = [];
      final List<Permission> permanentlyDenied = [];

      for (final permission in permissions) {
        final status = statuses[permission]!;
        if (status == PermissionStatus.denied) {
          needRequest.add(permission);
        } else if (status == PermissionStatus.permanentlyDenied) {
          permanentlyDenied.add(permission);
        }
      }

      if (permanentlyDenied.isNotEmpty) {
        // 如果有权限被永久拒绝，显示对话框提示用户去设置
        await _showPermissionDeniedDialog(context, permissionName);
      } else if (needRequest.isNotEmpty) {
        // 请求权限
        final Map<Permission, PermissionStatus> results = await needRequest.request();
        
        // 检查结果
        final List<Permission> stillDenied = [];
        for (final permission in needRequest) {
          if (results[permission] != PermissionStatus.granted) {
            stillDenied.add(permission);
          }
        }

        if (stillDenied.isNotEmpty) {
          // 仍有权限被拒绝
          if (context.mounted) {
            _showSnackBar(context, '$permissionName请求失败，部分功能可能无法正常使用', isError: true);
          }
        } else {
          // 所有权限都获取成功
          if (context.mounted) {
            _showSnackBar(context, '$permissionName授权成功！');
            setState(() {}); // 刷新UI
          }
        }
      } else {
        // 所有权限都已授权
        if (context.mounted) {
          _showSnackBar(context, '$permissionName已经授权');
        }
      }
    } catch (e) {
      if (context.mounted) {
        _showSnackBar(context, '权限请求出错：$e', isError: true);
      }
    }
  }

  /// 显示权限被拒绝的对话框
  Future<void> _showPermissionDeniedDialog(BuildContext context, String permissionName) async {
    final bool? shouldOpenSettings = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('$permissionName被拒绝'),
        content: Text(
          '$permissionName已被永久拒绝，需要在系统设置中手动开启。\n\n'
          '点击"去设置"将跳转到应用设置页面，您可以在权限管理中开启相应权限。'
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('去设置'),
          ),
        ],
      ),
    );

    if (shouldOpenSettings == true) {
      // 打开应用设置页面
      await openAppSettings();
      
      // 延迟一下再刷新状态，因为用户可能会返回应用
      Future.delayed(const Duration(seconds: 1), () {
        if (mounted) {
          setState(() {});
        }
      });
    }
  }

  /// 显示提示消息
  void _showSnackBar(BuildContext context, String message, {bool isError = false}) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: isError 
              ? Theme.of(context).colorScheme.error
              : Theme.of(context).colorScheme.primary,
          behavior: SnackBarBehavior.floating,
          margin: const EdgeInsets.all(16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
        ),
      );
    }
  }
}

class HelpPage extends StatelessWidget {
  const HelpPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('使用帮助'),
        leading: IconButton(
          icon: Icon(PhosphorIcons.arrowLeft()),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: SafeArea(
        child: AdaptiveContainer(
          child: SingleChildScrollView(
            child: Column(
              children: [
                _buildHelpSection(
                  context,
                  title: '如何生成二维码？',
                  icon: PhosphorIcons.question(),
                  steps: [
                    '点击"选择音频文件"按钮',
                    '从设备中选择您要分享的音频文件',
                    '点击"上传文件"按钮将文件上传到云端',
                    '等待上传完成，二维码将自动生成',
                    '您可以保存二维码或直接分享给朋友',
                  ],
                ),
              const AdaptiveSpacing(),
              _buildHelpSection(
                context,
                title: '支持哪些音频格式？',
                icon: PhosphorIcons.musicNote(),
                content: '本应用支持以下音频格式：\n\n• MP3 - 最常见的音频格式\n• WAV - 无损音频格式\n• AAC - 高质量压缩格式\n• M4A - Apple设备常用格式\n• FLAC - 无损压缩格式\n• OGG - 开源音频格式\n• WMA - Windows Media格式',
              ),
              const AdaptiveSpacing(),
              _buildHelpSection(
                context,
                title: '二维码样式说明',
                icon: PhosphorIcons.palette(),
                content: '您可以选择不同的二维码样式：\n\n• 经典 - 传统的黑白方块样式\n• 现代 - 使用圆点和彩色设计\n• 圆润 - 柔和的圆角设计\n• 渐变 - 带有颜色渐变效果\n\n您还可以选择是否在二维码中心显示应用图标。',
              ),
              const AdaptiveSpacing(),
              _buildHelpSection(
                context,
                title: '常见问题',
                icon: PhosphorIcons.warning(),
                steps: [
                  'Q: 文件上传失败怎么办？\nA: 请检查网络连接，确保文件大小不超过100MB。',
                  'Q: 生成的二维码扫描不出来？\nA: 请确保二维码图片清晰，建议在光线充足的环境下扫描。',
                  'Q: 可以批量生成二维码吗？\nA: 目前版本暂不支持批量处理，请逐个处理文件。',
                  'Q: 上传的文件会保存多久？\nA: 文件会在云端保存30天，过期后自动删除。',
                ],
              ),
              const AdaptiveSpacing(),
              AnimatedCard(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    Icon(
                      PhosphorIcons.chatCircle(),
                      size: 48,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      '需要更多帮助？',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '如果您遇到其他问题，欢迎通过应用内反馈功能联系我们，我们会尽快为您解答。',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton.icon(
                      onPressed: () {
                        // TODO: 实现反馈功能
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('反馈功能开发中')),
                          );
                        }
                      },
                      icon: Icon(PhosphorIcons.paperPlaneTilt()),
                      label: const Text('联系客服'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16), // 底部安全间距
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHelpSection(
    BuildContext context, {
    required String title,
    required IconData icon,
    List<String>? steps,
    String? content,
  }) {
    return AnimatedCard(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primaryContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  icon,
                  color: Theme.of(context).colorScheme.onPrimaryContainer,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (content != null) ...[
            Text(
              content,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
                height: 1.5,
              ),
            ),
          ] else if (steps != null) ...[
            ...steps.asMap().entries.map((entry) {
              final index = entry.key;
              final step = entry.value;
              return Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 24,
                      height: 24,
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.primary,
                        shape: BoxShape.circle,
                      ),
                      child: Center(
                        child: Text(
                          '${index + 1}',
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.onPrimary,
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        step,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                ),
              );
            }).toList(),
          ],
        ],
      ),
    );
  }
}