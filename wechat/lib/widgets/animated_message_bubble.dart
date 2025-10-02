import 'package:flutter/material.dart';
import '../models/message_model.dart';

/// 带动画效果的消息气泡组件
class AnimatedMessageBubble extends StatefulWidget {
  final MessageModel message;
  final bool isMe;
  final Widget child;

  const AnimatedMessageBubble({
    Key? key,
    required this.message,
    required this.isMe,
    required this.child,
  }) : super(key: key);

  @override
  _AnimatedMessageBubbleState createState() => _AnimatedMessageBubbleState();
}

class _AnimatedMessageBubbleState extends State<AnimatedMessageBubble> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  late Animation<double> _slideAnimation;
  late Animation<double> _opacityAnimation;

  @override
  void initState() {
    super.initState();
    
    // 创建动画控制器
    _controller = AnimationController(
      duration: const Duration(milliseconds: 300),
      vsync: this,
    );
    
    // 缩放动画 - 从0.5到1.0
    _scaleAnimation = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOutBack,
    );
    
    // 滑动动画 - 从侧边滑入
    _slideAnimation = Tween<double>(
      begin: widget.isMe ? 20.0 : -20.0,
      end: 0.0,
    ).animate(
      CurvedAnimation(
        parent: _controller,
        curve: Curves.easeOutCubic,
      ),
    );
    
    // 透明度动画 - 从0.4到1.0
    _opacityAnimation = Tween<double>(
      begin: 0.4,
      end: 1.0,
    ).animate(
      CurvedAnimation(
        parent: _controller,
        curve: Curves.easeIn,
      ),
    );
    
    // 启动动画
    _controller.forward();
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
        return Transform.translate(
          offset: Offset(_slideAnimation.value, 0),
          child: Opacity(
            opacity: _opacityAnimation.value,
            child: Transform.scale(
              scale: _scaleAnimation.value,
              alignment: widget.isMe ? Alignment.centerRight : Alignment.centerLeft,
              child: widget.child,
            ),
          ),
        );
      },
    );
  }
}
