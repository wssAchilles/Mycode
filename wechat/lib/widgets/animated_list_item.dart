import 'package:flutter/material.dart';

/// 带有动画效果的列表项
/// 用于在列表中显示滑入和淡入效果
class AnimatedListItem extends StatefulWidget {
  final Widget child;
  final int index;
  final bool shouldAnimate;
  final Duration? delay;

  const AnimatedListItem({
    Key? key,
    required this.child,
    required this.index,
    this.shouldAnimate = true,
    this.delay,
  }) : super(key: key);

  @override
  _AnimatedListItemState createState() => _AnimatedListItemState();
}

class _AnimatedListItemState extends State<AnimatedListItem> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _opacityAnimation;
  late Animation<Offset> _slideAnimation;

  @override
  void initState() {
    super.initState();
    
    _controller = AnimationController(
      vsync: this,
      duration: Duration(milliseconds: 400),
    );
    
    _opacityAnimation = Tween<double>(
      begin: 0.0,
      end: 1.0,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Interval(0.0, 0.65, curve: Curves.easeOut),
    ));
    
    _slideAnimation = Tween<Offset>(
      begin: Offset(0, 0.2),
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOutCubic,
    ));
    
    if (widget.shouldAnimate) {
      // 为每个列表项添加递增的延迟，使它们依次出现
      Future.delayed(widget.delay ?? Duration(milliseconds: 60 * widget.index), () {
        if (mounted) {
          _controller.forward();
        }
      });
    } else {
      _controller.value = 1.0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Opacity(
          opacity: _opacityAnimation.value,
          child: SlideTransition(
            position: _slideAnimation,
            child: child,
          ),
        );
      },
      child: widget.child,
    );
  }
}
