import 'package:flutter/material.dart';

import '../../models/data_structure_model.dart';
import '../../services/data_structure_service.dart';

/// 链表可视化组件
class LinkedListVisualizer extends StatefulWidget {
  const LinkedListVisualizer({Key? key}) : super(key: key);

  @override
  State<LinkedListVisualizer> createState() => LinkedListVisualizerState();
}

class LinkedListVisualizerState extends State<LinkedListVisualizer>
    with SingleTickerProviderStateMixin {
  ListNode<int>? _head;
  int _size = 0;
  final TextEditingController _valueController = TextEditingController();
  final TextEditingController _indexController = TextEditingController();
  late AnimationController _animationController;
  final DataStructureService _service = DataStructureService();
  bool _isAnimating = false;
  
  // 用于可视化步骤回放
  List<String> _highlightedNodeIds = [];
  String _currentOperationDescription = '';

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
  
  Future<void> _playSteps(List<DataStructureStep> steps) async {
    setState(() {
      _isAnimating = true;
    });

    for (var step in steps) {
      if (!mounted) break;
      
      setState(() {
        _currentOperationDescription = step.description;
        // 如果 step.currentState 是链表头节点，则更新显示
        if (step.currentState is ListNode<int>?) {
           _head = step.currentState as ListNode<int>?;
        }
        _highlightedNodeIds = step.highlightedElements;
      });
      
      // 每个步骤暂停 800ms
      await Future.delayed(const Duration(milliseconds: 800));
    }

    if (mounted) {
      setState(() {
        _isAnimating = false;
        _highlightedNodeIds = [];
        _currentOperationDescription = '';
        // 重新计算 size
        _size = 0;
        var temp = _head;
        while(temp != null) {
          _size++;
          temp = temp.next;
        }
      });
    }
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

    final steps = _service.linkedListInsert(_head, value, index);
    _playSteps(steps);
    _valueController.clear();
    _indexController.clear();
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

  void deleteNode(int index) {
      if (index < 0 || index >= _size) {
        _showSnackBar('索引超出范围 (0-${_size - 1})');
        return;
      }
      _removeNodeAtIndex(index);
  }
  
  void searchNode(int value) async {
      if (_head == null) {
        _showSnackBar('链表为空');
        return;
      }
      
      setState(() { _isAnimating = true; });
      ListNode<int>? current = _head;
      int index = 0;
      bool found = false;

      while (current != null) {
          if (!mounted) break;
          // Highlight current node
          setState(() {
              _highlightedNodeIds = [index.toString()];
              _currentOperationDescription = '比较: [索引 $index] ${current!.value} vs $value';
          });
          
          await Future.delayed(const Duration(milliseconds: 800));
          
          if (current.value == value) {
              found = true;
              setState(() {
                 _currentOperationDescription = '找到目标: 索引 $index';
              });
              _showSnackBar('找到值 $value 在索引 $index');
              break;
          }
          current = current.next;
          index++;
      }
      
      if (!found) {
        _showSnackBar('链表中未找到值 $value');
      }

      await Future.delayed(const Duration(milliseconds: 1000));
      if (mounted) {
          setState(() {
              _isAnimating = false;
              _highlightedNodeIds = [];
              _currentOperationDescription = '';
          });
      }
  }
  
  void insertNode(int value, int index) {
     if (index < 0 || index > _size) {
       _showSnackBar('索引超出范围 (0-$_size)');
       return;
     }
     final steps = _service.linkedListInsert(_head, value, index);
     _playSteps(steps);
  }

  void _removeAt() {
    final index = int.tryParse(_indexController.text);
    if (index == null) {
      _showSnackBar('请输入有效的索引');
      return;
    }
    deleteNode(index);
    _indexController.clear();
  }

  void _removeNodeAtIndex(int index) {
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
        ListNode<int>? prev = null;
        ListNode<int>? current = _head;
        ListNode<int>? next;
        
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
                          highlightedIndices: _highlightedNodeIds.map((e) => int.tryParse(e) ?? -1).toList(),
                        ),
                        child: const SizedBox.expand(),
                      ),
                    ),
                  ),
                  if (_currentOperationDescription.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        '当前操作: $_currentOperationDescription',
                        style: TextStyle(
                          color: theme.primaryColor,
                          fontWeight: FontWeight.bold,
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
  final ListNode<int>? head;
  final bool isAnimating;
  final List<int> highlightedIndices;

  LinkedListPainter({
    this.head,
    required this.isAnimating,
    this.highlightedIndices = const [],
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
    // 计算链表长度
    int listLength = 0;
    ListNode<int>? temp = head;
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
    ListNode<int>? current = head;
    int index = 0;
    
    while (current != null) {
      final x = startX + index * (nodeWidth + spacing);
      
      // 绘制节点背景
      // 默认颜色
      Color nodeColor = Colors.blue.withOpacity(0.2);
      Color borderColor = Colors.blue;
      
      // 高亮逻辑
      if (highlightedIndices.contains(index)) {
        nodeColor = Colors.orange.withOpacity(0.4);
        borderColor = Colors.orange;
      }
      
      paint.color = nodeColor;
      // borderPaint.color = borderColor; // 需要修改 borderPaint 为动态
      
      final currentBorderPaint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = borderColor;

      final nodeRect = RRect.fromRectAndRadius(
        Rect.fromLTWH(x, startY, nodeWidth, nodeHeight),
        const Radius.circular(8),
      );
      canvas.drawRRect(nodeRect, paint);
      canvas.drawRRect(nodeRect, currentBorderPaint);
      
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
    return oldDelegate.head != head || 
           oldDelegate.isAnimating != isAnimating ||
           oldDelegate.highlightedIndices != highlightedIndices;
  }
}
