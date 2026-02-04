// 内存可视化组件
import 'package:flutter/material.dart';
import 'dart:math' as math;
import 'package:ml_platform/models/os/memory_model.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/widgets/common/glass_widgets.dart';

/// 内存分配可视化器
class MemoryAllocationVisualizer extends StatefulWidget {
  final List<MemoryPartition> partitions;
  final int totalSize;
  final AnimationController animationController;
  final int? highlightPartitionId;
  final bool showAddresses;
  final bool showFragmentation;
  
  const MemoryAllocationVisualizer({
    Key? key,
    required this.partitions,
    required this.totalSize,
    required this.animationController,
    this.highlightPartitionId,
    this.showAddresses = true,
    this.showFragmentation = true,
  }) : super(key: key);
  
  @override
  State<MemoryAllocationVisualizer> createState() => _MemoryAllocationVisualizerState();
}

class _MemoryAllocationVisualizerState extends State<MemoryAllocationVisualizer> {
  @override
  Widget build(BuildContext context) {
    final statistics = MemoryStatistics.fromPartitions(widget.partitions, widget.totalSize);
    
    return GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 标题栏
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(color: AppTheme.glassBorder),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '内存分配状态',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textPrimary,
                    fontSize: 16,
                  ),
                ),
                Text(
                  '${statistics.usedMemory} / ${statistics.totalMemory} KB (${(statistics.utilizationRate * 100).toStringAsFixed(1)}%)',
                  style: const TextStyle(
                    color: AppTheme.textSecondary,
                    fontFamily: AppTheme.codeFont,
                  ),
                ),
              ],
            ),
          ),
          
          // 内存可视化
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: AnimatedBuilder(
                animation: widget.animationController,
                builder: (context, child) {
                  return RepaintBoundary(
                    child: CustomPaint(
                      size: Size.infinite,
                      painter: MemoryAllocationPainter(
                        partitions: widget.partitions,
                        totalSize: widget.totalSize,
                        highlightPartitionId: widget.highlightPartitionId,
                        showAddresses: widget.showAddresses,
                        animation: widget.animationController,
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
          
          // 图例和统计信息
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              border: Border(
                top: BorderSide(color: AppTheme.glassBorder),
              ),
            ),
            child: Column(
              children: [
                _buildLegend(),
                if (widget.showFragmentation) ...[
                  const SizedBox(height: 12),
                  _buildFragmentationInfo(statistics),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildLegend() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _buildLegendItem('空闲', AppTheme.primary),
          const SizedBox(width: 24),
          _buildLegendItem('已分配', AppTheme.secondary),
          const SizedBox(width: 24),
          _buildLegendItem('外部碎片', AppTheme.error),
          const SizedBox(width: 24),
          _buildLegendItem('高亮', AppTheme.accent),
        ],
      ),
    );
  }
  
  Widget _buildLegendItem(String label, Color color) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 16,
          height: 16,
          decoration: BoxDecoration(
            color: color.withOpacity(0.3),
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: color),
            boxShadow: [
              BoxShadow(
                color: color.withOpacity(0.2),
                blurRadius: 4,
              )
            ]
          ),
        ),
        const SizedBox(width: 8),
        Text(label, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
      ],
    );
  }
  
  Widget _buildFragmentationInfo(MemoryStatistics statistics) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        Expanded(
          child: _buildStatItem(
            '外部碎片',
            '${statistics.externalFragmentation} KB',
            Icons.scatter_plot,
            AppTheme.error,
          ),
        ),
        Expanded(
          child: _buildStatItem(
            '内部碎片',
            '${statistics.internalFragmentation} KB',
            Icons.padding,
            AppTheme.warning,
          ),
        ),
        Expanded(
          child: _buildStatItem(
            '最大空闲块',
            '${statistics.largestFreePartition} KB',
            Icons.expand,
            AppTheme.primary,
          ),
        ),
        Expanded(
          child: _buildStatItem(
            '分区数',
            '${statistics.partitionCount}',
            Icons.view_module,
            AppTheme.secondary,
          ),
        ),
      ],
    );
  }
  
  Widget _buildStatItem(String label, String value, IconData icon, Color color) {
    return Column(
      children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(height: 4),
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.textPrimary, fontFamily: AppTheme.codeFont)),
        Text(label, style: TextStyle(fontSize: 11, color: color)),
      ],
    );
  }
}

/// 内存分配绘制器
class MemoryAllocationPainter extends CustomPainter {
  final List<MemoryPartition> partitions;
  final int totalSize;
  final int? highlightPartitionId;
  final bool showAddresses;
  final Animation<double> animation;
  
  MemoryAllocationPainter({
    required this.partitions,
    required this.totalSize,
    this.highlightPartitionId,
    required this.showAddresses,
    required this.animation,
  }) : super(repaint: animation);
  
