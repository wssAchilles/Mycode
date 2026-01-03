// 甘特图可视化组件 - Academic Tech Dark 风格优化
import 'package:flutter/material.dart';
import 'dart:math' as math;
import 'package:ml_platform/models/os/process_model.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/widgets/common/glass_widgets.dart';

/// 甘特图可视化器
class GanttChartVisualizer extends StatefulWidget {
  final SchedulingResult result;
  final AnimationController animationController;
  final int? currentTime; // 当前时间点（用于动画）
  final bool showDetails;
  final double height;
  
  const GanttChartVisualizer({
    Key? key,
    required this.result,
    required this.animationController,
    this.currentTime,
    this.showDetails = true,
    this.height = 240,
  }) : super(key: key);
  
  @override
  State<GanttChartVisualizer> createState() => _GanttChartVisualizerState();
}

class _GanttChartVisualizerState extends State<GanttChartVisualizer> {
  @override
  Widget build(BuildContext context) {
    return GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 标题栏
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(color: AppTheme.glassBorder),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(Icons.bar_chart, color: AppTheme.primary, size: 20),
                    const SizedBox(width: 8),
                    Text(
                      '甘特图 - ${widget.result.algorithm.label}',
                      style: AppTheme.darkTheme.textTheme.titleMedium?.copyWith(
                        color: AppTheme.primary,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
                if (widget.currentTime != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppTheme.primary.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppTheme.primary.withOpacity(0.5)),
                    ),
                    child: Text(
                      'T = ${widget.currentTime}',
                      style: const TextStyle(
                        fontFamily: AppTheme.codeFont,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.primary,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          
          // 甘特图主体
          Container(
            height: widget.height,
            padding: const EdgeInsets.all(16),
            child: CustomPaint(
              size: Size.infinite,
              painter: GanttChartPainter(
                ganttChart: widget.result.ganttChart,
                processes: widget.result.processes,
                totalTime: widget.result.totalTime,
                currentTime: widget.currentTime,
              ),
            ),
          ),
          
          // 图例
          if (widget.showDetails) ...[
            Divider(height: 1, color: AppTheme.glassBorder),
            _buildLegend(),
          ],
          
          // 就绪队列和事件日志
          if (widget.showDetails && widget.currentTime != null) ...[
            Divider(height: 1, color: AppTheme.glassBorder),
            _buildCurrentState(),
          ],
        ],
      ),
    );
  }
  
