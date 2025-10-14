import 'package:flutter/material.dart';

/// 链表节点
class ListNode {
  int value;
  ListNode? next;
  
  ListNode(this.value);
}

/// 链表可视化组件
class LinkedListVisualizer extends StatefulWidget {
  const LinkedListVisualizer({Key? key}) : super(key: key);

  @override
  State<LinkedListVisualizer> createState() => _LinkedListVisualizerState();
}

class _LinkedListVisualizerState extends State<LinkedListVisualizer>
    with SingleTickerProviderStateMixin {
  ListNode? _head;
  int _size = 0;
  final TextEditingController _valueController = TextEditingController();
  final TextEditingController _indexController = TextEditingController();
  late AnimationController _animationController;
  bool _isAnimating = false;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    );
    
    // 初始化示例链表
    _initializeSampleList();
  }

  @override
  void dispose() {
    _animationController.dispose();
    _valueController.dispose();
    _indexController.dispose();
    super.dispose();
  }

  void _initializeSampleList() {
    _head = ListNode(5);
    _head!.next = ListNode(8);
    _head!.next!.next = ListNode(3);
    _head!.next!.next!.next = ListNode(12);
    _size = 4;
  }

  void _addFirst() {
    final value = int.tryParse(_valueController.text);
    if (value == null) {
      _showSnackBar('请输入有效的整数');
      return;
    }
    
    setState(() {
      _isAnimating = true;
    });
    
    _animationController.forward(from: 0).then((_) {
      setState(() {
        final newNode = ListNode(value);
        newNode.next = _head;
        _head = newNode;
        _size++;
        _isAnimating = false;
        _valueController.clear();
      });
      _showSnackBar('在头部添加了节点: $value');
    });
  }

  void _addLast() {
    final value = int.tryParse(_valueController.text);
    if (value == null) {
      _showSnackBar('请输入有效的整数');
      return;
    }
    
    setState(() {
      _isAnimating = true;
    });
    
    _animationController.forward(from: 0).then((_) {
      setState(() {
        final newNode = ListNode(value);
        if (_head == null) {
          _head = newNode;
        } else {
          ListNode current = _head!;
          while (current.next != null) {
            current = current.next!;
          }
          current.next = newNode;
        }
        _size++;
        _isAnimating = false;
        _valueController.clear();
      });
      _showSnackBar('在尾部添加了节点: $value');
    });
  }

  void _insertAt() {
    final value = int.tryParse(_valueController.text);
    final index = int.tryParse(_indexController.text);
    
    if (value == null || index == null) {
      _showSnackBar('请输入有效的值和索引');
      return;
    }
    
    if (index < 0 || index > _size) {
      _showSnackBar('索引超出范围 (0-$_size)');
      return;
    }
    
    setState(() {
      _isAnimating = true;
    });
    
    _animationController.forward(from: 0).then((_) {
      setState(() {
        if (index == 0) {
          final newNode = ListNode(value);
          newNode.next = _head;
          _head = newNode;
        } else {
          ListNode? current = _head;
          for (int i = 0; i < index - 1 && current != null; i++) {
            current = current.next;
          }
          if (current != null) {
            final newNode = ListNode(value);
            newNode.next = current.next;
            current.next = newNode;
          }
        }
        _size++;
        _isAnimating = false;
        _valueController.clear();
        _indexController.clear();
      });
      _showSnackBar('在索引 $index 处插入了节点: $value');
    });
  }

  void _removeFirst() {
    if (_head == null) {
      _showSnackBar('链表为空！');
      return;
    }
    
    setState(() {
      _isAnimating = true;
    });
    
    _animationController.forward(from: 0).then((_) {
      final removedValue = _head!.value;
      setState(() {
        _head = _head!.next;
        _size--;
        _isAnimating = false;
      });
      _showSnackBar('删除了头节点: $removedValue');
    });
  }

  void _removeLast() {
    if (_head == null) {
      _showSnackBar('链表为空！');
      return;
    }
    
    setState(() {
      _isAnimating = true;
    });
    
    _animationController.forward(from: 0).then((_) {
      late int removedValue;
      setState(() {
        if (_head!.next == null) {
          removedValue = _head!.value;
          _head = null;
        } else {
          ListNode current = _head!;
          while (current.next!.next != null) {
            current = current.next!;
          }
          removedValue = current.next!.value;
          current.next = null;
        }
        _size--;
        _isAnimating = false;
      });
      _showSnackBar('删除了尾节点: $removedValue');
    });
  }

  void _removeAt() {
    final index = int.tryParse(_indexController.text);
    
    if (index == null) {
      _showSnackBar('请输入有效的索引');
      return;
    }
    
    if (_head == null) {
      _showSnackBar('链表为空！');
      return;
    }
    
    if (index < 0 || index >= _size) {
      _showSnackBar('索引超出范围 (0-${_size - 1})');
      return;
    }
    
    setState(() {
      _isAnimating = true;
    });
    
    _animationController.forward(from: 0).then((_) {
      int? removedValue;
      setState(() {
        if (index == 0) {
          removedValue = _head!.value;
          _head = _head!.next;
        } else {
          ListNode? current = _head;
          for (int i = 0; i < index - 1 && current != null; i++) {
            current = current.next;
          }
          if (current != null && current.next != null) {
            removedValue = current.next!.value;
            current.next = current.next!.next;
          }
        }
        _size--;
        _isAnimating = false;
        _indexController.clear();
      });
      if (removedValue != null) {
        _showSnackBar('删除了索引 $index 处的节点: $removedValue');
      }
    });
  }

  void _reverse() {
    if (_head == null) {
      _showSnackBar('链表为空！');
      return;
    }
    
    setState(() {
      _isAnimating = true;
    });
    
    _animationController.forward(from: 0).then((_) {
      setState(() {
        ListNode? prev = null;
        ListNode? current = _head;
        ListNode? next;
        
        while (current != null) {
          next = current.next;
          current.next = prev;
          prev = current;
          current = next;
        }
        _head = prev;
        _isAnimating = false;
      });
      _showSnackBar('链表已反转');
    });
  }

  void _clear() {
    setState(() {
      _head = null;
      _size = 0;
    });
    _showSnackBar('链表已清空');
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
                  '链表操作',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      flex: 2,
                      child: TextField(
                        controller: _valueController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          hintText: '值',
                          border: OutlineInputBorder(),
                          contentPadding: EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 8,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: _indexController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          hintText: '索引',
                          border: OutlineInputBorder(),
                          contentPadding: EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 8,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: _isAnimating ? null : _addFirst,
                      icon: const Icon(Icons.arrow_back, size: 16),
                      label: const Text('头插'),
                    ),
                    OutlinedButton.icon(
                      onPressed: _isAnimating ? null : _addLast,
                      icon: const Icon(Icons.arrow_forward, size: 16),
                      label: const Text('尾插'),
                    ),
                    OutlinedButton.icon(
                      onPressed: _isAnimating ? null : _insertAt,
                      icon: const Icon(Icons.add_circle_outline, size: 16),
                      label: const Text('插入'),
                    ),
                    OutlinedButton.icon(
                      onPressed: _isAnimating ? null : _removeFirst,
                      icon: const Icon(Icons.first_page, size: 16),
                      label: const Text('删头'),
                    ),
                    OutlinedButton.icon(
                      onPressed: _isAnimating ? null : _removeLast,
                      icon: const Icon(Icons.last_page, size: 16),
                      label: const Text('删尾'),
                    ),
                    OutlinedButton.icon(
                      onPressed: _isAnimating ? null : _removeAt,
                      icon: const Icon(Icons.remove_circle_outline, size: 16),
                      label: const Text('删除'),
                    ),
                    OutlinedButton.icon(
                      onPressed: _isAnimating ? null : _reverse,
                      icon: const Icon(Icons.swap_horiz, size: 16),
                      label: const Text('反转'),
                    ),
                    OutlinedButton.icon(
                      onPressed: _clear,
                      icon: const Icon(Icons.clear, size: 16),
                      label: const Text('清空'),
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
                        '链表可视化',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        '节点数: $_size',
                        style: theme.textTheme.bodyMedium,
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Expanded(
                    child: Center(
                      child: CustomPaint(
                        painter: LinkedListPainter(
                          head: _head,
                          isAnimating: _isAnimating,
                        ),
                        child: const SizedBox.expand(),
                      ),
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
}

/// 链表绘制器
class LinkedListPainter extends CustomPainter {
  final ListNode? head;
  final bool isAnimating;

  LinkedListPainter({
    this.head,
    required this.isAnimating,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (head == null) {
      _drawEmptyMessage(canvas, size);
      return;
    }
    
    final paint = Paint()
      ..style = PaintingStyle.fill;
    
    final borderPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = Colors.blue;
    
    final arrowPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = Colors.grey;
    
    // 计算节点参数
    const double nodeWidth = 80;
    const double nodeHeight = 50;
    const double spacing = 60;
    
    // 计算链表长度
    int listLength = 0;
    ListNode? temp = head;
    while (temp != null) {
      listLength++;
      temp = temp.next;
    }
    
    // 计算起始位置
    final double totalWidth = listLength * nodeWidth + (listLength - 1) * spacing;
    double startX = (size.width - totalWidth) / 2;
    final double startY = (size.height - nodeHeight) / 2;
    
    // 如果链表太长，调整布局
    if (startX < 20) {
      startX = 20;
    }
    
    // 绘制HEAD标签
    final headTextPainter = TextPainter(
      text: const TextSpan(
        text: 'HEAD',
        style: TextStyle(
          color: Colors.green,
          fontSize: 14,
          fontWeight: FontWeight.bold,
        ),
      ),
      textDirection: TextDirection.ltr,
    );
    headTextPainter.layout();
    headTextPainter.paint(
      canvas,
      Offset(startX + nodeWidth / 2 - headTextPainter.width / 2, startY - 30),
    );
    
    // 绘制节点
    ListNode? current = head;
    int index = 0;
    
    while (current != null) {
      final x = startX + index * (nodeWidth + spacing);
      
      // 绘制节点背景
      paint.color = index == 0 
          ? Colors.green.withOpacity(0.2)
          : Colors.blue.withOpacity(0.2);
      
      final nodeRect = RRect.fromRectAndRadius(
        Rect.fromLTWH(x, startY, nodeWidth, nodeHeight),
        const Radius.circular(8),
      );
      canvas.drawRRect(nodeRect, paint);
      canvas.drawRRect(nodeRect, borderPaint);
      
      // 绘制节点值
      final valueTextPainter = TextPainter(
        text: TextSpan(
          text: current.value.toString(),
          style: const TextStyle(
            color: Colors.black,
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        textDirection: TextDirection.ltr,
      );
      valueTextPainter.layout();
      valueTextPainter.paint(
        canvas,
        Offset(
          x + nodeWidth / 2 - valueTextPainter.width / 2,
          startY + nodeHeight / 2 - valueTextPainter.height / 2,
        ),
      );
      
      // 绘制索引
      final indexTextPainter = TextPainter(
        text: TextSpan(
          text: '[$index]',
          style: TextStyle(
            color: Colors.grey[600],
            fontSize: 11,
          ),
        ),
        textDirection: TextDirection.ltr,
      );
      indexTextPainter.layout();
      indexTextPainter.paint(
        canvas,
        Offset(
          x + nodeWidth / 2 - indexTextPainter.width / 2,
          startY + nodeHeight + 5,
        ),
      );
      
      // 绘制箭头（如果不是最后一个节点）
      if (current.next != null) {
        final arrowStartX = x + nodeWidth;
        final arrowEndX = x + nodeWidth + spacing;
        final arrowY = startY + nodeHeight / 2;
        
        // 绘制箭头线
        canvas.drawLine(
          Offset(arrowStartX, arrowY),
          Offset(arrowEndX, arrowY),
          arrowPaint,
        );
        
        // 绘制箭头头部
        final arrowPath = Path();
        arrowPath.moveTo(arrowEndX - 10, arrowY - 5);
        arrowPath.lineTo(arrowEndX, arrowY);
        arrowPath.lineTo(arrowEndX - 10, arrowY + 5);
        canvas.drawPath(arrowPath, arrowPaint);
      } else {
        // 绘制NULL指针
        final nullTextPainter = TextPainter(
          text: const TextSpan(
            text: 'NULL',
            style: TextStyle(
              color: Colors.red,
              fontSize: 12,
              fontWeight: FontWeight.bold,
            ),
          ),
          textDirection: TextDirection.ltr,
        );
        nullTextPainter.layout();
        nullTextPainter.paint(
          canvas,
          Offset(x + nodeWidth + 10, startY + nodeHeight / 2 - nullTextPainter.height / 2),
        );
      }
      
      current = current.next;
      index++;
    }
  }

  void _drawEmptyMessage(Canvas canvas, Size size) {
    final textPainter = TextPainter(
      text: const TextSpan(
        text: '链表为空',
        style: TextStyle(
          color: Colors.grey,
          fontSize: 20,
        ),
      ),
      textDirection: TextDirection.ltr,
    );
    textPainter.layout();
    textPainter.paint(
      canvas,
      Offset(
        (size.width - textPainter.width) / 2,
        (size.height - textPainter.height) / 2,
      ),
    );
  }

  @override
  bool shouldRepaint(LinkedListPainter oldDelegate) {
    return oldDelegate.head != head || oldDelegate.isAnimating != isAnimating;
  }
}
