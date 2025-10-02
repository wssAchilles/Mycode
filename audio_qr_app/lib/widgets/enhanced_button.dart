import 'package:flutter/material.dart';
import '../theme/enhanced_theme.dart';

/// 增强的交互按钮组件
class EnhancedButton extends StatefulWidget {
  final String text;
  final VoidCallback? onPressed;
  final IconData? icon;
  final EnhancedButtonType type;
  final EnhancedButtonSize size;
  final bool isLoading;
  final bool isFullWidth;
  final List<Color>? gradientColors;
  
  const EnhancedButton({
    super.key,
    required this.text,
    this.onPressed,
    this.icon,
    this.type = EnhancedButtonType.primary,
    this.size = EnhancedButtonSize.medium,
    this.isLoading = false,
    this.isFullWidth = false,
    this.gradientColors,
  });
  
  @override
  State<EnhancedButton> createState() => _EnhancedButtonState();
}

class _EnhancedButtonState extends State<EnhancedButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _scaleAnimation;
  bool _isPressed = false;
  
  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 150),
      vsync: this,
    );
    _scaleAnimation = Tween<double>(
      begin: 1.0,
      end: 0.95,
    ).animate(CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeInOut,
    ));
  }
  
  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }
  
  EdgeInsets get _padding {
    switch (widget.size) {
      case EnhancedButtonSize.small:
        return const EdgeInsets.symmetric(horizontal: 20, vertical: 10);
      case EnhancedButtonSize.medium:
        return const EdgeInsets.symmetric(horizontal: 32, vertical: 16);
      case EnhancedButtonSize.large:
        return const EdgeInsets.symmetric(horizontal: 40, vertical: 20);
    }
  }
  
  double get _fontSize {
    switch (widget.size) {
      case EnhancedButtonSize.small:
        return 14;
      case EnhancedButtonSize.medium:
        return 16;
      case EnhancedButtonSize.large:
        return 18;
    }
  }
  
  ButtonStyle _getButtonStyle(ColorScheme colorScheme) {
    ButtonStyle baseStyle;
    
    switch (widget.type) {
      case EnhancedButtonType.primary:
        baseStyle = EnhancedButtonStyles.primary(colorScheme);
        break;
      case EnhancedButtonType.secondary:
        baseStyle = EnhancedTheme.enhancedOutlinedButtonStyle(colorScheme);
        break;
      case EnhancedButtonType.success:
        baseStyle = EnhancedButtonStyles.success(colorScheme);
        break;
      case EnhancedButtonType.warning:
        baseStyle = EnhancedButtonStyles.warning(colorScheme);
        break;
      case EnhancedButtonType.danger:
        baseStyle = EnhancedButtonStyles.danger(colorScheme);
        break;
      case EnhancedButtonType.gradient:
        baseStyle = EnhancedButtonStyles.gradient(
          widget.gradientColors ?? EnhancedTheme.primaryGradient,
        );
        break;
    }
    
    return baseStyle.copyWith(
      padding: WidgetStateProperty.all(_padding),
      textStyle: WidgetStateProperty.all(TextStyle(
        fontSize: _fontSize,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.5,
      )),
    );
  }
  
  void _handleTapDown(TapDownDetails details) {
    if (widget.onPressed != null && !widget.isLoading) {
      setState(() => _isPressed = true);
      _animationController.forward();
    }
  }
  
  void _handleTapUp(TapUpDetails details) {
    setState(() => _isPressed = false);
    _animationController.reverse();
  }
  
  void _handleTapCancel() {
    setState(() => _isPressed = false);
    _animationController.reverse();
  }
  
  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    
    Widget button = GestureDetector(
      onTapDown: _handleTapDown,
      onTapUp: _handleTapUp,
      onTapCancel: _handleTapCancel,
      child: AnimatedBuilder(
        animation: _scaleAnimation,
        builder: (context, child) {
          return Transform.scale(
            scale: _scaleAnimation.value,
            child: _buildButtonContent(colorScheme),
          );
        },
      ),
    );
    
    if (widget.isFullWidth) {
      button = SizedBox(
        width: double.infinity,
        child: button,
      );
    }
    
    return button;
  }
  
  Widget _buildButtonContent(ColorScheme colorScheme) {
    if (widget.type == EnhancedButtonType.gradient) {
      return _buildGradientButton(colorScheme);
    } else if (widget.type == EnhancedButtonType.secondary) {
      return _buildOutlinedButton(colorScheme);
    } else {
      return _buildElevatedButton(colorScheme);
    }
  }
  
  Widget _buildElevatedButton(ColorScheme colorScheme) {
    return ElevatedButton(
      onPressed: widget.isLoading ? null : widget.onPressed,
      style: _getButtonStyle(colorScheme),
      child: _buildButtonChild(),
    );
  }
  
  Widget _buildOutlinedButton(ColorScheme colorScheme) {
    return OutlinedButton(
      onPressed: widget.isLoading ? null : widget.onPressed,
      style: _getButtonStyle(colorScheme),
      child: _buildButtonChild(),
    );
  }
  
  Widget _buildGradientButton(ColorScheme colorScheme) {
    return Container(
      decoration: EnhancedTheme.getGradientDecoration(
        widget.gradientColors ?? EnhancedTheme.primaryGradient,
      ),
      child: ElevatedButton(
        onPressed: widget.isLoading ? null : widget.onPressed,
        style: _getButtonStyle(colorScheme),
        child: _buildButtonChild(),
      ),
    );
  }
  
  Widget _buildButtonChild() {
    if (widget.isLoading) {
      return SizedBox(
        height: _fontSize + 4,
        width: _fontSize + 4,
        child: CircularProgressIndicator(
          strokeWidth: 2,
          valueColor: AlwaysStoppedAnimation<Color>(
            widget.type == EnhancedButtonType.secondary 
                ? Theme.of(context).colorScheme.primary
                : Colors.white,
          ),
        ),
      );
    }
    
    if (widget.icon != null) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(widget.icon, size: _fontSize + 2),
          const SizedBox(width: 8),
          Text(widget.text),
        ],
      );
    }
    
    return Text(widget.text);
  }
}

