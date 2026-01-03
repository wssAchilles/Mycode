// 排序可视化组件 - Academic Tech Dark 风格优化
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:collection/collection.dart';
import 'package:ml_platform/models/algorithm_model.dart';
import 'package:ml_platform/config/app_theme.dart';

class SortingVisualizer extends StatelessWidget {
  final SortingStep step;
  final AnimationController animationController;
  final AlgorithmType? algorithmType;

  const SortingVisualizer({
    Key? key,
    required this.step,
    required this.animationController,
    this.algorithmType,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        // 为归并排序创建特殊布局
        if (algorithmType == AlgorithmType.mergeSort && step.auxiliaryData != null) {
          return Column(
            children: [
              // 主数组
              Expanded(
                flex: 2,
                child: CustomPaint(
                  size: Size(constraints.maxWidth, constraints.maxHeight * 0.5),
                  painter: SortingPainter(
                    array: step.array,
                    comparing1: step.comparing1,
                    comparing2: step.comparing2,
                    swapping1: step.swapping1,
                    swapping2: step.swapping2,
                    highlightRange: step.highlightRange,
                    animation: animationController,
                  ),
                ),
              ),
              Divider(thickness: 1, color: AppTheme.glassBorder),
              // 辅助数组
              Expanded(
                flex: 1,
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppTheme.surface.withOpacity(0.3),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '辅助数组',
                        style: AppTheme.darkTheme.textTheme.bodySmall?.copyWith(
                          color: AppTheme.textSecondary,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Expanded(
                        child: CustomPaint(
                          size: Size(constraints.maxWidth, constraints.maxHeight * 0.3),
                          painter: AuxiliaryArrayPainter(
                            array: step.auxiliaryData!,
                            animation: animationController,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          );
        }
        
        // 常规可视化
        return CustomPaint(
          size: Size(constraints.maxWidth, constraints.maxHeight),
          painter: SortingPainter(
            array: step.array,
            comparing1: step.comparing1,
            comparing2: step.comparing2,
            swapping1: step.swapping1,
            swapping2: step.swapping2,
            highlightRange: step.highlightRange,
            heapBoundary: step.heapBoundary,
            sortedRange: step.sortedRange,
            animation: animationController,
          ),
        );
      },
    );
  }
}

class SortingPainter extends CustomPainter {
  final List<int> array;
  final int? comparing1;
  final int? comparing2;
  final int? swapping1;
  final int? swapping2;
  final List<int>? highlightRange;
  final int? heapBoundary;
  final List<int>? sortedRange;
  final List<int>? auxiliaryArray;
  final List<int>? mergePointers;
  final Animation<double> animation;

  SortingPainter({
    required this.array,
    this.comparing1,
    this.comparing2,
    this.swapping1,
    this.swapping2,
    this.highlightRange,
    this.heapBoundary,
    this.sortedRange,
    this.auxiliaryArray,
    this.mergePointers,
    required this.animation,
  }) : super(repaint: animation);

  @override
  void paint(Canvas canvas, Size size) {
    if (array.isEmpty) return;

    final barWidth = size.width / array.length;
    final maxValue = array.reduce(math.max);
    // 留出顶部空间给Value Labels
    final scaleFactor = (size.height * 0.85) / maxValue;

    // 绘制背景网格 (更微妙的 tech 风格)
    _drawGrid(canvas, size, barWidth);

    // 绘制柱状图
    for (int i = 0; i < array.length; i++) {
      final barHeight = array[i] * scaleFactor;
      final x = i * barWidth;
      final y = size.height - barHeight;

      // 确定柱子的颜色
      final barColor = _getBarColor(i);
      final isHighlighted = (i == comparing1 || i == comparing2 || i == swapping1 || i == swapping2);

      // 绘制柱子 (带渐变)
      final barRect = Rect.fromLTWH(
        x + barWidth * 0.15, // 增加一点间距
        y,
        barWidth * 0.7,
        barHeight,
      );

      final Paint paint = Paint()..style = PaintingStyle.fill;

      // 渐变填充
      paint.shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          barColor,
          barColor.withOpacity(0.3),
        ],
      ).createShader(barRect);

      // 如果是高亮状态，添加发光效果
      if (isHighlighted) {
        canvas.save();
        final glowPaint = Paint()
          ..color = barColor.withOpacity(0.6)
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8);
        canvas.drawRect(barRect, glowPaint);
        canvas.restore();
      }

      canvas.drawRRect(
        RRect.fromRectAndRadius(
          barRect,
          const Radius.circular(4),
        ),
        paint,
      );

      // 绘制顶部高亮线 (Neon Top)
      final topBorderPaint = Paint()
        ..color = barColor.withOpacity(0.9)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2;
        
      canvas.drawLine(
        Offset(barRect.left + 2, barRect.top), 
        Offset(barRect.right - 2, barRect.top), 
        topBorderPaint
      );

      // 绘制数值标签 (仅在柱子足够宽时显示)
      if (barWidth > 20) {
        _drawValueLabel(
          canvas,
          array[i].toString(),
          Offset(x + barWidth / 2, y - 12),
          barColor,
        );
      }

      // 绘制索引标签 (仅在柱子足够宽时显示，或间隔显示)
      if (barWidth > 15 || (i % 5 == 0)) {
        _drawIndexLabel(
          canvas,
          i.toString(),
          Offset(x + barWidth / 2, size.height + 10),
        );
      }
    }

    // 绘制交换动画
    if (swapping1 != null && swapping2 != null) {
      _drawSwapAnimation(canvas, size, barWidth, scaleFactor);
    }
    
    // 绘制堆边界线
    if (heapBoundary != null && heapBoundary! > 0 && heapBoundary! < array.length) {
      _drawHeapBoundary(canvas, size, barWidth);
    }
  }

  Color _getBarColor(int index) {
    // 已排序的元素 - Neon Green
    if (sortedRange != null && 
        sortedRange!.length == 2 && 
        index >= sortedRange![0] && 
        index <= sortedRange![1]) {
      return AppTheme.accent;
    }
    // 交换中的元素 - Error Red (Neon)
    if (index == swapping1 || index == swapping2) {
      return AppTheme.error;
    }
    // 比较中的元素 - Warning Orange (Neon)
    else if (index == comparing1 || index == comparing2) {
      return Colors.orangeAccent;
    }
    // 高亮范围内的元素 - Secondary Purple
    else if (highlightRange != null && 
             highlightRange!.length == 2 && 
             index >= highlightRange![0] && 
             index <= highlightRange![1]) {
      return AppTheme.secondary;
    }
    // 堆内元素 - Primary Cyan
    else if (heapBoundary != null && index < heapBoundary!) {
      return AppTheme.primary;
    }
    // 堆外元素（已排序） - Accent Green
    else if (heapBoundary != null && index >= heapBoundary!) {
      return AppTheme.accent;
    }
    // 默认颜色 - Primary Cyan with reduced opacity
    else {
      return AppTheme.primary.withOpacity(0.7);
    }
  }

  void _drawGrid(Canvas canvas, Size size, double barWidth) {
    final paint = Paint()
      ..color = AppTheme.glassBorder.withOpacity(0.3)
      ..strokeWidth = 0.5;

    // 绘制水平线 (每20%高度)
    for (int i = 1; i <= 5; i++) {
      final y = size.height * (i / 5);
      canvas.drawLine(
        Offset(0, y),
        Offset(size.width, y),
        paint,
      );
    }
  }

  void _drawValueLabel(Canvas canvas, String text, Offset position, Color color) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: color.withOpacity(0.9),
          fontSize: 10,
          fontWeight: FontWeight.bold,
          fontFamily: AppTheme.codeFont, // Fira Code
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();

    textPainter.paint(
      canvas,
      position - Offset(textPainter.width / 2, textPainter.height),
    );
  }

  void _drawIndexLabel(Canvas canvas, String text, Offset position) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: AppTheme.textSecondary,
          fontSize: 9,
          fontFamily: AppTheme.codeFont,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();

    textPainter.paint(
      canvas,
      position - Offset(textPainter.width / 2, 0),
    );
  }

