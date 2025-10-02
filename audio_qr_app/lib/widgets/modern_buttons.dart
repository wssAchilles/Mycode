import 'package:flutter/material.dart';

/// 现代化主要按钮
class ModernButton extends StatefulWidget {
  final String text;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool isLoading;
  final ButtonStyle? style;
  final Color? backgroundColor;
  final Color? foregroundColor;
  final Size? size;
  final EdgeInsetsGeometry? padding;
  
  const ModernButton({
    super.key,
    required this.text,
    this.onPressed,
    this.icon,
    this.isLoading = false,
    this.style,
    this.backgroundColor,
    this.foregroundColor,
    this.size,
    this.padding,
  });
  
  @override
  State<ModernButton> createState() => _ModernButtonState();
}

class _ModernButtonState extends State<ModernButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 150),
      vsync: this,
    );
    _scaleAnimation = Tween<double>(begin: 1.0, end: 0.95)
        .animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
  }
  
  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return AnimatedBuilder(
      animation: _scaleAnimation,
      builder: (context, child) {
        return Transform.scale(
          scale: _scaleAnimation.value,
          child: ElevatedButton(
            onPressed: widget.isLoading ? null : widget.onPressed,
            style: widget.style ?? _getDefaultStyle(theme),
            onHover: (hovering) {
              if (hovering) {
                _controller.forward();
              } else {
                _controller.reverse();
              }
            },
            child: Container(
              padding: widget.padding ?? const EdgeInsets.symmetric(
                horizontal: 24, 
                vertical: 16,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (widget.isLoading) ...[
                    SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation(
                          widget.foregroundColor ?? theme.colorScheme.onPrimary,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                  ] else if (widget.icon != null) ...[
                    Icon(widget.icon, size: 18),
                    const SizedBox(width: 8),
                  ],
                  Text(
                    widget.text,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
  
  ButtonStyle _getDefaultStyle(ThemeData theme) {
    return ElevatedButton.styleFrom(
      backgroundColor: widget.backgroundColor ?? theme.colorScheme.primary,
      foregroundColor: widget.foregroundColor ?? theme.colorScheme.onPrimary,
      elevation: 0,
      shadowColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
      ),
      minimumSize: widget.size ?? const Size(120, 48),
    );
  }
}

/// 现代化次要按钮
class ModernOutlinedButton extends StatefulWidget {
  final String text;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool isLoading;
  final Color? borderColor;
  final Color? foregroundColor;
  final Size? size;
  final EdgeInsetsGeometry? padding;
  
  const ModernOutlinedButton({
    super.key,
    required this.text,
    this.onPressed,
    this.icon,
    this.isLoading = false,
    this.borderColor,
    this.foregroundColor,
    this.size,
    this.padding,
  });
  
  @override
  State<ModernOutlinedButton> createState() => _ModernOutlinedButtonState();
}

class _ModernOutlinedButtonState extends State<ModernOutlinedButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 150),
      vsync: this,
    );
    _scaleAnimation = Tween<double>(begin: 1.0, end: 0.95)
        .animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
  }
  
  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return AnimatedBuilder(
      animation: _scaleAnimation,
      builder: (context, child) {
        return Transform.scale(
          scale: _scaleAnimation.value,
          child: OutlinedButton(
            onPressed: widget.isLoading ? null : widget.onPressed,
            style: _getDefaultStyle(theme),
            onHover: (hovering) {
              if (hovering) {
                _controller.forward();
              } else {
                _controller.reverse();
              }
            },
            child: Container(
              padding: widget.padding ?? const EdgeInsets.symmetric(
                horizontal: 24, 
                vertical: 16,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (widget.isLoading) ...[
                    SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation(
                          widget.foregroundColor ?? theme.colorScheme.primary,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                  ] else if (widget.icon != null) ...[
                    Icon(widget.icon, size: 18),
                    const SizedBox(width: 8),
                  ],
                  Text(
                    widget.text,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
  
  ButtonStyle _getDefaultStyle(ThemeData theme) {
    return OutlinedButton.styleFrom(
      foregroundColor: widget.foregroundColor ?? theme.colorScheme.primary,
      side: BorderSide(
        color: widget.borderColor ?? theme.colorScheme.outline,
        width: 1.5,
      ),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
      ),
      minimumSize: widget.size ?? const Size(120, 48),
    );
  }
}

/// 浮动操作按钮
class ModernFAB extends StatefulWidget {
  final VoidCallback? onPressed;
  final IconData icon;
  final String? tooltip;
  final Color? backgroundColor;
  final Color? foregroundColor;
  final double? size;
  final double? elevation;
  
  const ModernFAB({
    super.key,
    required this.icon,
    this.onPressed,
    this.tooltip,
    this.backgroundColor,
    this.foregroundColor,
    this.size,
    this.elevation,
  });
  
  @override
  State<ModernFAB> createState() => _ModernFABState();
}

class _ModernFABState extends State<ModernFAB>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  late Animation<double> _rotationAnimation;
  
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 200),
      vsync: this,
    );
    _scaleAnimation = Tween<double>(begin: 1.0, end: 1.1)
        .animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
    _rotationAnimation = Tween<double>(begin: 0, end: 0.1)
        .animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
  }
  
  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final size = widget.size ?? 56.0;
    
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Transform.scale(
          scale: _scaleAnimation.value,
          child: Transform.rotate(
            angle: _rotationAnimation.value,
            child: Container(
              width: size,
              height: size,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    widget.backgroundColor ?? theme.colorScheme.primary,
                    (widget.backgroundColor ?? theme.colorScheme.primary)
                        .withOpacity(0.8),
                  ],
                ),
                boxShadow: widget.elevation != 0 ? [
                  BoxShadow(
                    color: (widget.backgroundColor ?? theme.colorScheme.primary)
                        .withOpacity(0.2),
                    blurRadius: (widget.elevation ?? 4) * 2,
                    offset: Offset(0, widget.elevation ?? 2),
                  ),
                ] : null,
              ),
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  borderRadius: BorderRadius.circular(16),
                  onTap: widget.onPressed,
                  onHover: (hovering) {
                    if (hovering) {
                      _controller.forward();
                    } else {
                      _controller.reverse();
                    }
                  },
                  child: Icon(
                    widget.icon,
                    color: widget.foregroundColor ?? theme.colorScheme.onPrimary,
                    size: size * 0.4,
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}