  Widget _buildLegend() {
    // 获取所有进程的颜色映射
    final colorMap = <int, Color>{};
    for (var process in widget.result.processes) {
      colorMap[process.pid] = _getProcessColor(process.pid);
    }
    
    return Container(
      padding: const EdgeInsets.all(12),
      child: Wrap(
        spacing: 16,
        runSpacing: 8,
        children: colorMap.entries.map((entry) {
          final process = widget.result.processes.firstWhere(
            (p) => p.pid == entry.key,
          );
          
          return Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 12,
                height: 12,
                decoration: BoxDecoration(
                  color: entry.value,
                  borderRadius: BorderRadius.circular(3),
                  boxShadow: [
                    BoxShadow(
                      color: entry.value.withOpacity(0.5),
                      blurRadius: 4,
                    )
                  ]
                ),
              ),
              const SizedBox(width: 8),
              Text(
                'P${entry.key} (${process.burstTime}ms)',
                style: AppTheme.darkTheme.textTheme.bodySmall,
              ),
            ],
          );
        }).toList(),
      ),
    );
  }
  
  Widget _buildCurrentState() {
    final snapshot = widget.result.getSnapshotAt(widget.currentTime!);
    if (snapshot == null) return const SizedBox.shrink();
    
    // 找到当前时间点的事件
    SchedulingEvent? currentEvent;
    for (var event in widget.result.events) {
      if (event.timestamp <= widget.currentTime!) {
        currentEvent = event;
      } else {
        break;
      }
    }
    
    return Container(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 当前运行进程
          Row(
            children: [
              Icon(Icons.play_circle_fill, color: AppTheme.accent, size: 20),
              const SizedBox(width: 8),
              Text(
                '运行中: ',
                style: TextStyle(color: AppTheme.textSecondary),
              ),
              Text(
                snapshot.runningPid != null ? "P${snapshot.runningPid}" : "IDLE",
                style: const TextStyle(
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                  fontFamily: AppTheme.codeFont,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          
          // 就绪队列
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.queue, color: AppTheme.primary, size: 20),
              const SizedBox(width: 8),
              Text(
                '就绪队列: ',
                style: TextStyle(color: AppTheme.textSecondary),
              ),
              Expanded(
                child: Text(
                  snapshot.readyQueue.isEmpty ? "Empty" : snapshot.readyQueue.map((pid) => "P$pid").join(" → "),
                  style: const TextStyle(
                    color: Colors.white,
                    fontFamily: AppTheme.codeFont,
                  ),
                ),
              ),
            ],
          ),
          
          // 当前事件描述
          if (currentEvent != null) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: _getEventColor(currentEvent.type).withOpacity(0.1),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                  color: _getEventColor(currentEvent.type).withOpacity(0.3),
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    _getEventIcon(currentEvent.type),
                    color: _getEventColor(currentEvent.type),
                    size: 16,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      currentEvent.description,
                      style: AppTheme.darkTheme.textTheme.bodySmall?.copyWith(
                        color: Colors.white.withOpacity(0.9),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
  
  Color _getProcessColor(int pid) {
    final colors = [
      AppTheme.primary,
      AppTheme.secondary,
      AppTheme.accent,
      Color(0xFFFF00FF), // Magenta
      Color(0xFFFF9900), // Orange
      Color(0xFF00BFFF), // Deep Sky Blue
    ];
    return colors[pid % colors.length];
  }
  
  Color _getEventColor(EventType type) {
    switch (type) {
      case EventType.arrival: return AppTheme.primary;
      case EventType.start: return AppTheme.accent;
      case EventType.preempt: return AppTheme.error;
      case EventType.complete: return AppTheme.textSecondary; // Greyish
      case EventType.contextSwitch: return AppTheme.secondary;
      case EventType.normal: return Colors.white54;
    }
  }
  
  IconData _getEventIcon(EventType type) {
    switch (type) {
      case EventType.arrival: return Icons.login;
      case EventType.start: return Icons.play_arrow;
      case EventType.preempt: return Icons.priority_high;
      case EventType.complete: return Icons.check_circle_outline;
      case EventType.contextSwitch: return Icons.swap_horiz;
      case EventType.normal: return Icons.info_outline;
    }
  }
}

/// 甘特图绘制器
class GanttChartPainter extends CustomPainter {
  final List<GanttItem> ganttChart;
  final List<Process> processes;
  final int totalTime;
  final int? currentTime;

  GanttChartPainter({
    required this.ganttChart,
    required this.processes,
    required this.totalTime,
    this.currentTime,
  });
  
  @override
  void paint(Canvas canvas, Size size) {
    if (ganttChart.isEmpty || totalTime == 0) return;
    
    final paint = Paint()..style = PaintingStyle.fill;
    
    // 计算尺寸参数
    final chartWidth = size.width - 60; // 留出左侧标签空间
    final chartHeight = size.height - 40; // 留出底部时间轴空间
    final timeScale = chartWidth / totalTime;
    final barHeight = math.min(36.0, chartHeight * 0.8);
    final barY = (chartHeight - barHeight) / 2;
    
    // 绘制背景网格
    _drawGrid(canvas, size, timeScale);
    
    // 绘制甘特图条
    for (var item in ganttChart) {
      final startX = 60 + item.startTime * timeScale;
      final width = item.duration * timeScale;
      
      // 动画效果：根据当前时间决定是否绘制
      if (currentTime != null && item.startTime > currentTime!) {
        continue; 
      }
      
      // 如果当前时间在这个条的中间，只绘制部分
      double actualWidth = width;
      if (currentTime != null && 
          item.startTime <= currentTime! && 
          currentTime! < item.endTime) {
        actualWidth = (currentTime! - item.startTime) * timeScale;
      }
      
      // 绘制进程条
      final color = _getProcessColor(item.pid);
      
      // Gradient Bar
      final rect = Rect.fromLTWH(startX, barY, actualWidth, barHeight);
      paint.shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [color, color.withOpacity(0.6)],
      ).createShader(rect);
      
      // Glow Effect for active bar
      // Only glow if it's the currently running one (end of drawn chart)
      if (currentTime != null && item.startTime <= currentTime! && item.endTime > currentTime!) {
         final glowPaint = Paint()
            ..color = color.withOpacity(0.6)
            ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 10);
         canvas.drawRect(rect, glowPaint);
      }
      
      final rrect = RRect.fromRectAndRadius(rect, const Radius.circular(6));
      canvas.drawRRect(rrect, paint);
      
      // Border
      final borderPaint = Paint()
        ..color = color.withOpacity(0.8)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1;
      canvas.drawRRect(rrect, borderPaint);
      
      // 绘制进程ID
      if (actualWidth > 24) {
        _drawText(
          canvas,
          'P${item.pid}',
          Offset(startX + actualWidth / 2, barY + barHeight / 2),
          Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.bold,
          fontFamily: AppTheme.codeFont,
        );
      }
      
      // 绘制时间标签
      if (width > 30) {
        _drawText(
          canvas,
          '${item.startTime}-${item.endTime}',
          Offset(startX + actualWidth / 2, barY + barHeight + 16),
          AppTheme.textSecondary,
          fontSize: 10,
          fontFamily: AppTheme.codeFont,
        );
      }
    }
    
    // 绘制当前时间线
    if (currentTime != null) {
      final currentX = 60 + currentTime! * timeScale;
      paint.shader = null;
      paint.color = AppTheme.error;
      paint.strokeWidth = 2;
      paint.style = PaintingStyle.stroke;
      
      // Neon Line
      final glowLinePaint = Paint()
         ..color = AppTheme.error.withOpacity(0.6)
         ..strokeWidth = 4
         ..style = PaintingStyle.stroke
         ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6);
         
      canvas.drawLine(Offset(currentX, 0), Offset(currentX, chartHeight), glowLinePaint);
      canvas.drawLine(Offset(currentX, 0), Offset(currentX, chartHeight), paint);
      
      // Stick marker at bottom
      _drawText(
        canvas,
        '$currentTime',
        Offset(currentX, chartHeight + 20),
        AppTheme.error,
        fontSize: 12,
        fontWeight: FontWeight.bold,
        fontFamily: AppTheme.codeFont,
      );
    }
    
    // 绘制时间轴
    _drawTimeAxis(canvas, size, timeScale);
  }
  
  void _drawGrid(Canvas canvas, Size size, double timeScale) {
    final paint = Paint()
      ..color = AppTheme.glassBorder.withOpacity(0.3)
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;
    
    final chartHeight = size.height - 40;
    
    // 绘制垂直网格线
    for (int i = 0; i <= totalTime; i += math.max(1, totalTime ~/ 20)) {
      final x = 60 + i * timeScale;
      // Dotted line effect (simplified by low opacity)
      canvas.drawLine(
        Offset(x, 0),
        Offset(x, chartHeight),
        paint,
      );
    }
    
    // 绘制水平基线
    paint.color = AppTheme.textSecondary;
    canvas.drawLine(
      Offset(60, chartHeight),
      Offset(size.width, chartHeight),
      paint,
    );
  }
  
  void _drawTimeAxis(Canvas canvas, Size size, double timeScale) {
    final chartHeight = size.height - 40;
    
    // 绘制时间刻度
    for (int i = 0; i <= totalTime; i += math.max(1, totalTime ~/ 10)) {
      final x = 60 + i * timeScale;
      
      _drawText(
        canvas,
        '$i',
        Offset(x, chartHeight + 20),
        AppTheme.textSecondary,
        fontSize: 10,
        fontFamily: AppTheme.codeFont,
      );
    }
  }
  
  void _drawText(
    Canvas canvas,
    String text,
    Offset center,
    Color color, {
    double fontSize = 12,
    FontWeight fontWeight = FontWeight.normal,
    String? fontFamily,
  }) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: color,
          fontSize: fontSize,
          fontWeight: fontWeight,
          fontFamily: fontFamily,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    
    textPainter.paint(
      canvas,
      center - Offset(textPainter.width / 2, textPainter.height / 2),
    );
  }
  
  Color _getProcessColor(int pid) {
    final colors = [
      AppTheme.primary,
      AppTheme.secondary,
      AppTheme.accent,
      Color(0xFFFF00FF), 
      Color(0xFFFF9900), 
      Color(0xFF00BFFF), 
    ];
    return colors[pid % colors.length];
  }
  
  @override
  bool shouldRepaint(covariant GanttChartPainter oldDelegate) {
    return oldDelegate.ganttChart != ganttChart ||
        oldDelegate.currentTime != currentTime ||
        oldDelegate.totalTime != totalTime;
  }
}

