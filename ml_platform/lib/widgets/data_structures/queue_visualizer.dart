import 'package:flutter/material.dart';
import 'package:ml_platform/config/app_theme.dart';

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
      duration: const Duration(milliseconds: 600),
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

  void enqueue([int? val]) {
    int? value = val;
    if (value == null) {
      value = int.tryParse(_inputController.text);
    }
    
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
      _queue.add(value!); // Add immediately for painting
    });
    
    _enqueueAnimation = Tween<double>(
      begin: 0.0,
      end: 1.0,
    ).animate(CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeInOutCubic, // Smoother curve
    ));
    
    _animationController.forward(from: 0).then((_) {
      setState(() {
        _isAnimating = false;
        _inputController.clear();
        _enqueueAnimation = null;
      });
    });
  }

  void dequeue() {
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
      curve: Curves.easeInOutCubic,
    ));
    
    _animationController.forward(from: 0).then((_) {
      setState(() {
        final removed = _queue.removeAt(0);
        _isAnimating = false;
        _dequeueAnimation = null;
        _showSnackBar('出队元素: $removed');
      });
    });
  }

  void peek() {
    if (_queue.isEmpty) {
      _showSnackBar('队列为空！');
      return;
    }
    
    _showSnackBar('队首元素: ${_queue.first}');
  }

  void clear() {
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
                          labelText: '入队值',
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
                      onPressed: _isAnimating ? null : () => enqueue(),
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
                      onPressed: _isAnimating ? null : dequeue,
                      icon: const Icon(Icons.remove),
                      label: const Text('Dequeue'),
                    ),
                    OutlinedButton.icon(
                      onPressed: peek,
                      icon: const Icon(Icons.visibility),
                      label: const Text('Peek'),
                    ),
                    OutlinedButton.icon(
                      onPressed: clear,
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
                    child: LayoutBuilder(
                      builder: (context, constraints) {
                        // 计算所需宽度：(最大容量 * 元素宽度) + 左右预留(剪头和标签)
                        const double itemWidth = 60.0;
                         // 预留足够空间给左右箭头
                        final double requiredWidth = (_maxSize * itemWidth) + 150.0;
                        final double canvasWidth = requiredWidth > constraints.maxWidth
                            ? requiredWidth
                            : constraints.maxWidth;

                        return SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: SizedBox(
                            width: canvasWidth,
                            height: constraints.maxHeight,
                            child: CustomPaint(
                              painter: QueuePainter(
                                queue: List.of(_queue), // Pass copy to ensure repaint
                                maxSize: _maxSize,
                                enqueueAnimation: _enqueueAnimation,
                                dequeueAnimation: _dequeueAnimation,
                                isAnimating: _isAnimating,
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 16),
                  // 信息显示
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppTheme.surfaceHighlight,
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
            color: AppTheme.textSecondary,
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
    final paint = Paint()..style = PaintingStyle.fill;
    
    final borderPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = AppTheme.borderStrong;
    
    // Config dimensions
    const double itemWidth = 60;
    const double itemHeight = 60;
    const double spacing = 2.0; // Small gap between items
    final double totalWidth = (itemWidth + spacing) * maxSize; 
    final double startX = (size.width - totalWidth) / 2;
    final double startY = (size.height - itemHeight) / 2;
    
    // Draw queue container (background track)
    final queueRect = Rect.fromLTWH(
      startX - 10,
      startY - 10,
      totalWidth + 20,
      itemHeight + 20,
    );
    canvas.drawRRect(
        RRect.fromRectAndRadius(queueRect, const Radius.circular(12)), 
        borderPaint
    );
    
    // Draw elements
    for (int i = 0; i < queue.length; i++) {
      double xOffset = startX + i * (itemWidth + spacing);
      double opacity = 1.0;
      double scale = 1.0;

      // Animation Logic
      if (isAnimating) {
        if (dequeueAnimation != null) {
          // Dequeue: All items shift left
          final animVal = dequeueAnimation!.value;
          
          if (i == 0) {
            // Head item moves out to left and fades
            xOffset -= (itemWidth + spacing) * animVal;
            opacity = (1.0 - animVal).clamp(0.0, 1.0);
            scale = (1.0 - 0.2 * animVal); // Slight shrink
          } else {
            // Other items shift left to fill gap
            xOffset -= (itemWidth + spacing) * animVal;
          }
        } else if (enqueueAnimation != null && i == queue.length - 1) {
          // Enqueue: New tail item slides in from right/fades in
          final animVal = enqueueAnimation!.value;
          // Start from slightly right
          double startSlide = 50.0; 
          xOffset += startSlide * (1.0 - animVal);
          opacity = animVal.clamp(0.0, 1.0);
          scale = 0.5 + 0.5 * animVal; // Grow scale
        }
      }

      // Draw Item
      if (opacity > 0) {
        _drawItem(
          canvas, 
          xOffset, 
          startY, 
          itemWidth, 
          itemHeight, 
          queue[i], 
          i, 
          opacity, 
          scale
        );
      }
    }
    
    // Draw Labels (Front/Rear) - dynamic positions
    if (queue.isNotEmpty) {
        // Calculate Front Label Position
        double frontX = startX + 0 * (itemWidth + spacing); // Default front is index 0
        // During dequeue, if index 0 is leaving, the "Visual Front" is technically shifting? 
        // Or we keep label at index 0? Let's keep labels static relative to slots or track the "new" front.
        // For simplicity, let's keep labels fixed to the visual elements if they exist.
        
        // Actually, let's draw labels based on current visual indices. 
        // But during dequeue, index 0 is fading out. The label should probably stay with it or fade out.
        
        // Front Label
        if (!(isAnimating && dequeueAnimation != null && dequeueAnimation!.value > 0.5)) {
             // Show 'Front' on index 0 until it's mostly gone
             // Or shift it? Let's just draw it at the calculated xOffset of index 0.
             // We need to re-calculate xOffset for index 0 to paint label correctly.
             double fX = startX;
             if (isAnimating && dequeueAnimation != null) {
                 fX -= (itemWidth + spacing) * dequeueAnimation!.value;
             }
             _drawLabel(canvas, fX + itemWidth/2, startY - 25, '队首', AppTheme.success);
        } else if (isAnimating && dequeueAnimation != null && queue.length > 1) {
             // If index 0 is gone, index 1 is becoming front. 
             // Coordinate of index 1 is: startX + (itemWidth+sp) - (itemWidth+sp)*animVal
             // At end of anim, it is at startX.
             double fX = startX + (itemWidth + spacing) - (itemWidth + spacing) * dequeueAnimation!.value;
             _drawLabel(canvas, fX + itemWidth/2, startY - 25, '队首', AppTheme.success);
        }

        // Rear Label
         int tailIdx = queue.length - 1;
         double rX = startX + tailIdx * (itemWidth + spacing);
         if (isAnimating && enqueueAnimation != null) {
            // Tail is animating in
             double startSlide = 50.0;
             rX += startSlide * (1.0 - enqueueAnimation!.value);
         } else if (isAnimating && dequeueAnimation != null) {
             // Tail is shifting left
             rX -= (itemWidth + spacing) * dequeueAnimation!.value;
         }
         _drawLabel(canvas, rX + itemWidth/2, startY + itemHeight + 10, '队尾', AppTheme.error);
    }
  }

  void _drawItem(Canvas canvas, double x, double y, double width, double height, int val, int index, double opacity, double scale) {
    if (opacity <= 0) return;
    
    final paint = Paint()
      ..style = PaintingStyle.fill
      ..color = _getColorForIndex(index).withOpacity(opacity);

    // Apply scaling
    double w = width * scale;
    double h = height * scale;
    double dx = x + (width - w) / 2;
    double dy = y + (height - h) / 2;

    final rect = RRect.fromRectAndRadius(
      Rect.fromLTWH(dx, dy, w, h),
      const Radius.circular(8),
    );

    canvas.drawRRect(rect, paint);
    
    // Draw text
    final textPainter = TextPainter(
      text: TextSpan(
        text: val.toString(),
        style: TextStyle(
          color: AppTheme.textPrimary.withOpacity(opacity),
          fontSize: 16 * scale,
          fontWeight: FontWeight.bold,
        ),
      ),
      textDirection: TextDirection.ltr,
    );
    textPainter.layout();
    textPainter.paint(
      canvas,
      Offset(dx + (w - textPainter.width) / 2, dy + (h - textPainter.height) / 2),
    );
  }

  void _drawLabel(Canvas canvas, double cx, double cy, String text, Color color) {
      final tp = TextPainter(
        text: TextSpan(
          text: text,
          style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.bold),
        ),
        textDirection: TextDirection.ltr,
      );
      tp.layout();
      tp.paint(canvas, Offset(cx - tp.width / 2, cy - tp.height / 2));
  }

  Color _getColorForIndex(int index) {
     // During Enqueue, the new item is queue.length - 1
     // During Dequeue, 0 is green, last is red.
     // We can just keep simple generic colors or specific logic.
     if (queue.length == 1) return AppTheme.success;
     if (index == 0) return AppTheme.success;
     if (index == queue.length - 1) return AppTheme.error;
     return AppTheme.primary;
  }

  @override
  bool shouldRepaint(QueuePainter oldDelegate) {
    return oldDelegate.queue != queue ||
           oldDelegate.isAnimating != isAnimating ||
           oldDelegate.enqueueAnimation?.value != enqueueAnimation?.value ||
           oldDelegate.dequeueAnimation?.value != dequeueAnimation?.value;
  }
}
