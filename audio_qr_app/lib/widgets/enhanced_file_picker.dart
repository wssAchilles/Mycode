import 'dart:io';

import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// 增强的文件选择器组件
class EnhancedFilePicker extends StatefulWidget {
  final Function(PlatformFile file, String filePath) onFileSelected;
  final List<String> allowedExtensions;
  final int maxFileSizeMB;
  final String title;
  final String subtitle;

  const EnhancedFilePicker({
    super.key,
    required this.onFileSelected,
    required this.allowedExtensions,
    this.maxFileSizeMB = 50,
    this.title = '选择文件',
    this.subtitle = '点击选择或拖拽文件到此区域',
  });

  @override
  State<EnhancedFilePicker> createState() => _EnhancedFilePickerState();
}

class _EnhancedFilePickerState extends State<EnhancedFilePicker>
    with TickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  late Animation<Color?> _colorAnimation;

  final bool _isDragOver = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 200),
      vsync: this,
    );

    _scaleAnimation = Tween<double>(
      begin: 1.0,
      end: 1.02,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOut,
    ));

    _colorAnimation = ColorTween(
      begin: Colors.transparent,
      end: Colors.blue.withOpacity(0.05),
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOut,
    ));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _pickFile() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: widget.allowedExtensions,
        allowMultiple: false,
      );

      if (result != null && result.files.isNotEmpty) {
        final file = result.files.first;
        final filePath = file.path;

        if (filePath == null) {
          _showError('无法获取文件路径');
          return;
        }

        // 检查文件大小
        if (file.size > widget.maxFileSizeMB * 1024 * 1024) {
          _showError('文件大小超过${widget.maxFileSizeMB}MB限制');
          return;
        }

        // 检查文件是否存在
        final fileObj = File(filePath);
        if (!await fileObj.exists()) {
          _showError('选择的文件不存在');
          return;
        }

        widget.onFileSelected(file, filePath);
      }
    } catch (e) {
      _showError('文件选择失败：$e');
    }
  }

  void _showError(String message) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    }
  }

  String _formatFileSize(int bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    double size = bytes.toDouble();
    int unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return '${size.toStringAsFixed(size < 10 && unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}';
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Transform.scale(
          scale: _scaleAnimation.value,
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: _isDragOver 
                    ? theme.colorScheme.primary
                    : theme.colorScheme.outline.withOpacity(0.3),
                width: _isDragOver ? 2 : 1,
                style: BorderStyle.solid,
              ),
              color: _colorAnimation.value,
            ),
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                borderRadius: BorderRadius.circular(20),
                onTap: _pickFile,
                onHover: (hovering) {
                  if (hovering) {
                    _controller.forward();
                  } else {
                    _controller.reverse();
                  }
                },
                child: Container(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.primaryContainer,
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Icon(
                          PhosphorIcons.cloudArrowUp(),
                          size: 48,
                          color: theme.colorScheme.onPrimaryContainer,
                        ),
                      ),
                      const SizedBox(height: 24),
                      Text(
                        widget.title,
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        widget.subtitle,
                        style: theme.textTheme.bodyLarge?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 16),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        alignment: WrapAlignment.center,
                        children: widget.allowedExtensions.map((ext) {
                          return Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: theme.colorScheme.surfaceContainerHighest,
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Text(
                              ext.toUpperCase(),
                              style: theme.textTheme.labelMedium?.copyWith(
                                fontWeight: FontWeight.w500,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                      const SizedBox(height: 16),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            PhosphorIcons.info(),
                            size: 16,
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            '最大文件大小：${widget.maxFileSizeMB}MB',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

/// 文件信息显示卡片
class FileInfoCard extends StatelessWidget {
  final PlatformFile file;
  final VoidCallback? onRemove;
  final VoidCallback? onReplace;
  
  const FileInfoCard({
    super.key,
    required this.file,
    this.onRemove,
    this.onReplace,
  });
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: theme.colorScheme.outline.withOpacity(0.2),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: theme.colorScheme.primaryContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  _getFileIcon(),
                  size: 24,
                  color: theme.colorScheme.onPrimaryContainer,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      file.name,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Text(
                          _formatFileSize(file.size),
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.tertiaryContainer,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            (file.extension ?? '').toUpperCase(),
                            style: theme.textTheme.labelSmall?.copyWith(
                              fontWeight: FontWeight.w500,
                              color: theme.colorScheme.onTertiaryContainer,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              PopupMenuButton(
                icon: Icon(
                  PhosphorIcons.dotsThree(),
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                itemBuilder: (context) => [
                  if (onReplace != null)
                    PopupMenuItem(
                      onTap: onReplace,
                      child: Row(
                        children: [
                          Icon(PhosphorIcons.arrowsClockwise()),
                          const SizedBox(width: 12),
                          const Text('更换文件'),
                        ],
                      ),
                    ),
                  if (onRemove != null)
                    PopupMenuItem(
                      onTap: onRemove,
                      child: Row(
                        children: [
                          Icon(
                            PhosphorIcons.trash(),
                            color: theme.colorScheme.error,
                          ),
                          const SizedBox(width: 12),
                          Text(
                            '移除文件',
                            style: TextStyle(
                              color: theme.colorScheme.error,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }
  
  IconData _getFileIcon() {
    final extension = file.extension?.toLowerCase() ?? '';
    
    switch (extension) {
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
  
  String _formatFileSize(int bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    double size = bytes.toDouble();
    int unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return '${size.toStringAsFixed(size < 10 && unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}';
  }
}