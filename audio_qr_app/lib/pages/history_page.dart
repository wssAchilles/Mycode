import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../services/history_manager.dart';
import '../models/history_item.dart';
import '../widgets/animated_card.dart';
import '../widgets/modern_buttons.dart';
import '../widgets/enhanced_qr_display.dart';

/// 历史记录页面
class HistoryPage extends StatefulWidget {
  const HistoryPage({super.key});

  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends State<HistoryPage> with TickerProviderStateMixin {
  late TabController _tabController;
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';
  bool _isSearching = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: _isSearching ? _buildSearchField() : const Text('历史记录'),
        actions: [
          IconButton(
            icon: Icon(_isSearching ? PhosphorIcons.x() : PhosphorIcons.magnifyingGlass()),
            onPressed: () {
              setState(() {
                _isSearching = !_isSearching;
                if (!_isSearching) {
                  _searchController.clear();
                  _searchQuery = '';
                }
              });
            },
          ),
          PopupMenuButton(
            icon: Icon(PhosphorIcons.dotsThree()),
            itemBuilder: (context) => [
              PopupMenuItem(
                onTap: _showStatistics,
                child: Row(
                  children: [
                    Icon(PhosphorIcons.chartPie()),
                    const SizedBox(width: 12),
                    const Text('统计信息'),
                  ],
                ),
              ),
              PopupMenuItem(
                onTap: _showClearConfirmation,
                child: Row(
                  children: [
                    Icon(PhosphorIcons.trash(), color: Theme.of(context).colorScheme.error),
                    const SizedBox(width: 12),
                    Text('清空记录', style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  ],
                ),
              ),
            ],
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: '全部'),
            Tab(text: '收藏'),
          ],
        ),
      ),
      body: Consumer<HistoryManager>(
        builder: (context, historyManager, child) {
          final allItems = _searchQuery.isEmpty 
              ? historyManager.items 
              : historyManager.searchItems(_searchQuery);
          final favoriteItems = _searchQuery.isEmpty 
              ? historyManager.favorites
              : historyManager.favorites.where((item) => 
                  item.fileName.toLowerCase().contains(_searchQuery.toLowerCase())).toList();

          return TabBarView(
            controller: _tabController,
            children: [
              _buildHistoryList(allItems, '暂无历史记录'),
              _buildHistoryList(favoriteItems, '暂无收藏记录'),
            ],
          );
        },
      ),
    );
  }

  Widget _buildSearchField() {
    return TextField(
      controller: _searchController,
      autofocus: true,
      decoration: const InputDecoration(
        hintText: '搜索文件名...',
        border: InputBorder.none,
      ),
      onChanged: (value) {
        setState(() {
          _searchQuery = value;
        });
      },
    );
  }

  Widget _buildHistoryList(List<HistoryItem> items, String emptyMessage) {
    if (items.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              PhosphorIcons.clockCounterClockwise(),
              size: 64,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 16),
            Text(
              emptyMessage,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final item = items[index];
        return _buildHistoryItem(item);
      },
    );
  }

  Widget _buildHistoryItem(HistoryItem item) {
    return AnimatedCard(
      margin: const EdgeInsets.only(bottom: 12),
      padding: EdgeInsets.zero,
      child: Column(
        children: [
          ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primaryContainer,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                _getFileIcon(item.fileExtension),
                color: Theme.of(context).colorScheme.onPrimaryContainer,
              ),
            ),
            title: Text(
              item.fileName,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 4),
                Row(
                  children: [
                    Text(
                      item.formattedFileSize,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.tertiaryContainer,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        item.fileExtension.toUpperCase(),
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: Theme.of(context).colorScheme.onTertiaryContainer,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  item.formattedCreatedAt,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  icon: Icon(
                    item.isFavorite ? PhosphorIcons.heartStraight() : PhosphorIcons.heart(),
                    color: item.isFavorite ? Colors.red : null,
                  ),
                  onPressed: () {
                    context.read<HistoryManager>().toggleFavorite(item.id);
                  },
                ),
                IconButton(
                  icon: Icon(PhosphorIcons.qrCode()),
                  onPressed: () => _showQRCode(item),
                ),
                PopupMenuButton(
                  icon: Icon(PhosphorIcons.dotsThree()),
                  itemBuilder: (context) => [
                    PopupMenuItem(
                      onTap: () => _copyLink(item),
                      child: Row(
                        children: [
                          Icon(PhosphorIcons.copy()),
                          const SizedBox(width: 12),
                          const Text('复制链接'),
                        ],
                      ),
                    ),
                    PopupMenuItem(
                      onTap: () => _shareItem(item),
                      child: Row(
                        children: [
                          Icon(PhosphorIcons.share()),
                          const SizedBox(width: 12),
                          const Text('分享'),
                        ],
                      ),
                    ),
                    PopupMenuItem(
                      onTap: () => _deleteItem(item),
                      child: Row(
                        children: [
                          Icon(PhosphorIcons.trash(), color: Theme.of(context).colorScheme.error),
                          const SizedBox(width: 12),
                          Text('删除', style: TextStyle(color: Theme.of(context).colorScheme.error)),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  IconData _getFileIcon(String extension) {
    switch (extension.toLowerCase()) {
      case 'mp3':
      case 'wav':
      case 'aac':
      case 'm4a':
      case 'flac':
      case 'ogg':
        return PhosphorIcons.musicNote();
      default:
        return PhosphorIcons.file();
    }
  }

  void _showQRCode(HistoryItem item) {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        child: Container(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.75,
            maxWidth: MediaQuery.of(context).size.width * 0.8,
          ),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  item.fileName,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 16),
                _buildCompactQRDisplay(item),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.of(context).pop(),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          minimumSize: const Size(0, 36),
                        ),
                        child: const Text('关闭', style: TextStyle(fontSize: 12)),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () {
                          _copyLink(item);
                          Navigator.of(context).pop();
                        },
                        icon: Icon(PhosphorIcons.copy(), size: 14),
                        label: const Text('复制链接', style: TextStyle(fontSize: 12)),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
                          minimumSize: const Size(0, 36),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// 构建紧凑的二维码显示组件（用于弹窗）
  Widget _buildCompactQRDisplay(HistoryItem item) {
    final theme = Theme.of(context);
    return Column(
      children: [
        // QR码显示区域
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(8),
            boxShadow: [
              BoxShadow(
                color: theme.colorScheme.primary.withValues(alpha: 0.1),
                blurRadius: 8,
                offset: const Offset(0, 4),
                spreadRadius: 0,
              ),
            ],
          ),
          child: RepaintBoundary(
            key: GlobalKey(),
            child: QrImageView(
              data: item.qrData,
              version: QrVersions.auto,
              size: 160,
              backgroundColor: Colors.white,
              foregroundColor: Colors.black,
              gapless: false,
              errorCorrectionLevel: QrErrorCorrectLevel.M,
            ),
          ),
        ),
        
        const SizedBox(height: 12),
        
        // 操作按钮
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () async {
                  Navigator.of(context).pop();
                  _showSnackBar('二维码已保存到相册');
                },
                icon: Icon(PhosphorIcons.downloadSimple(), size: 14),
                label: const Text('保存', style: TextStyle(fontSize: 11)),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
                  minimumSize: const Size(0, 32),
                ),
              ),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () {
                  Navigator.of(context).pop();
                  _shareItem(item);
                },
                icon: Icon(PhosphorIcons.share(), size: 14),
                label: const Text('分享', style: TextStyle(fontSize: 11)),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
                  minimumSize: const Size(0, 32),
                ),
              ),
            ),
          ],
        ),
        
        const SizedBox(height: 8),
        
        // 简化的使用提示
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(6),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                PhosphorIcons.info(),
                size: 14,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '使用任何二维码扫描器扫描即可下载音频文件',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                    fontSize: 10,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _copyLink(HistoryItem item) {
    Clipboard.setData(ClipboardData(text: item.downloadUrl));
    _showSnackBar('链接已复制到剪贴板');
  }

  void _shareItem(HistoryItem item) {
    // TODO: 实现分享功能
    _showSnackBar('分享功能开发中');
  }

  void _deleteItem(HistoryItem item) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('确认删除'),
        content: Text('确定要删除 "${item.fileName}" 吗？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () {
              context.read<HistoryManager>().removeItem(item.id);
              Navigator.of(context).pop();
              _showSnackBar('已删除记录');
            },
            child: Text('删除', style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
        ],
      ),
    );
  }

  void _showStatistics() {
    final historyManager = context.read<HistoryManager>();
    final stats = historyManager.getStatistics();
    
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Row(
          children: [
            Icon(PhosphorIcons.chartPie()),
            const SizedBox(width: 12),
            const Text('统计信息'),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildStatItem('总记录数', '${stats['totalItems']}'),
            _buildStatItem('收藏数', '${stats['favorites']}'),
            _buildStatItem('文件类型', '${stats['uniqueExtensions']}种'),
            _buildStatItem('总文件大小', _formatBytes(stats['totalFileSize'] ?? 0)),
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

  Widget _buildStatItem(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label),
          Text(
            value,
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }

  String _formatBytes(int bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    double size = bytes.toDouble();
    int unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return '${size.toStringAsFixed(size < 10 && unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}';
  }

  void _showClearConfirmation() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('确认清空'),
        content: const Text('确定要清空所有历史记录吗？此操作不可撤销。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () {
              context.read<HistoryManager>().clearAll();
              Navigator.of(context).pop();
              _showSnackBar('已清空所有记录');
            },
            child: Text('清空', style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
        ],
      ),
    );
  }

  void _showSnackBar(String message) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    }
  }
}