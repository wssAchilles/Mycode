import 'package:flutter/material.dart';

/// 队列可视化组件
class QueueVisualizer extends StatefulWidget {
  const QueueVisualizer({Key? key}) : super(key: key);

  @override
  State<QueueVisualizer> createState() => _QueueVisualizerState();
}

class _QueueVisualizerState extends State<QueueVisualizer>
    with SingleTickerProviderStateMixin {
  final List<int> _queue = [];
  final int _maxSize = 10;
  final TextEditingController _inputController = TextEditingController();
  late AnimationController _animationController;
  Animation<double>? _enqueueAnimation;
  Animation<double>? _dequeueAnimation;
  bool _isAnimating = false;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    );
    
    // 初始化示例数据
    _queue.addAll([3, 7, 2, 9, 5]);
  }

  @override
  void dispose() {
    _animationController.dispose();
    _inputController.dispose();
    super.dispose();
  }

  void _enqueue() {
    final value = int.tryParse(_inputController.text);
    if (value == null) {
      _showSnackBar('请输入有效的整数');
      return;
    }
    
    if (_queue.length >= _maxSize) {
      _showSnackBar('队列已满！');
      return;
    }
    
    setState(() {
      _isAnimating = true;
    });
    
    _enqueueAnimation = Tween<double>(
      begin: 0.0,
      end: 1.0,
    ).animate(CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeInOut,
    ));
    
    _animationController.forward(from: 0).then((_) {
      setState(() {
        _queue.add(value);
        _isAnimating = false;
        _inputController.clear();
      });
    });
  }

  void _dequeue() {
    if (_queue.isEmpty) {
      _showSnackBar('队列为空！');
      return;
    }
    
    setState(() {
      _isAnimating = true;
    });
    
    _dequeueAnimation = Tween<double>(
      begin: 0.0,
      end: 1.0,
    ).animate(CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeInOut,
    ));
    
    _animationController.forward(from: 0).then((_) {
      setState(() {
        final removed = _queue.removeAt(0);
        _isAnimating = false;
        _showSnackBar('出队元素: $removed');
      });
    });
  }

  void _peek() {
    if (_queue.isEmpty) {
      _showSnackBar('队列为空！');
      return;
    }
    
    _showSnackBar('队首元素: ${_queue.first}');
  }

  void _clear() {
    setState(() {
      _queue.clear();
    });
    _showSnackBar('队列已清空');
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
                  '队列操作',
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
                          hintText: '输入要入队的值',
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
                      onPressed: _isAnimating ? null : _enqueue,
                      icon: const Icon(Icons.add),
                      label: const Text('Enqueue'),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: _isAnimating ? null : _dequeue,
                      icon: const Icon(Icons.remove),
                      label: const Text('Dequeue'),
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
                        '队列可视化',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        '容量: ${_queue.length} / $_maxSize',
                        style: theme.textTheme.bodyMedium,
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Expanded(
                    child: Center(
                      child: CustomPaint(
                        painter: QueuePainter(
                          queue: _queue,
                          maxSize: _maxSize,
                          enqueueAnimation: _enqueueAnimation,
                          dequeueAnimation: _dequeueAnimation,
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
                        _buildInfoItem('队首', _queue.isEmpty ? 'null' : _queue.first.toString()),
                        _buildInfoItem('队尾', _queue.isEmpty ? 'null' : _queue.last.toString()),
                        _buildInfoItem('大小', _queue.length.toString()),
                        _buildInfoItem('状态', _queue.isEmpty ? '空' : (_queue.length == _maxSize ? '满' : '正常')),
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
            fontSize: 16,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }
}

/// 队列绘制器
class QueuePainter extends CustomPainter {
  final List<int> queue;
  final int maxSize;
  final Animation<double>? enqueueAnimation;
  final Animation<double>? dequeueAnimation;
  final bool isAnimating;

  QueuePainter({
    required this.queue,
    required this.maxSize,
    this.enqueueAnimation,
    this.dequeueAnimation,
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
    
    // 计算队列的尺寸
    const double itemWidth = 60;
    const double itemHeight = 60;
    final double totalWidth = itemWidth * maxSize;
    final double startX = (size.width - totalWidth) / 2;
    final double startY = (size.height - itemHeight) / 2;
    
    // 绘制队列的容器
    final queueRect = Rect.fromLTWH(
      startX - 10,
      startY - 10,
      totalWidth + 20,
      itemHeight + 20,
    );
    canvas.drawRect(queueRect, borderPaint);
    
    // 绘制"队首"标签
    if (queue.isNotEmpty) {
      final frontTextPainter = TextPainter(
        text: const TextSpan(
          text: '队首',
          style: TextStyle(color: Colors.green, fontSize: 12, fontWeight: FontWeight.bold),
        ),
        textDirection: TextDirection.ltr,
      );
      frontTextPainter.layout();
      frontTextPainter.paint(
        canvas,
        Offset(startX, startY - 25),
      );
    }
    
    // 绘制"队尾"标签
    if (queue.isNotEmpty) {
      final rearTextPainter = TextPainter(
        text: const TextSpan(
          text: '队尾',
          style: TextStyle(color: Colors.red, fontSize: 12, fontWeight: FontWeight.bold),
        ),
        textDirection: TextDirection.ltr,
      );
      rearTextPainter.layout();
      rearTextPainter.paint(
        canvas,
        Offset(startX + (queue.length - 1) * itemWidth, startY + itemHeight + 5),
      );
    }
    
    // 绘制队列中的元素
    for (int i = 0; i < queue.length; i++) {
      double xOffset = startX + i * itemWidth;
      
      // 如果正在执行动画
      if (isAnimating) {
        if (dequeueAnimation != null && i == 0) {
          xOffset = startX - (itemWidth * dequeueAnimation!.value);
        } else if (enqueueAnimation != null && i == queue.length - 1) {
          xOffset = startX + (queue.length - 1) * itemWidth;
        }
      }
      
      // 绘制元素背景
      final elementRect = Rect.fromLTWH(
        xOffset,
        startY,
        itemWidth - 2,
        itemHeight,
      );
      
      if (i == 0) {
        paint.color = Colors.green.withOpacity(0.7);
      } else if (i == queue.length - 1) {
        paint.color = Colors.red.withOpacity(0.7);
      } else {
        paint.color = Colors.blue.withOpacity(0.5);
      }
      
      canvas.drawRRect(
        RRect.fromRectAndRadius(elementRect, const Radius.circular(4)),
        paint,
      );
      
      // 绘制元素值
      final textPainter = TextPainter(
        text: TextSpan(
          text: queue[i].toString(),
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
          xOffset + (itemWidth - textPainter.width) / 2,
          startY + (itemHeight - textPainter.height) / 2,
        ),
      );
    }
    
    // 绘制数据流向箭头
    if (queue.isNotEmpty) {
      final arrowPaint = Paint()
        ..color = Colors.blue
        ..strokeWidth = 2
        ..style = PaintingStyle.stroke;
      
      // 入队箭头（右侧）
      final Path enqueueArrow = Path();
      enqueueArrow.moveTo(size.width - 40, startY + itemHeight / 2);
      enqueueArrow.lineTo(startX + totalWidth + 30, startY + itemHeight / 2);
      enqueueArrow.moveTo(startX + totalWidth + 30, startY + itemHeight / 2);
      enqueueArrow.lineTo(startX + totalWidth + 20, startY + itemHeight / 2 - 10);
      enqueueArrow.moveTo(startX + totalWidth + 30, startY + itemHeight / 2);
      enqueueArrow.lineTo(startX + totalWidth + 20, startY + itemHeight / 2 + 10);
      canvas.drawPath(enqueueArrow, arrowPaint);
      
      // 出队箭头（左侧）
      final Path dequeueArrow = Path();
      dequeueArrow.moveTo(startX - 30, startY + itemHeight / 2);
      dequeueArrow.lineTo(40, startY + itemHeight / 2);
      dequeueArrow.moveTo(40, startY + itemHeight / 2);
      dequeueArrow.lineTo(50, startY + itemHeight / 2 - 10);
      dequeueArrow.moveTo(40, startY + itemHeight / 2);
      dequeueArrow.lineTo(50, startY + itemHeight / 2 + 10);
      canvas.drawPath(dequeueArrow, arrowPaint);
      
      // 绘制文字标签
      final enqueueTextPainter = TextPainter(
        text: const TextSpan(
          text: '入队',
          style: TextStyle(color: Colors.blue, fontSize: 12),
        ),
        textDirection: TextDirection.ltr,
      );
      enqueueTextPainter.layout();
      enqueueTextPainter.paint(
        canvas,
        Offset(size.width - 80, startY + itemHeight / 2 - 20),
      );
      
      final dequeueTextPainter = TextPainter(
        text: const TextSpan(
          text: '出队',
          style: TextStyle(color: Colors.blue, fontSize: 12),
        ),
        textDirection: TextDirection.ltr,
      );
      dequeueTextPainter.layout();
      dequeueTextPainter.paint(
        canvas,
        Offset(20, startY + itemHeight / 2 - 20),
      );
    }
  }

  @override
  bool shouldRepaint(QueuePainter oldDelegate) {
    return oldDelegate.queue != queue ||
           oldDelegate.isAnimating != isAnimating ||
           oldDelegate.enqueueAnimation != enqueueAnimation ||
           oldDelegate.dequeueAnimation != dequeueAnimation;
  }
}
