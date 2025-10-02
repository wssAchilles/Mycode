import 'package:flutter/material.dart';

/// 自定义页面过渡动画
class SlidePageRoute extends PageRouteBuilder {
  final Widget page;
  final Duration duration;
  final Offset beginOffset;

  SlidePageRoute({
    required this.page,
    this.duration = const Duration(milliseconds: 300),
    this.beginOffset = const Offset(1.0, 0.0),
  }) : super(
          pageBuilder: (context, animation, secondaryAnimation) => page,
          transitionDuration: duration,
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            const curve = Curves.easeInOut;
            
            var tween = Tween(begin: beginOffset, end: Offset.zero)
                .chain(CurveTween(curve: curve));
            
            return SlideTransition(
              position: animation.drive(tween),
              child: child,
            );
          },
        );
}

/// 渐显页面过渡动画
class FadePageRoute extends PageRouteBuilder {
  final Widget page;
  final Duration duration;

  FadePageRoute({
    required this.page,
    this.duration = const Duration(milliseconds: 400),
  }) : super(
          pageBuilder: (context, animation, secondaryAnimation) => page,
          transitionDuration: duration,
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            return FadeTransition(
              opacity: animation.drive(
                Tween(begin: 0.0, end: 1.0).chain(
                  CurveTween(curve: Curves.easeIn),
                ),
              ),
              child: child,
            );
          },
        );
}

/// 缩放页面过渡动画
class ScalePageRoute extends PageRouteBuilder {
  final Widget page;
  final Duration duration;

  ScalePageRoute({
    required this.page,
    this.duration = const Duration(milliseconds: 350),
  }) : super(
          pageBuilder: (context, animation, secondaryAnimation) => page,
          transitionDuration: duration,
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            const curve = Curves.elasticOut;
            
            var tween = Tween(begin: 0.5, end: 1.0)
                .chain(CurveTween(curve: curve));
            
            return ScaleTransition(
              scale: animation.drive(tween),
              child: FadeTransition(
                opacity: animation,
                child: child,
              ),
            );
          },
        );
}

/// Hero动画辅助组件
class HeroDialogRoute<T> extends PageRoute<T> {
  final WidgetBuilder builder;

  HeroDialogRoute({
    required this.builder,
    RouteSettings? settings,
    bool fullscreenDialog = false,
  }) : super(settings: settings, fullscreenDialog: fullscreenDialog);

  @override
  bool get opaque => false;

  @override
  bool get barrierDismissible => true;

  @override
  Duration get transitionDuration => const Duration(milliseconds: 300);

  @override
  bool get maintainState => true;

  @override
  Color get barrierColor => Colors.black54;

  @override
  Widget buildTransitions(BuildContext context, Animation<double> animation,
      Animation<double> secondaryAnimation, Widget child) {
    return FadeTransition(
      opacity: animation.drive(Tween(begin: 0.0, end: 1.0)),
      child: child,
    );
  }

  @override
  Widget buildPage(BuildContext context, Animation<double> animation,
      Animation<double> secondaryAnimation) {
    return builder(context);
  }

  @override
  String? get barrierLabel => 'Dismiss';
}