  void _drawSwapAnimation(Canvas canvas, Size size, double barWidth, double scaleFactor) {
    if (animation.value == 0) return;

    final paint = Paint()
      ..color = AppTheme.error.withOpacity(0.8)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;

    // 绘制交换弧线
    final x1 = swapping1! * barWidth + barWidth / 2;
    final x2 = swapping2! * barWidth + barWidth / 2;
    final midX = (x1 + x2) / 2;
    // 弧线高度随距离变化
    final arcHeight = 40.0 + (x2 - x1).abs() * 0.1;
    final midY = size.height / 2 - arcHeight * animation.value;

    final path = Path()
      ..moveTo(x1, size.height / 2)
      ..quadraticBezierTo(midX, midY, x2, size.height / 2);

    canvas.drawPath(path, paint);

    // 绘制箭头
    final arrowPaint = Paint()
      ..color = AppTheme.error
      ..style = PaintingStyle.fill;

    // 箭头大小
    const double arrowSize = 6.0;

    // 左箭头
    canvas.save();
    canvas.translate(x1, size.height / 2);
    // 简化的箭头绘制
    canvas.drawCircle(Offset.zero, 3, arrowPaint);
    canvas.restore();

    // 右箭头
    canvas.save();
    canvas.translate(x2, size.height / 2);
    canvas.drawCircle(Offset.zero, 3, arrowPaint);
    canvas.restore();
  }

