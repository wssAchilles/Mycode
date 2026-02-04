import 'package:flutter/material.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'dart:math' as math;

import '../../models/data_structure_model.dart';
import '../../services/data_structure_service.dart';


enum LinkedListType {
  singly('单向链表'),
  doubly('双向链表');

  final String label;
  const LinkedListType(this.label);
}

/// 链表可视化组件
class LinkedListVisualizer extends StatefulWidget {
  final LinkedListType initialType;
  const LinkedListVisualizer({Key? key, this.initialType = LinkedListType.singly}) : super(key: key);

  @override
  State<LinkedListVisualizer> createState() => LinkedListVisualizerState();
}

class LinkedListVisualizerState extends State<LinkedListVisualizer>
    with SingleTickerProviderStateMixin {
  ListNode<int>? _head;
  int _size = 0;
  late LinkedListType _currentType;
  
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
    _currentType = widget.initialType;
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    );
    
    // 初始化示例链表
    _initializeSampleList();
  }
  
  @override
  void didUpdateWidget(LinkedListVisualizer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialType != oldWidget.initialType && widget.initialType != _currentType) {
      setType(widget.initialType);
    }
  }

  void setType(LinkedListType type) {
    if (_isAnimating) return;
    if (_currentType == type) return;
    setState(() {
      _currentType = type;
      _initializeSampleList(); // Reset list on type change
    });
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
    var node2 = ListNode(8);
    var node3 = ListNode(3);
    var node4 = ListNode(12);
    
    _head!.next = node2;
    node2.next = node3;
    node3.next = node4;
    
    if (_currentType == LinkedListType.doubly) {
      node2.prev = _head;
      node3.prev = node2;
      node4.prev = node3;
    }
    
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
    insertNode(value, 0);
    _valueController.clear();
  }

  void _addLast() {
    final value = int.tryParse(_valueController.text);
    if (value == null) {
      _showSnackBar('请输入有效的整数');
      return;
    }
    insertNode(value, _size);
    _valueController.clear();
  }

  void _insertAt() {
    final value = int.tryParse(_valueController.text);
    final index = int.tryParse(_indexController.text);
    
    if (value == null || index == null) {
      _showSnackBar('请输入有效的值和索引');
      return;
    }
    
    insertNode(value, index);
    _valueController.clear();
    _indexController.clear();
  }

  void _removeFirst() {
    if (_size == 0) {
       _showSnackBar('链表为空');
       return;
    }
    deleteNode(0);
  }

  void _removeLast() {
    if (_size == 0) {
       _showSnackBar('链表为空');
       return;
    }
    deleteNode(_size - 1);
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
  
  void insertNode(int value, int index) {
     if (index < 0 || index > _size) {
       _showSnackBar('索引超出范围 (0-$_size)');
       return;
     }
     
     List<DataStructureStep> steps;
     if (_currentType == LinkedListType.doubly) {
        steps = _service.doublyLinkedListInsert(_head, value, index);
     } else {
        steps = _service.linkedListInsert(_head, value, index);
     }
     _playSteps(steps);
  }

  void deleteNode(int index) {
      if (index < 0 || index >= _size) {
        _showSnackBar('索引超出范围 (0-${_size - 1})');
        return;
      }
      
      List<DataStructureStep> steps;
      if (_currentType == LinkedListType.doubly) {
         steps = _service.doublyLinkedListDelete(_head, index);
      } else {
         steps = _service.linkedListDelete(_head, index);
      }
      
      _playSteps(steps);
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

  void _reverse() {
    if (_head == null) {
      _showSnackBar('链表为空！');
      return;
    }
    
    setState(() => _isAnimating = true);
    
    Future.delayed(const Duration(milliseconds: 500), () {
        if (!mounted) return;
        setState(() {
            ListNode<int>? current = _head;
            ListNode<int>? temp = null;
            
            while (current != null) {
                temp = current.prev;
                current.prev = current.next;
                current.next = temp;
                current = current.prev; 
            }
            
            if (_currentType == LinkedListType.singly) {
                 ListNode<int>? prev = null;
                 ListNode<int>? curr = _head;
                 ListNode<int>? next;
                 while (curr != null) {
                     next = curr.next;
                     curr.next = prev;
                     prev = curr;
                     curr = next;
                 }
                 _head = prev;
            } else {
                 if (temp != null) {
                     _head = temp.prev;
                 }
            }
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
                          labelText: '值',
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
                          labelText: '索引',
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
  final LinkedListType type;

  LinkedListPainter({
    this.head,
    required this.isAnimating,
    this.highlightedIndices = const [],
    this.type = LinkedListType.singly,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (head == null) {
      _drawEmptyMessage(canvas, size);
      return;
    }
    
    final paint = Paint()
      ..style = PaintingStyle.fill;
    
    // ... paint setup ...
    final arrowPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = AppTheme.borderStrong;
      
    // 计算节点参数
    const double nodeWidth = 80;
    const double nodeHeight = 50;
    const double spacing = 60;
    
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
    
    if (startX < 20) startX = 20;
    
    // 绘制HEAD标签
    _drawHeadLabel(canvas, startX, startY, nodeWidth);
    
    // 绘制节点
    ListNode<int>? current = head;
    int index = 0;
    
    while (current != null) {
      final x = startX + index * (nodeWidth + spacing);
      
      // ... 节点背景与高亮逻辑 (kept similar) ...
      Color nodeColor = AppTheme.primary.withOpacity(0.2);
      Color borderColor = AppTheme.primary;
      
      if (highlightedIndices.contains(index)) {
        nodeColor = AppTheme.warning.withOpacity(0.4);
        borderColor = AppTheme.warning;
      }
      
      paint.color = nodeColor;
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
      
      // 值绘制
      _drawText(canvas, current.value.toString(), x + nodeWidth / 2, startY + nodeHeight / 2, 
          style: const TextStyle(color: AppTheme.background, fontSize: 18, fontWeight: FontWeight.bold));
      
      // 索引绘制
      _drawText(canvas, '[$index]', x + nodeWidth / 2, startY + nodeHeight + 10,
          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11));
      
      // 绘制箭头
      if (current.next != null) {
        final arrowStartX = x + nodeWidth;
        final arrowEndX = x + nodeWidth + spacing;
        final arrowTopY = startY + nodeHeight / 3;
        final arrowBottomY = startY + nodeHeight * 2 / 3;
        
        if (type == LinkedListType.singly) {
            // 单向箭头（居中）
            final arrowY = startY + nodeHeight / 2;
            _drawArrow(canvas, Offset(arrowStartX, arrowY), Offset(arrowEndX, arrowY), arrowPaint);
        } else {
            // 双向箭头
            // Next 箭头 (Top)
            _drawArrow(canvas, Offset(arrowStartX, arrowTopY), Offset(arrowEndX, arrowTopY), arrowPaint);
            
            // Prev 箭头 (Bottom) - Backwards
            _drawArrow(canvas, Offset(arrowEndX, arrowBottomY), Offset(arrowStartX, arrowBottomY), arrowPaint);
        }
      } else {
        // NULL 指针
        _drawText(canvas, 'NULL', x + nodeWidth + 25, startY + nodeHeight / 2, 
            style: const TextStyle(color: AppTheme.error, fontSize: 12, fontWeight: FontWeight.bold));
      }
      
      current = current.next;
      index++;
    }
  }

  void _drawArrow(Canvas canvas, Offset start, Offset end, Paint paint) {
    canvas.drawLine(start, end, paint);
    
    // Arrow head
    final double angle = math.atan2(end.dy - start.dy, end.dx - start.dx);
    final double arrowSize = 6;
    
    final path = Path();
    path.moveTo(end.dx - arrowSize * math.cos(angle - math.pi / 6), end.dy - arrowSize * math.sin(angle - math.pi / 6));
    path.lineTo(end.dx, end.dy);
    path.lineTo(end.dx - arrowSize * math.cos(angle + math.pi / 6), end.dy - arrowSize * math.sin(angle + math.pi / 6));
    canvas.drawPath(path, paint);
  }
  
  void _drawHeadLabel(Canvas canvas, double x, double y, double w) {
      _drawText(canvas, 'HEAD', x + w / 2, y - 20, 
          style: const TextStyle(color: AppTheme.success, fontSize: 14, fontWeight: FontWeight.bold));
  }
  
  void _drawText(Canvas canvas, String text, double x, double y, {TextStyle? style}) {
    final textPainter = TextPainter(
      text: TextSpan(text: text, style: style),
      textDirection: TextDirection.ltr,
    );
    textPainter.layout();
    textPainter.paint(canvas, Offset(x - textPainter.width / 2, y - textPainter.height / 2));
  }

  void _drawEmptyMessage(Canvas canvas, Size size) {
    final textPainter = TextPainter(
      text: const TextSpan(
        text: '链表为空',
        style: TextStyle(color: AppTheme.textSecondary, fontSize: 20),
      ),
      textDirection: TextDirection.ltr,
    );
    textPainter.layout();
    textPainter.paint(
      canvas,
      Offset((size.width - textPainter.width) / 2, (size.height - textPainter.height) / 2),
    );
  }

  @override
  bool shouldRepaint(LinkedListPainter oldDelegate) {
    return oldDelegate.head != head || 
           oldDelegate.isAnimating != isAnimating ||
           oldDelegate.highlightedIndices != highlightedIndices ||
           oldDelegate.type != type;
  }
}
