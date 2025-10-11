// 排序可视化组件
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:collection/collection.dart';
import 'package:ml_platform/models/algorithm_model.dart';

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
              const Divider(thickness: 2),
              // 辅助数组
              Expanded(
                flex: 1,
                child: Container(
                  padding: const EdgeInsets.all(8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '辅助数组',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: Colors.grey[600],
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
    final scaleFactor = (size.height * 0.9) / maxValue;

    // 绘制背景网格
    _drawGrid(canvas, size);

    // 绘制柱状图
    for (int i = 0; i < array.length; i++) {
      final barHeight = array[i] * scaleFactor;
      final x = i * barWidth;
      final y = size.height - barHeight;

      // 确定柱子的颜色
      Color barColor = _getBarColor(i);

      // 绘制柱子
      final barRect = Rect.fromLTWH(
        x + barWidth * 0.1,
        y,
        barWidth * 0.8,
        barHeight,
      );

      // 绘制柱子主体
      final paint = Paint()
        ..color = barColor
        ..style = PaintingStyle.fill;

      canvas.drawRRect(
        RRect.fromRectAndRadius(
          barRect,
          const Radius.circular(4),
        ),
        paint,
      );

      // 绘制柱子边框
      final borderPaint = Paint()
        ..color = barColor.withOpacity(0.8)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2;

      canvas.drawRRect(
        RRect.fromRectAndRadius(
          barRect,
          const Radius.circular(4),
        ),
        borderPaint,
      );

      // 绘制数值标签
      _drawValueLabel(
        canvas,
        array[i].toString(),
        Offset(x + barWidth / 2, y - 10),
        barColor,
      );

      // 绘制索引标签
      _drawIndexLabel(
        canvas,
        i.toString(),
        Offset(x + barWidth / 2, size.height + 15),
      );
    }

    // 绘制比较指示器
    if (comparing1 != null || comparing2 != null) {
      _drawComparisonIndicators(canvas, size, barWidth);
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
    // 已排序的元素 - 绿色
    if (sortedRange != null && 
        sortedRange!.length == 2 && 
        index >= sortedRange![0] && 
        index <= sortedRange![1]) {
      return Colors.green;
    }
    // 交换中的元素 - 红色
    if (index == swapping1 || index == swapping2) {
      return Colors.red;
    }
    // 比较中的元素 - 橙色
    else if (index == comparing1 || index == comparing2) {
      return Colors.orange;
    }
    // 高亮范围内的元素 - 紫色
    else if (highlightRange != null && 
             highlightRange!.length == 2 && 
             index >= highlightRange![0] && 
             index <= highlightRange![1]) {
      return Colors.purple.shade400;
    }
    // 堆内元素 - 蓝色
    else if (heapBoundary != null && index < heapBoundary!) {
      return Colors.blue;
    }
    // 堆外元素（已排序） - 绿色
    else if (heapBoundary != null && index >= heapBoundary!) {
      return Colors.green;
    }
    // 默认颜色 - 蓝色
    else {
      return Colors.blue;
    }
  }

  void _drawGrid(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.grey.withOpacity(0.1)
      ..strokeWidth = 1;

    // 绘制水平线
    for (int i = 1; i <= 10; i++) {
      final y = size.height * (i / 10);
      canvas.drawLine(
        Offset(0, y),
        Offset(size.width, y),
        paint,
      );
    }

    // 绘制垂直线
    final verticalLines = math.min(array.length, 20);
    final spacing = size.width / verticalLines;
    for (int i = 1; i < verticalLines; i++) {
      final x = spacing * i;
      canvas.drawLine(
        Offset(x, 0),
        Offset(x, size.height),
        paint,
      );
    }
  }

  void _drawValueLabel(Canvas canvas, String text, Offset position, Color color) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: color.computeLuminance() > 0.5 ? Colors.black : Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.bold,
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
          color: Colors.grey[600],
          fontSize: 10,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();

    textPainter.paint(
      canvas,
      position - Offset(textPainter.width / 2, 0),
    );
  }

  void _drawComparisonIndicators(Canvas canvas, Size size, double barWidth) {
    final paint = Paint()
      ..color = Colors.orange.withOpacity(0.3)
      ..style = PaintingStyle.fill;

    if (comparing1 != null) {
      final x = comparing1! * barWidth;
      canvas.drawRect(
        Rect.fromLTWH(x, 0, barWidth, size.height),
        paint,
      );
    }

    if (comparing2 != null) {
      final x = comparing2! * barWidth;
      canvas.drawRect(
        Rect.fromLTWH(x, 0, barWidth, size.height),
        paint,
      );
    }
  }

  void _drawSwapAnimation(Canvas canvas, Size size, double barWidth, double scaleFactor) {
    if (animation.value == 0) return;

    final paint = Paint()
      ..color = Colors.red.withOpacity(0.5)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3;

    // 绘制交换弧线
    final x1 = swapping1! * barWidth + barWidth / 2;
    final x2 = swapping2! * barWidth + barWidth / 2;
    final midX = (x1 + x2) / 2;
    final midY = size.height / 2 - 50 * animation.value;

    final path = Path()
      ..moveTo(x1, size.height / 2)
      ..quadraticBezierTo(midX, midY, x2, size.height / 2);

    canvas.drawPath(path, paint);

    // 绘制箭头
    final arrowPaint = Paint()
      ..color = Colors.red
      ..style = PaintingStyle.fill;

    // 左箭头
    canvas.save();
    canvas.translate(x1, size.height / 2);
    canvas.rotate(-math.pi / 4);
    canvas.drawPath(
      Path()
        ..moveTo(0, 0)
        ..lineTo(-8, -4)
        ..lineTo(-8, 4)
        ..close(),
      arrowPaint,
    );
    canvas.restore();

    // 右箭头
    canvas.save();
    canvas.translate(x2, size.height / 2);
    canvas.rotate(math.pi / 4);
    canvas.drawPath(
      Path()
        ..moveTo(0, 0)
        ..lineTo(8, -4)
        ..lineTo(8, 4)
        ..close(),
      arrowPaint,
    );
    canvas.restore();
  }

  void _drawHeapBoundary(Canvas canvas, Size size, double barWidth) {
    if (heapBoundary == null) return;
    
    final x = heapBoundary! * barWidth;
    final paint = Paint()
      ..color = Colors.red.shade400
      ..strokeWidth = 3
      ..style = PaintingStyle.stroke;
    
    // 绘制分界线
    canvas.drawLine(
      Offset(x, 0),
      Offset(x, size.height),
      paint,
    );
    
    // 绘制标签
    final textPainter = TextPainter(
      text: TextSpan(
        text: '堆边界',
        style: TextStyle(
          color: Colors.red.shade400,
          fontSize: 12,
          fontWeight: FontWeight.bold,
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
        oldDelegate.heapBoundary != heapBoundary;
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
        x + barWidth * 0.1,
        y,
        barWidth * 0.8,
        barHeight,
      );

      final paint = Paint()
        ..color = Colors.purple.shade300
        ..style = PaintingStyle.fill;

      canvas.drawRRect(
        RRect.fromRectAndRadius(
          barRect,
          const Radius.circular(2),
        ),
        paint,
      );

      // 绘制数值
      final textPainter = TextPainter(
        text: TextSpan(
          text: array[i].toString(),
          style: const TextStyle(
            color: Colors.white,
            fontSize: 10,
            fontWeight: FontWeight.bold,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();

      textPainter.paint(
        canvas,
        Offset(x + barWidth / 2 - textPainter.width / 2, y - 15),
      );
    }
  }

  @override
  bool shouldRepaint(covariant AuxiliaryArrayPainter oldDelegate) {
    return !const DeepCollectionEquality().equals(oldDelegate.array, array);
  }
}