  void _drawHeapBoundary(Canvas canvas, Size size, double barWidth) {
    if (heapBoundary == null) return;
    
    final x = heapBoundary! * barWidth;
    final paint = Paint()
      ..color = AppTheme.secondary
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke; // Dashed line effect manually if needed, but solid is fine
    
    // 绘制分界线
    canvas.drawLine(
      Offset(x, 0),
      Offset(x, size.height),
      paint,
    );
    
    // 绘制 neon glow for line
    final glowPaint = Paint()
      ..color = AppTheme.secondary.withOpacity(0.5)
      ..strokeWidth = 6
      ..style = PaintingStyle.stroke
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4);
      
    canvas.drawLine(
      Offset(x, 0),
      Offset(x, size.height),
      glowPaint,
    );
    
    // 绘制标签
    final textPainter = TextPainter(
      text: TextSpan(
        text: 'Heap Boundary',
        style: TextStyle(
          color: AppTheme.secondary,
          fontSize: 10,
          fontWeight: FontWeight.bold,
          fontFamily: AppTheme.bodyFont,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    
    textPainter.paint(
      canvas,
      Offset(x + 5, 5),
    );
  }

  @override
  bool shouldRepaint(covariant SortingPainter oldDelegate) {
     return !const DeepCollectionEquality().equals(oldDelegate.array, array) ||
        oldDelegate.comparing1 != comparing1 ||
        oldDelegate.comparing2 != comparing2 ||
        oldDelegate.swapping1 != swapping1 ||
        oldDelegate.swapping2 != swapping2 ||
        !const DeepCollectionEquality().equals(oldDelegate.highlightRange, highlightRange) ||
        !const DeepCollectionEquality().equals(oldDelegate.sortedRange, sortedRange) ||
        !const DeepCollectionEquality().equals(oldDelegate.auxiliaryArray, auxiliaryArray) ||
        !const DeepCollectionEquality().equals(oldDelegate.mergePointers, mergePointers) ||
        oldDelegate.heapBoundary != heapBoundary ||
        oldDelegate.animation.value != animation.value; // Important for animation
  }
}

// 辅助数组画家类（用于归并排序）
class AuxiliaryArrayPainter extends CustomPainter {
  final List<int> array;
  final Animation<double> animation;

  AuxiliaryArrayPainter({
    required this.array,
    required this.animation,
  }) : super(repaint: animation);

  @override
  void paint(Canvas canvas, Size size) {
    if (array.isEmpty) return;

    final barWidth = size.width / array.length;
    final maxValue = array.isNotEmpty ? array.reduce(math.max) : 1;
    final scaleFactor = (size.height * 0.8) / maxValue;

    for (int i = 0; i < array.length; i++) {
      final barHeight = array[i] * scaleFactor;
      final x = i * barWidth;
      final y = size.height - barHeight;

      // 绘制柱子
      final barRect = Rect.fromLTWH(
        x + barWidth * 0.15,
        y,
        barWidth * 0.7,
        barHeight,
      );

      final paint = Paint()
        ..color = AppTheme.secondary.withOpacity(0.8)
        ..style = PaintingStyle.fill;
        
      // Gradient for auxiliary array
      paint.shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          AppTheme.secondary,
          AppTheme.secondary.withOpacity(0.3),
        ],
      ).createShader(barRect);

      canvas.drawRRect(
        RRect.fromRectAndRadius(
          barRect,
          const Radius.circular(2),
        ),
        paint,
      );

      // 绘制数值
      if (barWidth > 15) {
        final textPainter = TextPainter(
          text: TextSpan(
            text: array[i].toString(),
            style: TextStyle(
              color: Colors.white.withOpacity(0.8),
              fontSize: 9,
              fontFamily: AppTheme.codeFont,
            ),
          ),
          textDirection: TextDirection.ltr,
        )..layout();

        textPainter.paint(
          canvas,
          Offset(x + barWidth / 2 - textPainter.width / 2, y - 12),
        );
      }
    }
  }

  @override
  bool shouldRepaint(covariant AuxiliaryArrayPainter oldDelegate) {
    return !const DeepCollectionEquality().equals(oldDelegate.array, array);
  }
}
