import 'package:flutter/material.dart';
import '../../config/app_theme.dart';

/// 响应式内容容器
/// - 限制最大宽度，保证大屏阅读舒适度
/// - 统一左右内边距
class ResponsiveContainer extends StatelessWidget {
  final Widget child;
  final double maxWidth;
  final EdgeInsetsGeometry padding;
  final Alignment alignment;

  const ResponsiveContainer({
    Key? key,
    required this.child,
    this.maxWidth = 1200,
    this.padding = const EdgeInsets.symmetric(
      horizontal: AppSpacing.lg,
      vertical: AppSpacing.lg,
    ),
    this.alignment = Alignment.topCenter,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: alignment,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Padding(
          padding: padding,
          child: child,
        ),
      ),
    );
  }
}
