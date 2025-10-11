// 甘特图可视化组件
import 'package:flutter/material.dart';
import 'dart:math' as math;
import 'package:ml_platform/models/os/process_model.dart';

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
    this.height = 200,
  }) : super(key: key);
  
  @override
  State<GanttChartVisualizer> createState() => _GanttChartVisualizerState();
}

class _GanttChartVisualizerState extends State<GanttChartVisualizer> {
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
              color: theme.primaryColor.withOpacity(0.1),
              border: Border(
                bottom: BorderSide(color: theme.dividerColor),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '甘特图 - ${widget.result.algorithm.label}',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                if (widget.currentTime != null)
                  Chip(
                    label: Text('时间: ${widget.currentTime}'),
                    backgroundColor: theme.primaryColor.withOpacity(0.2),
                  ),
              ],
            ),
          ),
          
          // 甘特图主体
          Container(
            height: widget.height,
            padding: const EdgeInsets.all(16),
            child: AnimatedBuilder(
              animation: widget.animationController,
              builder: (context, child) {
                return CustomPaint(
                  size: Size.infinite,
                  painter: GanttChartPainter(
                    ganttChart: widget.result.ganttChart,
                    processes: widget.result.processes,
                    totalTime: widget.result.totalTime,
                    currentTime: widget.currentTime,
                    animation: widget.animationController,
                  ),
                );
              },
            ),
          ),
          
          // 图例
          if (widget.showDetails) ...[
            const Divider(height: 1),
            _buildLegend(theme),
          ],
          
          // 就绪队列和事件日志
          if (widget.showDetails && widget.currentTime != null) ...[
            const Divider(height: 1),
            _buildCurrentState(theme),
          ],
        ],
      ),
    );
  }
  
  Widget _buildLegend(ThemeData theme) {
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
                width: 20,
                height: 20,
                decoration: BoxDecoration(
                  color: entry.value,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
              const SizedBox(width: 4),
              Text(
                'P${entry.key} (${process.burstTime}ms)',
                style: theme.textTheme.bodySmall,
              ),
            ],
          );
        }).toList(),
      ),
    );
  }
  
  Widget _buildCurrentState(ThemeData theme) {
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
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 当前运行进程
          Row(
            children: [
              Icon(Icons.play_arrow, color: Colors.green, size: 20),
              const SizedBox(width: 8),
              Text(
                '运行中: ${snapshot.runningPid != null ? "P${snapshot.runningPid}" : "空闲"}',
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          
          // 就绪队列
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.queue, color: Colors.blue, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '就绪队列: ${snapshot.readyQueue.isEmpty ? "空" : snapshot.readyQueue.map((pid) => "P$pid").join(" → ")}',
                  style: theme.textTheme.bodyMedium,
                ),
              ),
            ],
          ),
          
          // 已完成进程
          if (snapshot.completedPids.isNotEmpty) ...[
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.check_circle, color: Colors.grey, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '已完成: ${snapshot.completedPids.map((pid) => "P$pid").join(", ")}',
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
              ],
            ),
          ],
          
          // 当前事件描述
          if (currentEvent != null) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: _getEventColor(currentEvent.type).withOpacity(0.1),
                borderRadius: BorderRadius.circular(4),
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
                      style: theme.textTheme.bodySmall,
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
      Colors.blue,
      Colors.green,
      Colors.orange,
      Colors.purple,
      Colors.red,
      Colors.teal,
      Colors.indigo,
      Colors.amber,
    ];
    return colors[pid % colors.length];
  }
  
  Color _getEventColor(EventType type) {
    switch (type) {
      case EventType.arrival:
        return Colors.blue;
      case EventType.start:
        return Colors.green;
      case EventType.preempt:
        return Colors.orange;
      case EventType.complete:
        return Colors.grey;
      case EventType.contextSwitch:
        return Colors.purple;
      case EventType.normal:
        return Colors.black54;
    }
  }
  
  IconData _getEventIcon(EventType type) {
    switch (type) {
      case EventType.arrival:
        return Icons.login;
      case EventType.start:
        return Icons.play_arrow;
      case EventType.preempt:
        return Icons.swap_horiz;
      case EventType.complete:
        return Icons.check_circle;
      case EventType.contextSwitch:
        return Icons.swap_vert;
      case EventType.normal:
        return Icons.info_outline;
    }
  }
}

/// 甘特图绘制器
class GanttChartPainter extends CustomPainter {
  final List<GanttItem> ganttChart;
  final List<Process> processes;
  final int totalTime;
  final int? currentTime;
  final Animation<double> animation;
  
  GanttChartPainter({
    required this.ganttChart,
    required this.processes,
    required this.totalTime,
    this.currentTime,
    required this.animation,
  }) : super(repaint: animation);
  
