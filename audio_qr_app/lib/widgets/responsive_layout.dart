import 'package:flutter/material.dart';

/// 自适应容器，根据屏幕大小调整内容
class AdaptiveContainer extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final double? maxWidth;
  final CrossAxisAlignment crossAxisAlignment;
  
  const AdaptiveContainer({
    super.key,
    required this.child,
    this.padding,
    this.maxWidth,
    this.crossAxisAlignment = CrossAxisAlignment.stretch,
  });
  
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        constraints: BoxConstraints(
          maxWidth: maxWidth ?? _getMaxWidth(context),
        ),
        padding: padding ?? _getDefaultPadding(context),
        child: child,
      ),
    );
  }
  
  double _getMaxWidth(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;
    
    if (screenWidth > 1200) return 800;  // 大屏幕
    if (screenWidth > 800) return 600;   // 中等屏幕
    if (screenWidth > 600) return 500;   // 小平板
    return double.infinity;              // 手机
  }
  
  EdgeInsetsGeometry _getDefaultPadding(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;
    
    if (screenWidth > 800) return const EdgeInsets.all(32);
    if (screenWidth > 600) return const EdgeInsets.all(24);
    return const EdgeInsets.all(16);
  }
}

/// 响应式网格布局
class ResponsiveGrid extends StatelessWidget {
  final List<Widget> children;
  final double spacing;
  final double runSpacing;
  final int? forceColumns;
  
  const ResponsiveGrid({
    super.key,
    required this.children,
    this.spacing = 16,
    this.runSpacing = 16,
    this.forceColumns,
  });
  
  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;
    
    int columns = forceColumns ?? _getColumnCount(screenWidth);
    
    if (columns == 1) {
      return Column(
        children: children.map((child) => Padding(
          padding: EdgeInsets.only(bottom: runSpacing),
          child: child,
        )).toList(),
      );
    }
    
    return Wrap(
      spacing: spacing,
      runSpacing: runSpacing,
      children: children.map((child) => SizedBox(
        width: (screenWidth - spacing * (columns - 1)) / columns,
        child: child,
      )).toList(),
    );
  }
  
  int _getColumnCount(double width) {
    if (width > 1200) return 3;
    if (width > 800) return 2;
    return 1;
  }
}

/// 自适应间距
class AdaptiveSpacing extends StatelessWidget {
  final double factor;
  
  const AdaptiveSpacing({super.key, this.factor = 1.0});
  
  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;
    
    double spacing = 16 * factor;
    if (screenWidth > 800) spacing = 24 * factor;
    if (screenWidth > 1200) spacing = 32 * factor;
    
    return SizedBox(height: spacing);
  }
}

/// 响应式文本大小
extension ResponsiveText on TextStyle {
  TextStyle responsive(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;
    double scaleFactor = 1.0;
    
    if (screenWidth > 1200) {
      scaleFactor = 1.2;
    } else if (screenWidth > 800) {
      scaleFactor = 1.1;
    } else if (screenWidth < 400) {
      scaleFactor = 0.9;
    }
    
    return copyWith(
      fontSize: (fontSize ?? 14) * scaleFactor,
    );
  }
}