/// 进程队列可视化器
class ProcessQueueVisualizer extends StatelessWidget {
  final List<Process> processes;
  final List<int> readyQueue;
  final int? runningPid;
  final String title;
  
  const ProcessQueueVisualizer({
    Key? key,
    required this.processes,
    required this.readyQueue,
    this.runningPid,
    this.title = '就绪队列',
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: AppTheme.darkTheme.textTheme.titleMedium,
          ),
          const SizedBox(height: 12),
          
          if (readyQueue.isEmpty)
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.05),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppTheme.glassBorder),
              ),
              child: Center(
                child: Text(
                  '队列为空',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ),
            )
          else
            SizedBox(
              height: 70,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: readyQueue.length,
                separatorBuilder: (context, index) => Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: Icon(
                    Icons.arrow_forward_ios,
                    color: AppTheme.textSecondary.withOpacity(0.5),
                    size: 14,
                  ),
                ),
                itemBuilder: (context, index) {
                  final pid = readyQueue[index];
                  final process = processes.firstWhere((p) => p.pid == pid);
                  final isRunning = pid == runningPid;
                  
                  return Container(
                    width: 60,
                    margin: const EdgeInsets.symmetric(vertical: 5), // Space for shadow
                    decoration: BoxDecoration(
                      color: isRunning ? AppTheme.accent.withOpacity(0.2) : AppTheme.surface,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: isRunning ? AppTheme.accent : AppTheme.glassBorder,
                        width: isRunning ? 2 : 1,
                      ),
                      boxShadow: isRunning ? [
                        BoxShadow(
                          color: AppTheme.accent.withOpacity(0.3),
                          blurRadius: 8,
                          spreadRadius: 1,
                        )
                      ] : [],
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          'P$pid',
                          style: TextStyle(
                            color: isRunning ? AppTheme.accent : Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                            fontFamily: AppTheme.codeFont,
                          ),
                        ),
                        Text(
                          '${process.remainingTime}ms',
                          style: TextStyle(
                            color: AppTheme.textSecondary,
                            fontSize: 10,
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}