/// 按钮类型枚举
enum EnhancedButtonType {
  primary,
  secondary,
  success,
  warning,
  danger,
  gradient,
}

/// 按钮尺寸枚举
enum EnhancedButtonSize {
  small,
  medium,
  large,
}

/// 浮动操作按钮扩展
class EnhancedFloatingActionButton extends StatefulWidget {
  final VoidCallback? onPressed;
  final IconData icon;
  final String? tooltip;
  final bool mini;
  final List<Color>? gradientColors;
  
  const EnhancedFloatingActionButton({
    super.key,
    this.onPressed,
    required this.icon,
    this.tooltip,
    this.mini = false,
    this.gradientColors,
  });
  
  @override
  State<EnhancedFloatingActionButton> createState() => 
      _EnhancedFloatingActionButtonState();
}

class _EnhancedFloatingActionButtonState extends State<EnhancedFloatingActionButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _scaleAnimation;
  
  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 200),
      vsync: this,
    );
    _scaleAnimation = Tween<double>(
      begin: 1.0,
      end: 0.9,
    ).animate(CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeInOut,
    ));
  }
  
  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) => _animationController.forward(),
      onTapUp: (_) => _animationController.reverse(),
      onTapCancel: () => _animationController.reverse(),
      child: AnimatedBuilder(
        animation: _scaleAnimation,
        builder: (context, child) {
          return Transform.scale(
            scale: _scaleAnimation.value,
            child: _buildFAB(),
          );
        },
      ),
    );
  }
  
  Widget _buildFAB() {
    if (widget.gradientColors != null) {
      return Container(
        decoration: EnhancedTheme.getGradientDecoration(
          widget.gradientColors!,
          borderRadius: widget.mini ? 16 : 28,
        ),
        child: FloatingActionButton(
          onPressed: widget.onPressed,
          backgroundColor: Colors.transparent,
          elevation: 0,
          tooltip: widget.tooltip,
          mini: widget.mini,
          child: Icon(widget.icon, color: Colors.white),
        ),
      );
    } else {
      return FloatingActionButton(
        onPressed: widget.onPressed,
        tooltip: widget.tooltip,
        mini: widget.mini,
        child: Icon(widget.icon),
      );
    }
  }
}