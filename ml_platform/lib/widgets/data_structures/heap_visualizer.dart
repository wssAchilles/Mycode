
import 'package:flutter/material.dart';
import 'dart:math';

/// 堆可视化组件 (最大堆)
class HeapVisualizer extends StatefulWidget {
  const HeapVisualizer({Key? key}) : super(key: key);

  @override
  State<HeapVisualizer> createState() => HeapVisualizerState();
}

class HeapVisualizerState extends State<HeapVisualizer> with SingleTickerProviderStateMixin {
  final List<int> _heap = [];
  bool _isAnimating = false;
  String _message = '';
  
  // Animation state
  int? _activeIdx;
  int? _targetIdx;
  Color _highlightColor = Colors.orange;

  @override
  void initState() {
    super.initState();
    _initializeSampleHeap();
  }

  void _initializeSampleHeap() {
    _heap.addAll([50, 30, 20, 15, 10, 8, 16]);
  }

  // Insert
  Future<void> insert(int value) async {
    if (_isAnimating) return;
    setState(() {
      _isAnimating = true;
      _message = '插入元素: $value';
      _heap.add(value);
      _activeIdx = _heap.length - 1;
    });

    await Future.delayed(const Duration(milliseconds: 600));

    // Heapify Up
    int current = _heap.length - 1;
    while (current > 0) {
      if (!mounted) break;
      int parent = (current - 1) ~/ 2;
      
      setState(() {
         _activeIdx = current;
         _targetIdx = parent;
         _message = '比较: ${_heap[current]} > ${_heap[parent]} ?';
      });
      await Future.delayed(const Duration(milliseconds: 800));

      if (_heap[current] > _heap[parent]) {
        setState(() {
          _message = '交换: ${_heap[current]} (子) 和 ${_heap[parent]} (父)';
          // Swap
          int temp = _heap[current];
          _heap[current] = _heap[parent];
          _heap[parent] = temp;
          
          _activeIdx = parent;
          _targetIdx = current; 
        });
        current = parent;
        await Future.delayed(const Duration(milliseconds: 800));
      } else {
        setState(() {
          _message = '位置正确，无需交换';
        });
        await Future.delayed(const Duration(milliseconds: 500));
        break;
      }
    }

    if (mounted) {
      setState(() {
        _isAnimating = false;
        _activeIdx = null;
        _targetIdx = null;
        _message = '插入完成';
      });
    }
  }

  // Extract Max
  Future<void> extractMax() async {
    if (_heap.isEmpty || _isAnimating) return;

    setState(() {
      _isAnimating = true;
      _message = '移除最大值: ${_heap[0]}';
      _activeIdx = 0;
    });
    
    await Future.delayed(const Duration(milliseconds: 800));

    if (_heap.length == 1) {
       setState(() {
         _heap.removeAt(0);
         _isAnimating = false;
         _activeIdx = null;
         _message = '堆已空';
       });
       return;
    }

    setState(() {
      _message = '将末尾元素 ${_heap.last} 移至堆顶';
      _heap[0] = _heap.removeLast();
      _activeIdx = 0;
    });
    
    await Future.delayed(const Duration(milliseconds: 800));

    // Heapify Down
    int current = 0;
    while (true) {
      if (!mounted) break;
      int left = 2 * current + 1;
      int right = 2 * current + 2;
      int largest = current;

      if (left < _heap.length && _heap[left] > _heap[largest]) {
        largest = left;
      }
      if (right < _heap.length && _heap[right] > _heap[largest]) {
        largest = right;
      }

      if (largest != current) {
          setState(() {
             _activeIdx = current;
             _targetIdx = largest;
             _message = '比较并交换: ${_heap[current]} 和 ${_heap[largest]}';
          });
          await Future.delayed(const Duration(milliseconds: 800));
          
          setState(() {
            int temp = _heap[current];
            _heap[current] = _heap[largest];
            _heap[largest] = temp;
            _activeIdx = largest; 
             // current stays at old pos visually for a moment? No just updating indices
          });
          current = largest;
          await Future.delayed(const Duration(milliseconds: 800));
      } else {
         break;
      }
    }

    if (mounted) {
      setState(() {
        _isAnimating = false;
        _activeIdx = null;
        _targetIdx = null;
        _message = '移除完成';
      });
    }
  }
  