  @override
  void paint(Canvas canvas, Size size) {
    if (partitions.isEmpty || totalSize == 0) return;
    
    // 基础绘制工具
    final borderPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = AppTheme.glassBorder;
      
    final bgPaint = Paint()
      ..style = PaintingStyle.fill
      ..color = AppTheme.textPrimary.withOpacity(0.02);
    
    // 计算内存条尺寸
    final memoryWidth = size.width * 0.8;
    final memoryHeight = size.height * 0.8;
    final memoryX = (size.width - memoryWidth) / 2;
    final memoryY = (size.height - memoryHeight) / 2;
    
    // 绘制内存条背景
    final memoryRect = Rect.fromLTWH(memoryX, memoryY, memoryWidth, memoryHeight);
    canvas.drawRRect(RRect.fromRectAndRadius(memoryRect, const Radius.circular(8)), bgPaint);
    canvas.drawRRect(RRect.fromRectAndRadius(memoryRect, const Radius.circular(8)), borderPaint);
    
    // 绘制分区
    double currentY = memoryY;
    for (var i = 0; i < partitions.length; i++) {
      final partition = partitions[i];
      final partitionHeight = (partition.size / totalSize) * memoryHeight;
      final isLast = i == partitions.length - 1;
      
      // 确定颜色
      Paint fillPaint = Paint()..style = PaintingStyle.fill;
      Color baseColor;
      
      if (highlightPartitionId == partition.id) {
        baseColor = AppTheme.accent;
      } else if (partition.isFree) {
        if (partition.size < 32) {
          baseColor = AppTheme.error.withOpacity(0.5); // 外部碎片
        } else {
          baseColor = AppTheme.primary.withOpacity(0.3); // 空闲
        }
      } else {
        baseColor = _getProcessColor(partition.processId ?? 0);
      }
      
      // 动画效果
      if (highlightPartitionId == partition.id) {
        final scale = 1.0 + 0.1 * math.sin(animation.value * 4 * math.pi);
        fillPaint.color = baseColor.withOpacity(0.6 * scale > 1.0 ? 1.0 : 0.6 * scale);
        // Add glow
        fillPaint.maskFilter = const MaskFilter.blur(BlurStyle.outer, 8);
      } else {
        fillPaint.color = baseColor;
      }
      
      // 绘制分区矩形
      final partitionRect = Rect.fromLTWH(
        memoryX,
        currentY,
        memoryWidth,
        partitionHeight,
      );
      
      // 仅为当前分区绘制填充
      canvas.drawRect(partitionRect, fillPaint);
      if (highlightPartitionId == partition.id) {
         // remove blur for subsequent drawings
         fillPaint.maskFilter = null;
      }
      
      // 绘制分区边框
      canvas.drawRect(partitionRect, borderPaint);
      
      // 绘制分区信息
      if (partitionHeight > 24) {
        _drawPartitionInfo(
          canvas,
          partition,
          Offset(memoryX + memoryWidth / 2, currentY + partitionHeight / 2),
        );
      }
      
      // 绘制地址标签
      if (showAddresses && partitionHeight > 15) {
        _drawAddressLabel(
          canvas,
          partition.startAddress,
          Offset(memoryX - 25, currentY),
          true,
        );
      }
      
      if (isLast && showAddresses) {
         _drawAddressLabel(
          canvas,
          partition.endAddress + 1,
          Offset(memoryX - 25, currentY + partitionHeight),
          false,
        );
      }
      
      currentY += partitionHeight;
    }
  }
  
  void _drawPartitionInfo(Canvas canvas, MemoryPartition partition, Offset center) {
    String text;
    Color textColor;
    
    if (partition.isFree) {
      text = '空闲\n${partition.size} KB';
      textColor = AppTheme.textSecondary;
    } else {
      text = '${partition.processName ?? "进程${partition.processId}"}\n${partition.size} KB';
      textColor = AppTheme.textPrimary;
    }
    
    final textPainter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: textColor,
          fontSize: 12,
          fontWeight: FontWeight.bold,
          fontFamily: AppTheme.codeFont
        ),
      ),
      textAlign: TextAlign.center,
      textDirection: TextDirection.ltr,
    )..layout();
    
    textPainter.paint(
      canvas,
      center - Offset(textPainter.width / 2, textPainter.height / 2),
    );
  }
  
  void _drawAddressLabel(Canvas canvas, int address, Offset position, bool isStart) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: '$address KB',
        style: const TextStyle(
          color: AppTheme.textSecondary,
          fontSize: 10,
          fontFamily: AppTheme.codeFont
        ),
      ),
      textDirection: TextDirection.ltr,
      textAlign: TextAlign.right,
    )..layout();
    
    // Draw line
    final paint = Paint()
      ..color = AppTheme.glassBorder
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;

    canvas.drawLine(
       position + Offset(2, 0),
       position + Offset(20, 0), 
       paint
    );
    
    textPainter.paint(canvas, position - Offset(textPainter.width + 5, textPainter.height / 2));
  }
  
  Color _getProcessColor(int processId) {
    final colors = [
      AppTheme.secondary,
      AppTheme.primary,
      AppTheme.info,
      AppTheme.secondary,
      AppTheme.accent,
      AppTheme.warning,
    ];
    return colors[processId % colors.length].withOpacity(0.5);
  }
  
  @override
  bool shouldRepaint(covariant MemoryAllocationPainter oldDelegate) {
    return oldDelegate.partitions != partitions ||
        oldDelegate.highlightPartitionId != highlightPartitionId;
  }
}

