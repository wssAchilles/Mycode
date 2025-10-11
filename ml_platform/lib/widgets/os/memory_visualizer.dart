// 内存可视化组件
import 'package:flutter/material.dart';
import 'dart:math' as math;
import 'package:ml_platform/models/os/memory_model.dart';

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
    final theme = Theme.of(context);
    final statistics = MemoryStatistics.fromPartitions(widget.partitions, widget.totalSize);
    
    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 标题栏
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.primaryColor.withOpacity(0.1),
              border: Border(
                bottom: BorderSide(color: theme.dividerColor),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '内存分配状态',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  '${statistics.usedMemory} / ${statistics.totalMemory} KB (${(statistics.utilizationRate * 100).toStringAsFixed(1)}%)',
                  style: theme.textTheme.bodyMedium,
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
                  return CustomPaint(
                    size: Size.infinite,
                    painter: MemoryAllocationPainter(
                      partitions: widget.partitions,
                      totalSize: widget.totalSize,
                      highlightPartitionId: widget.highlightPartitionId,
                      showAddresses: widget.showAddresses,
                      animation: widget.animationController,
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
              color: Colors.grey.shade50,
              border: Border(
                top: BorderSide(color: theme.dividerColor),
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
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _buildLegendItem('空闲', Colors.green.shade300),
        const SizedBox(width: 24),
        _buildLegendItem('已分配', Colors.blue.shade400),
        const SizedBox(width: 24),
        _buildLegendItem('外部碎片', Colors.orange.shade300),
        const SizedBox(width: 24),
        _buildLegendItem('高亮', Colors.yellow.shade400),
      ],
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
            color: color,
            borderRadius: BorderRadius.circular(2),
            border: Border.all(color: Colors.black26),
          ),
        ),
        const SizedBox(width: 4),
        Text(label, style: const TextStyle(fontSize: 12)),
      ],
    );
  }
  
  Widget _buildFragmentationInfo(MemoryStatistics statistics) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        _buildStatItem(
          '外部碎片',
          '${statistics.externalFragmentation} KB',
          Icons.scatter_plot,
          Colors.orange,
        ),
        _buildStatItem(
          '内部碎片',
          '${statistics.internalFragmentation} KB',
          Icons.padding,
          Colors.amber,
        ),
        _buildStatItem(
          '最大空闲块',
          '${statistics.largestFreePartition} KB',
          Icons.expand,
          Colors.green,
        ),
        _buildStatItem(
          '分区数',
          '${statistics.partitionCount}',
          Icons.view_module,
          Colors.blue,
        ),
      ],
    );
  }
  
  Widget _buildStatItem(String label, String value, IconData icon, Color color) {
    return Column(
      children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(height: 4),
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
        Text(label, style: const TextStyle(fontSize: 11)),
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
    
    final paint = Paint()..style = PaintingStyle.fill;
    final borderPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = Colors.black87;
    
    // 计算内存条尺寸
    final memoryWidth = size.width * 0.8;
    final memoryHeight = size.height * 0.6;
    final memoryX = (size.width - memoryWidth) / 2;
    final memoryY = (size.height - memoryHeight) / 2;
    
    // 绘制内存条背景
    paint.color = Colors.grey.shade200;
    final memoryRect = Rect.fromLTWH(memoryX, memoryY, memoryWidth, memoryHeight);
    canvas.drawRect(memoryRect, paint);
    canvas.drawRect(memoryRect, borderPaint);
    
    // 绘制分区
    double currentY = memoryY;
    for (var partition in partitions) {
      final partitionHeight = (partition.size / totalSize) * memoryHeight;
      
      // 确定颜色
      if (highlightPartitionId == partition.id) {
        paint.color = Colors.yellow.shade400;
      } else if (partition.isFree) {
        if (partition.size < 32) {
          paint.color = Colors.orange.shade300; // 外部碎片
        } else {
          paint.color = Colors.green.shade300; // 空闲
        }
      } else {
        paint.color = _getProcessColor(partition.processId ?? 0);
      }
      
      // 绘制分区矩形
      final partitionRect = Rect.fromLTWH(
        memoryX,
        currentY,
        memoryWidth,
        partitionHeight,
      );
      
      // 动画效果
      if (highlightPartitionId == partition.id) {
        final scale = 1.0 + 0.05 * math.sin(animation.value * 2 * math.pi);
        paint.color = paint.color.withOpacity(0.8 + 0.2 * scale);
      }
      
      canvas.drawRect(partitionRect, paint);
      
      // 绘制分区边框
      borderPaint.strokeWidth = 1;
      borderPaint.color = Colors.black54;
      canvas.drawRect(partitionRect, borderPaint);
      
      // 绘制分区信息
      if (partitionHeight > 20) {
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
          Offset(memoryX - 50, currentY),
          true,
        );
      }
      
      currentY += partitionHeight;
    }
    
    // 绘制结束地址
    if (showAddresses && partitions.isNotEmpty) {
      _drawAddressLabel(
        canvas,
        partitions.last.endAddress + 1,
        Offset(memoryX - 50, currentY),
        false,
      );
    }
  }
  
  void _drawPartitionInfo(Canvas canvas, MemoryPartition partition, Offset center) {
    String text;
    if (partition.isFree) {
      text = '空闲\n${partition.size} KB';
    } else {
      text = '${partition.processName ?? "进程${partition.processId}"}\n${partition.size} KB';
    }
    
    final textPainter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: partition.isFree ? Colors.black87 : Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.bold,
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
          color: Colors.black87,
          fontSize: 10,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    
    textPainter.paint(canvas, position - Offset(textPainter.width, 0));
    
    // 绘制连接线
    final paint = Paint()
      ..color = Colors.black54
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;
    
    canvas.drawLine(
      position + Offset(textPainter.width + 5, textPainter.height / 2),
      position + Offset(textPainter.width + 45, textPainter.height / 2),
      paint,
    );
  }
  
  Color _getProcessColor(int processId) {
    final colors = [
      Colors.blue.shade400,
      Colors.purple.shade400,
      Colors.teal.shade400,
      Colors.indigo.shade400,
      Colors.cyan.shade400,
      Colors.deepPurple.shade400,
    ];
    return colors[processId % colors.length];
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
    final theme = Theme.of(context);
    
    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 标题栏
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: step.isPageFault 
                  ? Colors.red.shade50 
                  : Colors.green.shade50,
              border: Border(
                bottom: BorderSide(
                  color: step.isPageFault ? Colors.red.shade200 : Colors.green.shade200,
                ),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(
                      step.isPageFault ? Icons.error : Icons.check_circle,
                      color: step.isPageFault ? Colors.red : Colors.green,
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '请求页面: ${step.requestedPage}',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
                Chip(
                  label: Text(
                    step.isPageFault ? '缺页' : '命中',
                    style: TextStyle(
                      color: step.isPageFault ? Colors.red : Colors.green,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  backgroundColor: step.isPageFault 
                      ? Colors.red.shade100 
                      : Colors.green.shade100,
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
                Text(
                  '页框状态',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 12),
                _buildFrames(),
                
                if (showDetails) ...[
                  const SizedBox(height: 16),
                  _buildDescription(theme),
                  const SizedBox(height: 12),
                  _buildStatistics(theme),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildFrames() {
    return Container(
      height: 80,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: step.frames.map((frame) {
          final isReplaced = frame.pageNumber == step.replacedPage;
          final isRequested = frame.pageNumber == step.requestedPage;
          
          return Container(
            width: 60,
            height: 60,
            margin: const EdgeInsets.symmetric(horizontal: 4),
            decoration: BoxDecoration(
              color: frame.pageNumber == null 
                  ? Colors.grey.shade300
                  : isReplaced 
                      ? Colors.red.shade200
                      : isRequested
                          ? Colors.green.shade200
                          : Colors.blue.shade200,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: isRequested 
                    ? Colors.green.shade600 
                    : isReplaced
                        ? Colors.red.shade600
                        : Colors.black54,
                width: isRequested || isReplaced ? 2 : 1,
              ),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  'F${frame.frameNumber}',
                  style: const TextStyle(
                    fontSize: 10,
                    color: Colors.black54,
                  ),
                ),
                Text(
                  frame.pageNumber?.toString() ?? '-',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: frame.pageNumber == null ? Colors.grey : Colors.black87,
                  ),
                ),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }
  
  Widget _buildDescription(ThemeData theme) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.blue.shade50,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(Icons.info_outline, color: Colors.blue.shade700, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              step.description,
              style: theme.textTheme.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildStatistics(ThemeData theme) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        _buildStatCard(
          '缺页次数',
          '${step.pageFaults}',
          Icons.error_outline,
          Colors.orange,
        ),
        _buildStatCard(
          '缺页率',
          '${(step.pageFaultRate * 100).toStringAsFixed(1)}%',
          Icons.percent,
          Colors.red,
        ),
        if (step.replacedPage != null)
          _buildStatCard(
            '被置换',
            '${step.replacedPage}',
            Icons.swap_horiz,
            Colors.purple,
          ),
      ],
    );
  }
  
  Widget _buildStatCard(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
              fontWeight: FontWeight.bold,
              color: Color.fromARGB(255, color.red, color.green, color.blue).withOpacity(0.8),
            ),
          ),
          Text(
            label,
            style: const TextStyle(fontSize: 11),
          ),
        ],
      ),
    );
  }
}