  @override
  void paint(Canvas canvas, Size size) {
    if (ganttChart.isEmpty || totalTime == 0) return;
    
    final paint = Paint()..style = PaintingStyle.fill;
    
    // 计算尺寸参数
    final chartWidth = size.width - 60; // 留出左侧标签空间
    final chartHeight = size.height - 40; // 留出底部时间轴空间
    final timeScale = chartWidth / totalTime;
    final barHeight = math.min(40.0, chartHeight * 0.8);
    final barY = (chartHeight - barHeight) / 2;
    
    // 绘制背景网格
    _drawGrid(canvas, size, timeScale);
    
    // 绘制甘特图条
    for (var item in ganttChart) {
      final startX = 60 + item.startTime * timeScale;
      final width = item.duration * timeScale;
      
      // 动画效果：根据当前时间决定是否绘制
      if (currentTime != null && item.startTime > currentTime!) {
        continue; // 还未到达的时间段不绘制
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
      paint.color = color;
      
      final rect = RRect.fromRectAndRadius(
        Rect.fromLTWH(startX, barY, actualWidth, barHeight),
        const Radius.circular(4),
      );
      
      canvas.drawRRect(rect, paint);
      
      // 绘制进程ID
      if (actualWidth > 20) {
        _drawText(
          canvas,
          'P${item.pid}',
          Offset(startX + actualWidth / 2, barY + barHeight / 2),
          Colors.white,
          fontSize: 14,
          fontWeight: FontWeight.bold,
        );
      }
      
      // 绘制时间标签
      if (width > 30) {
        _drawText(
          canvas,
          '${item.startTime}-${item.endTime}',
          Offset(startX + actualWidth / 2, barY + barHeight + 15),
          Colors.black54,
          fontSize: 10,
        );
      }
    }
    
    // 绘制当前时间线
    if (currentTime != null) {
      final currentX = 60 + currentTime! * timeScale;
      paint.color = Colors.red;
      paint.strokeWidth = 2;
      paint.style = PaintingStyle.stroke;
      
      canvas.drawLine(
        Offset(currentX, 0),
        Offset(currentX, chartHeight),
        paint,
      );
      
      // 绘制时间标签
      _drawText(
        canvas,
        '$currentTime',
        Offset(currentX, chartHeight + 20),
        Colors.red,
        fontSize: 12,
        fontWeight: FontWeight.bold,
      );
    }
    
    // 绘制时间轴
    _drawTimeAxis(canvas, size, timeScale);
  }
  
  void _drawGrid(Canvas canvas, Size size, double timeScale) {
    final paint = Paint()
      ..color = Colors.grey.shade300
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;
    
    final chartHeight = size.height - 40;
    
    // 绘制垂直网格线
    for (int i = 0; i <= totalTime; i += math.max(1, totalTime ~/ 20)) {
      final x = 60 + i * timeScale;
      canvas.drawLine(
        Offset(x, 0),
        Offset(x, chartHeight),
        paint,
      );
    }
    
    // 绘制水平基线
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
        Colors.black87,
        fontSize: 11,
      );
    }
    
    // 绘制时间轴标签
    _drawText(
      canvas,
      '时间',
      Offset(size.width / 2, size.height - 5),
      Colors.black87,
      fontSize: 12,
    );
  }
  
  void _drawText(
    Canvas canvas,
    String text,
    Offset center,
    Color color, {
    double fontSize = 12,
    FontWeight fontWeight = FontWeight.normal,
  }) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: color,
          fontSize: fontSize,
          fontWeight: fontWeight,
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
      Colors.blue,
      Colors.green,
      Colors.orange,
      Colors.purple,
      Colors.red,
      Colors.teal,
      Colors.indigo,
      Colors.amber,
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
    final theme = Theme.of(context);
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            
            if (readyQueue.isEmpty)
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.grey.shade100,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Center(
                  child: Text(
                    '队列为空',
                    style: TextStyle(
                      color: Colors.grey.shade600,
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                ),
              )
            else
              Container(
                height: 60,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: readyQueue.length,
                  separatorBuilder: (context, index) => Icon(
                    Icons.arrow_forward,
                    color: Colors.grey.shade400,
                    size: 20,
                  ),
                  itemBuilder: (context, index) {
                    final pid = readyQueue[index];
                    final process = processes.firstWhere((p) => p.pid == pid);
                    final isRunning = pid == runningPid;
                    
                    return Container(
                      width: 60,
                      height: 60,
                      decoration: BoxDecoration(
                        color: isRunning ? Colors.green : Colors.blue,
                        borderRadius: BorderRadius.circular(8),
                        boxShadow: [
                          if (isRunning)
                            BoxShadow(
                              color: Colors.green.withOpacity(0.4),
                              blurRadius: 8,
                              spreadRadius: 2,
                            ),
                        ],
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            'P$pid',
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 16,
                            ),
                          ),
                          Text(
                            '${process.remainingTime}ms',
                            style: const TextStyle(
                              color: Colors.white70,
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
      ),
    );
  }
}
