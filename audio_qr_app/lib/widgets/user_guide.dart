import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// 用户引导覆盖层
class UserGuideOverlay extends StatefulWidget {
  final List<GuideStep> steps;
  final VoidCallback onComplete;
  final Widget child;
  
  const UserGuideOverlay({
    super.key,
    required this.steps,
    required this.onComplete,
    required this.child,
  });
  
  @override
  State<UserGuideOverlay> createState() => _UserGuideOverlayState();
}

class _UserGuideOverlayState extends State<UserGuideOverlay>
    with SingleTickerProviderStateMixin {
  int _currentStep = 0;
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  
  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 300),
      vsync: this,
    );
    
    _fadeAnimation = Tween<double>(
      begin: 0.0,
      end: 1.0,
    ).animate(CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeInOut,
    ));
    
    _animationController.forward();
  }
  
  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }
  
  void _nextStep() {
    if (_currentStep < widget.steps.length - 1) {
      setState(() {
        _currentStep++;
      });
      _animationController.reset();
      _animationController.forward();
    } else {
      _closeGuide();
    }
  }
  
  void _previousStep() {
    if (_currentStep > 0) {
      setState(() {
        _currentStep--;
      });
      _animationController.reset();
      _animationController.forward();
    }
  }
  
  void _closeGuide() {
    _animationController.reverse().then((_) {
      widget.onComplete();
    });
  }
  
  @override
  Widget build(BuildContext context) {
    final currentStep = widget.steps[_currentStep];
    
    return Material(
      color: Colors.transparent,
      child: Stack(
        children: [
          // 背景遮罩
          AnimatedBuilder(
            animation: _fadeAnimation,
            builder: (context, child) {
              return Container(
                color: Colors.black.withOpacity(0.7 * _fadeAnimation.value),
              );
            },
          ),
          
          // 高亮区域（如果有目标）
          if (currentStep.targetKey != null)
            _buildHighlightArea(currentStep),
          
          // 引导卡片
          AnimatedBuilder(
            animation: _fadeAnimation,
            builder: (context, child) {
              return Opacity(
                opacity: _fadeAnimation.value,
                child: _buildGuideCard(currentStep),
              );
            },
          ),
        ],
      ),
    );
  }
  
  Widget _buildHighlightArea(GuideStep step) {
    final RenderBox? renderBox = step.targetKey!.currentContext?.findRenderObject() as RenderBox?;
    if (renderBox == null) return const SizedBox.shrink();
    
    final Offset position = renderBox.localToGlobal(Offset.zero);
    final Size size = renderBox.size;
    
    return Positioned(
      left: position.dx - 8,
      top: position.dy - 8,
      child: Container(
        width: size.width + 16,
        height: size.height + 16,
        decoration: BoxDecoration(
          border: Border.all(
            color: Theme.of(context).colorScheme.primary,
            width: 2,
          ),
          borderRadius: BorderRadius.circular(12),
          boxShadow: [
            BoxShadow(
              color: Theme.of(context).colorScheme.primary.withOpacity(0.3),
              blurRadius: 8,
              spreadRadius: 2,
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildGuideCard(GuideStep step) {
    final theme = Theme.of(context);
    
    return Container(
      margin: const EdgeInsets.all(24),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.2),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (step.icon != null) ...[
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(
                    step.icon,
                    color: theme.colorScheme.onPrimaryContainer,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
              ],
              Expanded(
                child: Text(
                  step.title,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 8,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: theme.colorScheme.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  '${_currentStep + 1}/${widget.steps.length}',
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.primary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            step.description,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              if (_currentStep > 0)
                TextButton.icon(
                  onPressed: _previousStep,
                  icon: Icon(PhosphorIcons.caretLeft()),
                  label: const Text('上一步'),
                )
              else
                const SizedBox.shrink(),
              Row(
                children: [
                  TextButton(
                    onPressed: _closeGuide,
                    child: const Text('跳过'),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton.icon(
                    onPressed: _nextStep,
                    icon: Icon(_currentStep < widget.steps.length - 1 
                        ? PhosphorIcons.caretRight() 
                        : PhosphorIcons.check()),
                    label: Text(_currentStep < widget.steps.length - 1 
                        ? '下一步' 
                        : '完成'),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class GuideStep {
  final GlobalKey? targetKey;
  final String title;
  final String description;
  final IconData? icon;
  final double? cardTop;
  final double? cardLeft;
  final double? cardRight;
  final double? cardBottom;
  
  const GuideStep({
    this.targetKey,
    required this.title,
    required this.description,
    this.icon,
    this.cardTop,
    this.cardLeft,
    this.cardRight,
    this.cardBottom,
  });
}

/// 错误处理组件
class ErrorHandler {
  static void handleError(
    BuildContext context, {
    required String title,
    required String message,
    List<ErrorAction>? actions,
    ErrorSeverity severity = ErrorSeverity.warning,
  }) {
    showDialog(
      context: context,
      builder: (context) => ErrorDialog(
        title: title,
        message: message,
        actions: actions,
        severity: severity,
      ),
    );
  }
  
  static void handleNetworkError(BuildContext context) {
    handleError(
      context,
      title: '网络连接错误',
      message: '请检查您的网络连接是否正常，然后重试。',
      severity: ErrorSeverity.error,
      actions: [
        ErrorAction(
          text: '重试',
          isPrimary: true,
          onPressed: () {
            Navigator.of(context).pop();
            // TODO: 重试逻辑
          },
        ),
        ErrorAction(
          text: '取消',
          onPressed: () => Navigator.of(context).pop(),
        ),
      ],
    );
  }
  
  static void handleFileError(BuildContext context, String fileName) {
    handleError(
      context,
      title: '文件处理错误',
      message: '无法处理文件 "$fileName"，请确保文件格式正确且未损坏。',
      severity: ErrorSeverity.warning,
      actions: [
        ErrorAction(
          text: '选择其他文件',
          isPrimary: true,
          onPressed: () {
            Navigator.of(context).pop();
            // TODO: 重新选择文件
          },
        ),
        ErrorAction(
          text: '取消',
          onPressed: () => Navigator.of(context).pop(),
        ),
      ],
    );
  }
}

enum ErrorSeverity { info, warning, error, critical }

class ErrorAction {
  final String text;
  final VoidCallback? onPressed;
  final bool isPrimary;
  
  const ErrorAction({
    required this.text,
    this.onPressed,
    this.isPrimary = false,
  });
}

class ErrorDialog extends StatelessWidget {
  final String title;
  final String message;
  final List<ErrorAction>? actions;
  final ErrorSeverity severity;
  
  const ErrorDialog({
    super.key,
    required this.title,
    required this.message,
    this.actions,
    required this.severity,
  });
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = _getSeverityColors(theme);
    
    return AlertDialog(
      icon: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: colors['background'],
          shape: BoxShape.circle,
        ),
        child: Icon(
          _getSeverityIcon(),
          color: colors['icon'],
          size: 32,
        ),
      ),
      title: Text(
        title,
        style: theme.textTheme.titleLarge?.copyWith(
          fontWeight: FontWeight.w600,
          color: colors['text'],
        ),
        textAlign: TextAlign.center,
      ),
      content: Text(
        message,
        style: theme.textTheme.bodyMedium?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
          height: 1.4,
        ),
        textAlign: TextAlign.center,
      ),
      actions: actions?.map((action) {
        return action.isPrimary
            ? ElevatedButton(
                onPressed: action.onPressed,
                style: ElevatedButton.styleFrom(
                  backgroundColor: colors['button'],
                ),
                child: Text(action.text),
              )
            : TextButton(
                onPressed: action.onPressed,
                child: Text(action.text),
              );
      }).toList() ?? [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('确定'),
        ),
      ],
      actionsAlignment: MainAxisAlignment.center,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
      ),
    );
  }
  
  IconData _getSeverityIcon() {
    switch (severity) {
      case ErrorSeverity.info:
        return PhosphorIcons.info();
      case ErrorSeverity.warning:
        return PhosphorIcons.warning();
      case ErrorSeverity.error:
        return PhosphorIcons.xCircle();
      case ErrorSeverity.critical:
        return PhosphorIcons.warningOctagon();
    }
  }
  
  Map<String, Color> _getSeverityColors(ThemeData theme) {
    switch (severity) {
      case ErrorSeverity.info:
        return {
          'background': theme.colorScheme.primaryContainer,
          'icon': theme.colorScheme.onPrimaryContainer,
          'text': theme.colorScheme.onSurface,
          'button': theme.colorScheme.primary,
        };
      case ErrorSeverity.warning:
        return {
          'background': const Color(0xFFFFF3CD),
          'icon': const Color(0xFFB45309),
          'text': theme.colorScheme.onSurface,
          'button': const Color(0xFFF59E0B),
        };
      case ErrorSeverity.error:
      case ErrorSeverity.critical:
        return {
          'background': theme.colorScheme.errorContainer,
          'icon': theme.colorScheme.onErrorContainer,
          'text': theme.colorScheme.onSurface,
          'button': theme.colorScheme.error,
        };
    }
  }
}