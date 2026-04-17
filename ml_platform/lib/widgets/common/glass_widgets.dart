import 'dart:ui';
import 'package:flutter/material.dart';
import '../../config/app_theme.dart';

/// 基础毛玻璃容器
/// 支持自定义模糊度、不透明度、渐变边框和圆角
class GlassContainer extends StatelessWidget {
  final Widget child;
  final double width;
  final double? height;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final BorderRadius borderRadius; // 改为 BorderRadius 类型
  final double blur;
  final double opacity;
  final Color? color;
  final Color? borderColor;
  final List<Color>? gradientColors;
  final VoidCallback? onTap;

  const GlassContainer({
    Key? key,
    required this.child,
    this.width = double.infinity,
    this.height,
    this.padding = const EdgeInsets.all(16),
    this.margin,
    this.borderRadius = const BorderRadius.all(Radius.circular(16)), // 默认圆角
    this.blur = 10.0,
    this.opacity = 0.1, // 降低默认不透明度以增强通透感
    this.color,
    this.borderColor,
    this.gradientColors,
    this.onTap,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final effectiveBorderColor = borderColor ?? AppTheme.glassBorder;
    
    Widget container = ClipRRect(
      borderRadius: borderRadius,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
        child: Container(
          width: width,
          height: height,
          padding: padding,
          decoration: BoxDecoration(
            color: (color ?? AppTheme.surface).withOpacity(opacity),
            borderRadius: borderRadius,
            border: Border.all(
              color: effectiveBorderColor,
              width: 1.0,
            ),
            // 微妙的渐变叠加，增加质感
            gradient: gradientColors != null 
              ? LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: gradientColors!,
                ) 
              : LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    AppTheme.textPrimary.withOpacity(0.05),
                    AppTheme.textPrimary.withOpacity(0.01),
                  ],
                ),
          ),
          child: child,
        ),
      ),
    );

    if (margin != null) {
      container = Padding(padding: margin!, child: container);
    }

    if (onTap != null) {
      return Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: borderRadius,
          child: MouseRegion(
            cursor: SystemMouseCursors.click,
            child: container,
          ),
        ),
      );
    }

    return container;
  }
}

/// 标准毛玻璃卡片
/// 用于 Dashboard 和列表
class GlassCard extends StatelessWidget {
  final Widget child;
  final String? title;
  final IconData? icon;
  final Color? iconColor;
  final VoidCallback? onTap;
  
  const GlassCard({
    Key? key,
    required this.child,
    this.title,
    this.icon,
    this.iconColor,
    this.onTap,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return GlassContainer(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (title != null || icon != null) ...[
            Row(
              children: [
                if (icon != null) ...[
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: (iconColor ?? AppTheme.primary).withOpacity(0.2),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(
                      icon,
                      size: 18,
                      color: iconColor ?? AppTheme.primary,
                    ),
                  ),
                  const SizedBox(width: 12),
                ],
                if (title != null)
                  Expanded(
                    child: Text(
                      title!,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: AppTheme.textPrimary,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            const Divider(height: 1, color: AppTheme.borderSubtle),
            const SizedBox(height: 16),
          ],
          child,
        ],
      ),
    );
  }
}

/// 霓虹发光按钮
class NeonButton extends StatefulWidget {
  final String text; // 改为 text 参数
  final VoidCallback onPressed;
  final IconData? icon;
  final bool isPrimary;
  final bool isLoading;
  final double? width;
  final double? height;
  final double? fontSize;
  final Color? borderColor;
  final Color? textColor;

  const NeonButton({
    Key? key,
    required this.text,
    required this.onPressed,
    this.icon,
    this.isPrimary = true,
    this.isLoading = false,
    this.width,
    this.height,
    this.fontSize,
    this.borderColor,
    this.textColor,
  }) : super(key: key);

  @override
  State<NeonButton> createState() => _NeonButtonState();
}

class _NeonButtonState extends State<NeonButton> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  bool _isHovering = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 200),
    );
    _scaleAnimation = Tween<double>(begin: 1.0, end: 1.05).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.textColor ?? (widget.isPrimary ? AppTheme.primary : AppTheme.secondary);
    final effectiveBorderColor = widget.borderColor ?? color;
    
    return MouseRegion(
      onEnter: (_) {
        setState(() => _isHovering = true);
        _controller.forward();
      },
      onExit: (_) {
        setState(() => _isHovering = false);
        _controller.reverse();
      },
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        onTap: widget.isLoading ? null : widget.onPressed,
        child: ScaleTransition(
          scale: _scaleAnimation,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            width: widget.width,
            height: widget.height,
            padding: EdgeInsets.symmetric(
              horizontal: widget.width != null ? 0 : 24, 
              vertical: widget.height != null ? 0 : 12,
            ),
            decoration: BoxDecoration(
              color: _isHovering ? color.withOpacity(0.2) : Colors.transparent,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: _isHovering ? effectiveBorderColor : effectiveBorderColor.withOpacity(0.5),
                width: 1.5,
              ),
              boxShadow: _isHovering
                  ? [
                      BoxShadow(
                        color: color.withOpacity(0.4),
                        blurRadius: 12,
                        spreadRadius: 2,
                      ),
                    ]
                  : [],
            ),
            child: Row(
              mainAxisSize: widget.width != null ? MainAxisSize.max : MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (widget.isLoading) ...[
                  SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: color,
                    ),
                  ),
                  const SizedBox(width: 8),
                ] else if (widget.icon != null) ...[
                  Icon(widget.icon, size: 18, color: color),
                  const SizedBox(width: 8),
                ],
                Text(
                  widget.text,
                  style: TextStyle(
                    color: color,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1.0,
                    fontSize: widget.fontSize,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
