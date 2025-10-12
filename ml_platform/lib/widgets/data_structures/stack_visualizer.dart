import 'package:flutter/material.dart';

/// 栈可视化组件
class StackVisualizer extends StatefulWidget {
  const StackVisualizer({Key? key}) : super(key: key);

  @override
  State<StackVisualizer> createState() => _StackVisualizerState();
}

class _StackVisualizerState extends State<StackVisualizer>
    with SingleTickerProviderStateMixin {
  final List<int> _stack = [];
  final int _maxSize = 10;
  final TextEditingController _inputController = TextEditingController();
  late AnimationController _animationController;
  Animation<double>? _pushAnimation;
  Animation<double>? _popAnimation;
  bool _isAnimating = false;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    );
    
    // 初始化一些示例数据
    _stack.addAll([5, 8, 3, 12, 7]);
  }

  @override
  void dispose() {
    _animationController.dispose();
    _inputController.dispose();
    super.dispose();
  }

  void _push() {
    final value = int.tryParse(_inputController.text);
    if (value == null) {
      _showSnackBar('请输入有效的整数');
      return;
    }
    
    if (_stack.length >= _maxSize) {
      _showSnackBar('栈已满！');
      return;
    }
    
    setState(() {
      _isAnimating = true;
    });
    
    _pushAnimation = Tween<double>(
      begin: 0.0,
      end: 1.0,
    ).animate(CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeInOut,
    ));
    
    _animationController.forward(from: 0).then((_) {
      setState(() {
        _stack.add(value);
        _isAnimating = false;
        _inputController.clear();
      });
    });
  }

  void _pop() {
    if (_stack.isEmpty) {
      _showSnackBar('栈为空！');
      return;
    }
    
    setState(() {
      _isAnimating = true;
    });
    
    _popAnimation = Tween<double>(
      begin: 0.0,
      end: 1.0,
    ).animate(CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeInOut,
    ));
    
    _animationController.forward(from: 0).then((_) {
      setState(() {
        _stack.removeLast();
        _isAnimating = false;
      });
    });
  }

  void _peek() {
    if (_stack.isEmpty) {
      _showSnackBar('栈为空！');
      return;
    }
    
    _showSnackBar('栈顶元素: ${_stack.last}');
  }

  void _clear() {
    setState(() {
      _stack.clear();
    });
    _showSnackBar('栈已清空');
  }

  void _showSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Column(
      children: [
        // 控制面板
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '栈操作',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _inputController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          hintText: '输入要压栈的值',
                          border: OutlineInputBorder(),
                          contentPadding: EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 8,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton.icon(
                      onPressed: _isAnimating ? null : _push,
                      icon: const Icon(Icons.add),
                      label: const Text('Push'),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: _isAnimating ? null : _pop,
                      icon: const Icon(Icons.remove),
                      label: const Text('Pop'),
                    ),
                    OutlinedButton.icon(
                      onPressed: _peek,
                      icon: const Icon(Icons.visibility),
                      label: const Text('Peek'),
                    ),
                    OutlinedButton.icon(
                      onPressed: _clear,
                      icon: const Icon(Icons.clear),
                      label: const Text('Clear'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        // 可视化展示
        Expanded(
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '栈可视化',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        '容量: ${_stack.length} / $_maxSize',
                        style: theme.textTheme.bodyMedium,
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Expanded(
                    child: Center(
                      child: CustomPaint(
                        painter: StackPainter(
                          stack: _stack,
                          maxSize: _maxSize,
                          pushAnimation: _pushAnimation,
                          popAnimation: _popAnimation,
                          isAnimating: _isAnimating,
                        ),
                        child: const SizedBox.expand(),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  // 信息显示
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.grey[100],
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        _buildInfoItem('栈顶', _stack.isEmpty ? 'null' : _stack.last.toString()),
                        _buildInfoItem('大小', _stack.length.toString()),
                        _buildInfoItem('状态', _stack.isEmpty ? '空' : (_stack.length == _maxSize ? '满' : '正常')),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildInfoItem(String label, String value) {
    return Column(
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 12,
            color: Colors.grey[600],
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }
}

/// 栈绘制器
class StackPainter extends CustomPainter {
  final List<int> stack;
  final int maxSize;
  final Animation<double>? pushAnimation;
  final Animation<double>? popAnimation;
  final bool isAnimating;

  StackPainter({
    required this.stack,
    required this.maxSize,
    this.pushAnimation,
    this.popAnimation,
    required this.isAnimating,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..style = PaintingStyle.fill;
    
    final borderPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = Colors.grey;
    
    // 计算栈的尺寸
    const double itemHeight = 40;
    const double itemWidth = 120;
    final double stackHeight = itemHeight * maxSize;
    final double startX = (size.width - itemWidth) / 2;
    final double startY = size.height - 40;
    
    // 绘制栈的边框
    final stackRect = Rect.fromLTWH(
      startX - 10,
      startY - stackHeight - 10,
      itemWidth + 20,
      stackHeight + 10,
    );
    canvas.drawRect(stackRect, borderPaint);
    
    // 绘制"栈底"标签
    final bottomTextPainter = TextPainter(
      text: const TextSpan(
        text: '栈底',
        style: TextStyle(color: Colors.grey, fontSize: 12),
      ),
      textDirection: TextDirection.ltr,
    );
    bottomTextPainter.layout();
    bottomTextPainter.paint(
      canvas,
      Offset(startX - 40, startY - itemHeight / 2),
    );
    
    // 绘制"栈顶"标签
    if (stack.isNotEmpty) {
      final topTextPainter = TextPainter(
        text: const TextSpan(
          text: '栈顶',
          style: TextStyle(color: Colors.red, fontSize: 12, fontWeight: FontWeight.bold),
        ),
        textDirection: TextDirection.ltr,
      );
      topTextPainter.layout();
      topTextPainter.paint(
        canvas,
        Offset(startX - 40, startY - (stack.length * itemHeight) - itemHeight / 2),
      );
    }
    
    // 绘制栈中的元素
    for (int i = 0; i < stack.length; i++) {
      double yOffset = startY - (i + 1) * itemHeight;
      
      // 如果正在执行动画
      if (isAnimating && i == stack.length - 1) {
        if (pushAnimation != null) {
          yOffset = startY - (i * itemHeight) - (itemHeight * pushAnimation!.value);
        }
      }
      
      // 绘制元素背景
      final elementRect = Rect.fromLTWH(
        startX,
        yOffset,
        itemWidth,
        itemHeight - 2,
      );
      
      paint.color = i == stack.length - 1 
          ? Colors.blue.withOpacity(0.7)
          : Colors.blue.withOpacity(0.4);
      
      canvas.drawRRect(
        RRect.fromRectAndRadius(elementRect, const Radius.circular(4)),
        paint,
      );
      
      // 绘制元素值
      final textPainter = TextPainter(
        text: TextSpan(
          text: stack[i].toString(),
          style: const TextStyle(
            color: Colors.white,
            fontSize: 16,
            fontWeight: FontWeight.bold,
          ),
        ),
        textDirection: TextDirection.ltr,
      );
      textPainter.layout();
      textPainter.paint(
        canvas,
        Offset(
          startX + (itemWidth - textPainter.width) / 2,
          yOffset + (itemHeight - textPainter.height) / 2,
        ),
      );
    }
  }

  @override
  bool shouldRepaint(StackPainter oldDelegate) {
    return oldDelegate.stack != stack ||
           oldDelegate.isAnimating != isAnimating ||
           oldDelegate.pushAnimation != pushAnimation ||
           oldDelegate.popAnimation != popAnimation;
  }
}