/// 页面置换可视化器
class PageReplacementVisualizer extends StatelessWidget {
  final PageReplacementStep step;
  final int frameCount;
  final bool showDetails;
  
  const PageReplacementVisualizer({
    Key? key,
    required this.step,
    required this.frameCount,
    this.showDetails = true,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 标题栏
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(
                  color: step.isPageFault ? AppTheme.error.withOpacity(0.3) : AppTheme.success.withOpacity(0.3),
                ),
              ),
              color: step.isPageFault 
                  ? AppTheme.error.withOpacity(0.1) 
                  : AppTheme.success.withOpacity(0.1),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(
                      step.isPageFault ? Icons.error_outline : Icons.check_circle_outline,
                      color: step.isPageFault ? AppTheme.error : AppTheme.success,
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '请求页面: ${step.requestedPage}',
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                        color: AppTheme.textPrimary,
                        fontFamily: AppTheme.codeFont,
                      ),
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(
                    color: step.isPageFault ? AppTheme.error.withOpacity(0.2) : AppTheme.success.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: step.isPageFault ? AppTheme.error : AppTheme.success,
                    ),
                  ),
                  child: Text(
                    step.isPageFault ? '缺页' : '命中',
                    style: TextStyle(
                      color: step.isPageFault ? AppTheme.error : AppTheme.success,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                ),
              ],
            ),
          ),
          
          // 页框展示
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '页框状态',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textSecondary,
                  ),
                ),
                const SizedBox(height: 16),
                _buildFrames(),
                
                if (showDetails) ...[
                  const SizedBox(height: 16),
                  _buildDescription(),
                  const SizedBox(height: 16),
                  _buildStatistics(),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildFrames() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: step.frames.map((frame) {
          final isReplaced = frame.pageNumber == step.replacedPage;
          final isRequested = frame.pageNumber == step.requestedPage;
          
          Color frameColor = AppTheme.textPrimary.withOpacity(0.05);
          Color borderColor = AppTheme.glassBorder;
          Color textColor = AppTheme.textSecondary;
          
          if (frame.pageNumber != null) {
            textColor = AppTheme.textPrimary;
            if (isReplaced) {
              frameColor = AppTheme.error.withOpacity(0.2);
              borderColor = AppTheme.error;
            } else if (isRequested) {
              frameColor = AppTheme.success.withOpacity(0.2);
              borderColor = AppTheme.success;
            } else {
              frameColor = AppTheme.primary.withOpacity(0.1);
              borderColor = AppTheme.primary.withOpacity(0.5);
            }
          }
          
          return Container(
            width: 70,
            height: 80,
            margin: const EdgeInsets.only(right: 12),
            decoration: BoxDecoration(
              color: frameColor,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: borderColor,
                width: isRequested || isReplaced ? 2 : 1,
              ),
              boxShadow: (isRequested || isReplaced) ? [
                 BoxShadow(color: borderColor.withOpacity(0.3), blurRadius: 8, spreadRadius: 1)
              ] : null,
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  'Frame ${frame.frameNumber}',
                  style: const TextStyle(
                    fontSize: 10,
                    color: AppTheme.textSecondary,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  frame.pageNumber?.toString() ?? '-',
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: textColor,
                    fontFamily: AppTheme.codeFont,
                  ),
                ),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }
  
  Widget _buildDescription() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.primary.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppTheme.primary.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.info_outline, color: AppTheme.primary, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              step.description,
              style: const TextStyle(color: AppTheme.textSecondary),
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildStatistics() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        Expanded(
          child: _buildStatCard(
            '缺页次数',
            '${step.pageFaults}',
            Icons.error_outline,
            AppTheme.error,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _buildStatCard(
            '缺页率',
            '${(step.pageFaultRate * 100).toStringAsFixed(1)}%',
            Icons.percent,
            AppTheme.warning,
          ),
        ),
        if (step.replacedPage != null) ...[
          const SizedBox(width: 8),
          Expanded(
            child: _buildStatCard(
              '被置换',
              '${step.replacedPage}',
              Icons.swap_horiz,
              AppTheme.accent,
            ),
          ),
        ],
      ],
    );
  }
  
  Widget _buildStatCard(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Column(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
              fontWeight: FontWeight.bold,
              color: AppTheme.textPrimary,
              fontFamily: AppTheme.codeFont,
              fontSize: 16
            ),
          ),
          Text(
            label,
            style: TextStyle(fontSize: 10, color: color),
          ),
        ],
      ),
    );
  }
}
