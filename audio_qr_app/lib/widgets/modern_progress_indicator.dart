import 'package:flutter/material.dart';
import 'dart:math' as math;

/// 现代化进度指示器 - 增强UI版本
class ModernProgressIndicator extends StatefulWidget {
  final double? value;
  final String? label;
  final String? description;
  final Color? color;
  final double size;
  final double strokeWidth;
  final bool showPercentage;
  
  const ModernProgressIndicator({
    super.key,
    this.value,
    this.label,
    this.description,
    this.color,
    this.size = 100,
    this.strokeWidth = 8,
    this.showPercentage = false,
  });
  
  @override
  State<ModernProgressIndicator> createState() => _ModernProgressIndicatorState();
}

class _ModernProgressIndicatorState extends State<ModernProgressIndicator>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;
  
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 1500),
      vsync: this,
    );
    
    _animation = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeInOut,
    );
    
    if (widget.value == null) {
      _controller.repeat();
    } else {
      _controller.animateTo(widget.value!);
    }
  }
  
  @override
  void didUpdateWidget(ModernProgressIndicator oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.value != oldWidget.value) {
      if (widget.value == null) {
        _controller.repeat();
      } else {
        _controller.animateTo(widget.value!);
      }
    }
  }
  
  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final progressColor = widget.color ?? theme.colorScheme.primary;
    
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: widget.size,
          height: widget.size,
          child: AnimatedBuilder(
            animation: _animation,
            builder: (context, child) {
              return CustomPaint(
                painter: _ModernProgressPainter(
                  progress: widget.value ?? _animation.value,
                  color: progressColor,
                  backgroundColor: theme.colorScheme.surfaceContainerHighest,
                  strokeWidth: widget.strokeWidth,
                  isIndeterminate: widget.value == null,
                ),
                child: widget.showPercentage && widget.value != null
                    ? Center(
                        child: Text(
                          '${(widget.value! * 100).round()}%',
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                            color: progressColor,
                          ),
                        ),
                      )
                    : const SizedBox.shrink(),
              );
            },
          ),
        ),
        if (widget.label != null) ...[
          const SizedBox(height: 16),
          Text(
            widget.label!,
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
            textAlign: TextAlign.center,
          ),
        ],
        if (widget.description != null) ...[
          const SizedBox(height: 8),
          Text(
            widget.description!,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ],
    );
  }
}

class _ModernProgressPainter extends CustomPainter {
  final double progress;
  final Color color;
  final Color backgroundColor;
  final double strokeWidth;
  final bool isIndeterminate;
  
  _ModernProgressPainter({
    required this.progress,
    required this.color,
    required this.backgroundColor,
    required this.strokeWidth,
    required this.isIndeterminate,
  });
  
  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.width - strokeWidth) / 2;
    
    // 背景圆环
    final backgroundPaint = Paint()
      ..color = backgroundColor
      ..strokeWidth = strokeWidth
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;
    
    canvas.drawCircle(center, radius, backgroundPaint);
    
    // 进度圆环
    final progressPaint = Paint()
      ..shader = LinearGradient(
        colors: [
          color,
          color.withOpacity(0.7),
        ],
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
      ).createShader(Rect.fromCircle(center: center, radius: radius))
      ..strokeWidth = strokeWidth
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;
    
    if (isIndeterminate) {
      // 不确定进度动画
      final sweepAngle = math.pi / 3;
      final startAngle = -math.pi / 2 + (progress * 2 * math.pi);
      
      canvas.drawArc(
        Rect.fromCircle(center: center, radius: radius),
        startAngle,
        sweepAngle,
        false,
        progressPaint,
      );
    } else {
      // 确定进度
      final sweepAngle = 2 * math.pi * progress;
      const startAngle = -math.pi / 2;
      
      canvas.drawArc(
        Rect.fromCircle(center: center, radius: radius),
        startAngle,
        sweepAngle,
        false,
        progressPaint,
      );
    }
  }
  
  @override
  bool shouldRepaint(covariant _ModernProgressPainter oldDelegate) {
    return oldDelegate.progress != progress ||
           oldDelegate.color != color ||
           oldDelegate.isIndeterminate != isIndeterminate;
  }
}

/// 线性进度条
class ModernLinearProgressIndicator extends StatefulWidget {
  final double? value;
  final String? label;
  final Color? color;
  final double height;
  final bool showPercentage;
  
  const ModernLinearProgressIndicator({
    super.key,
    this.value,
    this.label,
    this.color,
    this.height = 8,
    this.showPercentage = false,
  });
  
  @override
  State<ModernLinearProgressIndicator> createState() => _ModernLinearProgressIndicatorState();
}

class _ModernLinearProgressIndicatorState extends State<ModernLinearProgressIndicator>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;
  
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 1000),
      vsync: this,
    );
    
    _animation = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeInOut,
    );
    
    if (widget.value != null) {
      _controller.animateTo(widget.value!);
    }
  }
  
  @override
  void didUpdateWidget(ModernLinearProgressIndicator oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.value != oldWidget.value && widget.value != null) {
      _controller.animateTo(widget.value!);
    }
  }
  
  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final progressColor = widget.color ?? theme.colorScheme.primary;
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.label != null || widget.showPercentage) ...[
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              if (widget.label != null)
                Text(
                  widget.label!,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w500,
                  ),
                ),
              if (widget.showPercentage && widget.value != null)
                Text(
                  '${(widget.value! * 100).round()}%',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: progressColor,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
        ],
        Container(
          height: widget.height,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(widget.height / 2),
            color: theme.colorScheme.surfaceContainerHighest,
          ),
          child: AnimatedBuilder(
            animation: _animation,
            builder: (context, child) {
              return LinearProgressIndicator(
                value: widget.value != null ? _animation.value : null,
                backgroundColor: Colors.transparent,
                valueColor: AlwaysStoppedAnimation(progressColor),
                borderRadius: BorderRadius.circular(widget.height / 2),
              );
            },
          ),
        ),
      ],
    );
  }
}