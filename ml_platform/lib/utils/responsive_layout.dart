import 'package:flutter/material.dart';

/// 响应式布局工具类
/// 用于处理不同屏幕尺寸的各个界面的布局适配
class ResponsiveLayout extends StatelessWidget {
  final Widget mobile;
  final Widget? tablet;
  final Widget desktop;

  const ResponsiveLayout({
    Key? key,
    required this.mobile,
    this.tablet,
    required this.desktop,
  }) : super(key: key);

  // 屏幕断点
  static const double mobileBreakpoint = 600;
  static const double tabletBreakpoint = 1100;

  /// 判断是否为移动端
  static bool isMobile(BuildContext context) =>
      MediaQuery.of(context).size.width < mobileBreakpoint;

  /// 判断是否为平板端
  static bool isTablet(BuildContext context) =>
      MediaQuery.of(context).size.width >= mobileBreakpoint &&
      MediaQuery.of(context).size.width < tabletBreakpoint;

  /// 判断是否为桌面端
  static bool isDesktop(BuildContext context) =>
      MediaQuery.of(context).size.width >= tabletBreakpoint;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= tabletBreakpoint) {
          return desktop;
        } else if (constraints.maxWidth >= mobileBreakpoint) {
          return tablet ?? desktop;
        } else {
          return mobile;
        }
      },
    );
  }
}