  void clear() {
    setState(() {
      _heap.clear();
      _message = '堆已清空';
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        if (_message.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Text(
              _message,
              style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.blue),
            ),
          ),
        Expanded(
          child: LayoutBuilder(
            builder: (ctx, constraints) {
               return SizedBox(
                 width: max(constraints.maxWidth, 600), // Ensure scrollable if large
                 height: constraints.maxHeight,
                 child: CustomPaint(
                   painter: HeapPainter(
                     heap: _heap,
                     activeIdx: _activeIdx,
                     targetIdx: _targetIdx,
                   ),
                   size: Size(constraints.maxWidth, constraints.maxHeight),
                 ),
               );
            },
          ),
        ),
      ],
    );
  }
}

class HeapPainter extends CustomPainter {
  final List<int> heap;
  final int? activeIdx;
  final int? targetIdx;

  HeapPainter({required this.heap, this.activeIdx, this.targetIdx});

  @override
  void paint(Canvas canvas, Size size) {
    if (heap.isEmpty) return;

    final paint = Paint()..style = PaintingStyle.fill;
    final linePaint = Paint()
      ..color = Colors.grey
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;
    
    // Config
    const double nodeRadius = 24.0;
    const double levelHeight = 80.0;
    
    // Dynamic mapping of index -> Offset
    // We can do a standard binary tree layout.
    // Root at center top.
    // Level i has 2^i nodes. 
    // To fit nicely, we assign each node a "column" index in its level or global x.
    
    // Simple recursive layout:
    // x = capacity / 2^depth? 
    // Let's use standard binary tree spacing logic.
    
    Map<int, Offset> positions = {};
    _calculatePositions(0, size.width / 2, 40.0, size.width / 4, 0, positions);

    // Draw lines first
    for (int i = 0; i < heap.length; i++) {
        if (i > 0) {
           int parent = (i - 1) ~/ 2;
           if (positions.containsKey(i) && positions.containsKey(parent)) {
              canvas.drawLine(positions[parent]!, positions[i]!, linePaint);
           }
        }
    }

    // Draw Nodes
    for (int i = 0; i < heap.length; i++) {
       if (!positions.containsKey(i)) continue;
       
       Offset center = positions[i]!;
       
       // Color logic
       Color color = Colors.blue.shade100;
       if (i == activeIdx) color = Colors.orange;
       if (i == targetIdx) color = Colors.red.shade300;
       
       paint.color = color;
       canvas.drawCircle(center, nodeRadius, paint);
       
       final borderPaint = Paint()
         ..color = Colors.blue
         ..style = PaintingStyle.stroke
         ..strokeWidth = 2;
       canvas.drawCircle(center, nodeRadius, borderPaint);

       // Text
       final tp = TextPainter(
         text: TextSpan(
           text: heap[i].toString(),
           style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold),
         ),
         textDirection: TextDirection.ltr
       );
       tp.layout();
       tp.paint(canvas, center - Offset(tp.width / 2, tp.height / 2));
       
       // Index Label (optional, small)
       /*
       final idxTp = TextPainter(
          text: TextSpan(text: '$i', style: TextStyle(fontSize: 10, color: Colors.grey)),
          textDirection: TextDirection.ltr
       );
       idxTp.layout();
       idxTp.paint(canvas, center + Offset(nodeRadius, -nodeRadius));
       */
    }
  }

  void _calculatePositions(int index, double x, double y, double xOffset, int level, Map<int, Offset> positions) {
      if (index >= heap.length) return;
      
      positions[index] = Offset(x, y);
      
      const double levelHeight = 80.0;
      
      _calculatePositions(2 * index + 1, x - xOffset, y + levelHeight, xOffset / 2, level + 1, positions);
      _calculatePositions(2 * index + 2, x + xOffset, y + levelHeight, xOffset / 2, level + 1, positions);
  }

  @override
  bool shouldRepaint(HeapPainter oldDelegate) {
    return oldDelegate.heap != heap || 
           oldDelegate.activeIdx != activeIdx || 
           oldDelegate.targetIdx != targetIdx;
  }
}
