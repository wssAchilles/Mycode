import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

enum NotificationType { success, error, warning, info }

class NotificationManager {
  static OverlayEntry? _overlayEntry;
  
  static void show(
    BuildContext context, {
    required String message,
    NotificationType type = NotificationType.info,
    String? title,
    Duration duration = const Duration(seconds: 4),
    VoidCallback? onTap,
  }) {
    _removeCurrentNotification();
    
    _overlayEntry = OverlayEntry(
      builder: (context) => ModernNotification(
        message: message,
        type: type,
        title: title,
        duration: duration,
        onTap: onTap,
        onDismiss: _removeCurrentNotification,
      ),
    );
    
    Overlay.of(context).insert(_overlayEntry!);
  }
  
  static void _removeCurrentNotification() {
    _overlayEntry?.remove();
    _overlayEntry = null;
  }
}

class ModernNotification extends StatefulWidget {
  final String message;
  final NotificationType type;
  final String? title;
  final Duration duration;
  final VoidCallback? onTap;
  final VoidCallback? onDismiss;
  
  const ModernNotification({
    super.key,
    required this.message,
    required this.type,
    this.title,
    required this.duration,
    this.onTap,
    this.onDismiss,
  });
  
  @override
  State<ModernNotification> createState() => _ModernNotificationState();
}

class _ModernNotificationState extends State<ModernNotification>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<Offset> _slideAnimation;
  late Animation<double> _opacityAnimation;
  late Animation<double> _progressAnimation;
  
  @override
  void initState() {
    super.initState();
    
    _controller = AnimationController(
      duration: const Duration(milliseconds: 300),
      vsync: this,
    );
    
    _slideAnimation = Tween<Offset>(
      begin: const Offset(0, -1),
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOutBack,
    ));
    
    _opacityAnimation = Tween<double>(
      begin: 0,
      end: 1,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOut,
    ));
    
    _progressAnimation = Tween<double>(
      begin: 1,
      end: 0,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.linear,
    ));
    
    _controller.forward();
    
    // 自动消失
    Future.delayed(widget.duration, () {
      _dismiss();
    });
  }
  
  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
  
  void _dismiss() {
    if (mounted) {
      _controller.reverse().then((_) {
        widget.onDismiss?.call();
      });
    }
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = _getTypeColors(theme);
    
    return Positioned(
      top: MediaQuery.of(context).padding.top + 16,
      left: 16,
      right: 16,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) {
          return SlideTransition(
            position: _slideAnimation,
            child: FadeTransition(
              opacity: _opacityAnimation,
              child: Material(
                elevation: 8,
                borderRadius: BorderRadius.circular(16),
                color: Colors.transparent,
                child: Container(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    color: colors['background'],
                    border: Border.all(
                      color: colors['border']!,
                      width: 1,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: colors['shadow']!,
                        blurRadius: 20,
                        offset: const Offset(0, 8),
                      ),
                    ],
                  ),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(16),
                    onTap: widget.onTap,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: colors['iconBackground'],
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Icon(
                                  _getTypeIcon(),
                                  size: 20,
                                  color: colors['icon'],
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    if (widget.title != null) ...[
                                      Text(
                                        widget.title!,
                                        style: theme.textTheme.titleSmall?.copyWith(
                                          fontWeight: FontWeight.w600,
                                          color: colors['title'],
                                        ),
                                      ),
                                      const SizedBox(height: 2),
                                    ],
                                    Text(
                                      widget.message,
                                      style: theme.textTheme.bodyMedium?.copyWith(
                                        color: colors['text'],
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              IconButton(
                                icon: Icon(
                                  PhosphorIcons.x(),
                                  size: 16,
                                  color: colors['text']?.withOpacity(0.7),
                                ),
                                onPressed: _dismiss,
                                padding: EdgeInsets.zero,
                                constraints: const BoxConstraints(
                                  minWidth: 24,
                                  minHeight: 24,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          Container(
                            height: 3,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(2),
                              color: colors['progressBackground'],
                            ),
                            child: FractionallySizedBox(
                              alignment: Alignment.centerLeft,
                              widthFactor: _progressAnimation.value,
                              child: Container(
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(2),
                                  color: colors['progress'],
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
  
  IconData _getTypeIcon() {
    switch (widget.type) {
      case NotificationType.success:
        return PhosphorIcons.checkCircle();
      case NotificationType.error:
        return PhosphorIcons.xCircle();
      case NotificationType.warning:
        return PhosphorIcons.warning();
      case NotificationType.info:
        return PhosphorIcons.info();
    }
  }
  
  Map<String, Color> _getTypeColors(ThemeData theme) {
    switch (widget.type) {
      case NotificationType.success:
        return {
          'background': const Color(0xFFF0FDF4),
          'border': const Color(0xFF22C55E),
          'shadow': const Color(0xFF22C55E).withOpacity(0.2),
          'iconBackground': const Color(0xFF22C55E).withOpacity(0.1),
          'icon': const Color(0xFF22C55E),
          'title': const Color(0xFF15803D),
          'text': const Color(0xFF166534),
          'progressBackground': const Color(0xFF22C55E).withOpacity(0.2),
          'progress': const Color(0xFF22C55E),
        };
      case NotificationType.error:
        return {
          'background': const Color(0xFFFEF2F2),
          'border': const Color(0xFFEF4444),
          'shadow': const Color(0xFFEF4444).withOpacity(0.2),
          'iconBackground': const Color(0xFFEF4444).withOpacity(0.1),
          'icon': const Color(0xFFEF4444),
          'title': const Color(0xFFDC2626),
          'text': const Color(0xFFB91C1C),
          'progressBackground': const Color(0xFFEF4444).withOpacity(0.2),
          'progress': const Color(0xFFEF4444),
        };
      case NotificationType.warning:
        return {
          'background': const Color(0xFFFFFBEB),
          'border': const Color(0xFFF59E0B),
          'shadow': const Color(0xFFF59E0B).withOpacity(0.2),
          'iconBackground': const Color(0xFFF59E0B).withOpacity(0.1),
          'icon': const Color(0xFFF59E0B),
          'title': const Color(0xFFD97706),
          'text': const Color(0xFFB45309),
          'progressBackground': const Color(0xFFF59E0B).withOpacity(0.2),
          'progress': const Color(0xFFF59E0B),
        };
      case NotificationType.info:
        return {
          'background': theme.colorScheme.primaryContainer,
          'border': theme.colorScheme.primary,
          'shadow': theme.colorScheme.primary.withOpacity(0.2),
          'iconBackground': theme.colorScheme.primary.withOpacity(0.1),
          'icon': theme.colorScheme.primary,
          'title': theme.colorScheme.onPrimaryContainer,
          'text': theme.colorScheme.onPrimaryContainer,
          'progressBackground': theme.colorScheme.primary.withOpacity(0.2),
          'progress': theme.colorScheme.primary,
        };
    }
  }
}