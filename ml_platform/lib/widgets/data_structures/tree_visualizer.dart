
import 'package:flutter/material.dart';
import '../../services/tree_service.dart';
import 'dart:async';

enum TreeType {
  bst('二叉搜索树 (BST)'),
  avl('平衡二叉树 (AVL)');

  final String label;
  const TreeType(this.label);
}

class TreeVisualizer extends StatefulWidget {
  final TreeType initialType;
  
  const TreeVisualizer({Key? key, this.initialType = TreeType.bst}) : super(key: key);

  @override
  State<TreeVisualizer> createState() => TreeVisualizerState();
}

class TreeVisualizerState extends State<TreeVisualizer> with SingleTickerProviderStateMixin {
  final TreeService _treeService = TreeService();
  
  BSTNode? _root;
  late TreeType _currentType;
  
  // Animation State
  String _message = '就绪';
  bool _isAnimating = false;
  
  // Visual Highlights
  int? _highlightNodeValue;
  List<int> _searchPath = [];
  String? _rotationType; // 'left', 'right', 'left-right', 'right-left'

  @override
  void initState() {
    super.initState();
    _currentType = widget.initialType;
    _initializeSampleTree();
  }
  
  @override
  void didUpdateWidget(TreeVisualizer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialType != oldWidget.initialType && widget.initialType != _currentType) {
      setTreeType(widget.initialType);
    }
  }
  
  void _initializeSampleTree() async {
    // 初始树：50, 30, 70
    _root = BSTNode(50);
    _root!.left = BSTNode(30);
    _root!.right = BSTNode(70);
    _treeService.calculateTreeLayout(_root, 800, 600); // Initial layout assumptions
    if (mounted) setState(() {});
  }
  
  void setTreeType(TreeType type) {
    if (_isAnimating) return;
    setState(() {
      _currentType = type;
      _message = '切换到 ${type.label}. 请清空后重新开始体验特性。';
      // 注意：直接切换类型可能导致当前树不符合规则，建议用户清空
    });
  }

  // --- External Actions ---

  Future<void> insert(int value) async {
    if (_isAnimating) return;
    setState(() => _isAnimating = true);

    List<TreeStep> steps;
    if (_currentType == TreeType.bst) {
      steps = _treeService.bstInsert(_root, value);
    } else {
      steps = _treeService.avlInsert(_root, value);
    }

    await _playSteps(steps);
    
    if (mounted) {
      setState(() {
        _isAnimating = false;
        _highlightNodeValue = null;
        _searchPath.clear();
        _rotationType = null;
      });
    }
  }

  Future<void> delete(int value) async {
    if (_isAnimating) return;
    setState(() => _isAnimating = true);

    List<TreeStep> steps;
    if (_currentType == TreeType.bst) {
      steps = _treeService.bstDelete(_root, value);
    } else {
      steps = _treeService.avlDelete(_root, value);
    }

    await _playSteps(steps);

    if (mounted) {
      setState(() {
        _isAnimating = false;
        _highlightNodeValue = null;
        _searchPath.clear();
        _rotationType = null;
      });
    }
  }

  Future<void> search(int value) async {
    if (_isAnimating) return;
    setState(() => _isAnimating = true);

    // Search operations are usually same for BST/AVL in logic
    List<TreeStep> steps = _treeService.bstSearch(_root, value); // Standard BST search works for AVL

    await _playSteps(steps);

    if (mounted) {
      setState(() {
        _isAnimating = false;
        // Keep highlight for a moment to show result
      });
      await Future.delayed(const Duration(seconds: 1));
      if (mounted) {
        setState(() {
            _highlightNodeValue = null;
            _searchPath.clear();
        });
      }
    }
  }
  
  Future<void> _playSteps(List<TreeStep> steps) async {
    for (var step in steps) {
      if (!mounted) break;
      
      setState(() {
        _root = step.root;
        _message = step.description;
        _highlightNodeValue = step.highlightNode;
        _searchPath = step.searchPath;
        _rotationType = step.rotationType;
      });
      
      // 动画延迟
      int delay = 800;
      if (step.operation.contains('rotate')) {
        delay = 1500; // 旋转操作多展示一会
      }
      await Future.delayed(Duration(milliseconds: delay));
    }
  }

  void clear() {
    if (_isAnimating) return;
    setState(() {
      _root = null;
      _message = '树已清空';
      _highlightNodeValue = null;
      _searchPath.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Control Bar
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          color: Colors.grey.shade100,
          child: Row(
            children: [
              const Text('模式:', style: TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(width: 10),
              DropdownButton<TreeType>(
                value: _currentType,
                items: TreeType.values.map((t) => DropdownMenuItem(value: t, child: Text(t.label))).toList(),
                onChanged: (v) {
                  if (v != null) setTreeType(v);
                },
              ),
              const Spacer(),
              if (_root != null && _currentType == TreeType.avl)
                 const Tooltip(
                   message: "节点显示的数字: 值 (高度 | 平衡因子)",
                   child: Icon(Icons.info_outline, size: 20, color: Colors.blue),
                 ),
            ],
          ),
        ),
        
        // Message Bar
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(8.0),
          color: _rotationType != null ? Colors.orange.shade100 : Colors.blue.shade50,
          child: Text(
            _message, 
            textAlign: TextAlign.center,
            style: TextStyle(
              fontWeight: FontWeight.bold, 
              fontSize: 16, 
              color: _rotationType != null ? Colors.deepOrange : Colors.blue.shade800
            )
          ),
        ),
        
        // Visualizer Area
        Expanded(
          child: LayoutBuilder(
            builder: (ctx, constraints) {
               // Calculate positions based on current screen size
               _treeService.calculateTreeLayout(_root, constraints.maxWidth, constraints.maxHeight - 40);
               
               return Container(
                 width: double.infinity,
                 height: double.infinity,
                 color: Colors.white,
                 child: CustomPaint(
                   painter: TreePainter(
                     root: _root,
                     highlightValue: _highlightNodeValue,
                     searchPath: _searchPath,
                     showAvlInfo: _currentType == TreeType.avl,
                   ),
                 ),
               );
            },
          ),
        ),
      ],
    );
  }
}

class TreePainter extends CustomPainter {
  final BSTNode? root;
  final int? highlightValue;
  final List<int> searchPath;
  final bool showAvlInfo;
  
  TreePainter({
    this.root, 
    this.highlightValue, 
    required this.searchPath,
    this.showAvlInfo = false,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (root == null) return;
    
    final nodePaint = Paint()..style = PaintingStyle.fill..color = Colors.blue.shade100;
    final highlightPaint = Paint()..style = PaintingStyle.fill..color = Colors.orange;
    final pathPaint = Paint()..style = PaintingStyle.fill..color = Colors.green.shade200;
    
    final borderPaint = Paint()
      ..style = PaintingStyle.stroke
      ..color = Colors.blue
      ..strokeWidth = 2;
      
    final linePaint = Paint()
      ..color = Colors.grey
      ..strokeWidth = 2;
      
    final activeLinePaint = Paint()
      ..color = Colors.orange
      ..strokeWidth = 3;

    const double nodeRadius = 22;
    
    _drawRecursive(canvas, root!, nodeRadius, nodePaint, highlightPaint, pathPaint, borderPaint, linePaint, activeLinePaint);
  }
  
  void _drawRecursive(
    Canvas canvas, 
    BSTNode node, 
    double radius, 
    Paint normalPaint,
    Paint highlightPaint,
    Paint pathPaint,
    Paint borderPaint,
    Paint linePaint,
    Paint activeLinePaint
  ) {
    final x = node.x;
    final y = node.y + 30; // Add top padding

    // Draw lines to children
    if (node.left != null) {
      final childX = node.left!.x;
      final childY = node.left!.y + 30;
      
      // Highlight line if both nodes are in search path
      bool isPathLine = searchPath.contains(node.value) && searchPath.contains(node.left!.value);
      
      canvas.drawLine(Offset(x, y + radius), Offset(childX, childY - radius), isPathLine ? activeLinePaint : linePaint);
      _drawRecursive(canvas, node.left!, radius, normalPaint, highlightPaint, pathPaint, borderPaint, linePaint, activeLinePaint);
    }
    
    if (node.right != null) {
      final childX = node.right!.x;
      final childY = node.right!.y + 30;
      
      bool isPathLine = searchPath.contains(node.value) && searchPath.contains(node.right!.value);
      
      canvas.drawLine(Offset(x, y + radius), Offset(childX, childY - radius), isPathLine ? activeLinePaint : linePaint);
      _drawRecursive(canvas, node.right!, radius, normalPaint, highlightPaint, pathPaint, borderPaint, linePaint, activeLinePaint);
    }
    
    // Draw Node Bubble
    Paint effectivePaint = normalPaint;
    if (node.value == highlightValue) effectivePaint = highlightPaint;
    else if (searchPath.contains(node.value)) effectivePaint = pathPaint;
    
    canvas.drawCircle(Offset(x, y), radius, effectivePaint);
    canvas.drawCircle(Offset(x, y), radius, borderPaint);
    
    // Draw Value
    final textPainter = TextPainter(
      text: TextSpan(
        text: node.value.toString(),
        style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 16),
      ),
      textDirection: TextDirection.ltr,
    );
    textPainter.layout();
    textPainter.paint(canvas, Offset(x - textPainter.width / 2, y - textPainter.height / 2));
    
    // Draw AVL Info (Height / Balance)
    if (showAvlInfo) {
      // Height (Top Right)
      final heightPainter = TextPainter(
        text: TextSpan(
          text: 'H:${node.height}',
          style: TextStyle(color: Colors.grey.shade700, fontSize: 10),
        ),
        textDirection: TextDirection.ltr,
      );
      heightPainter.layout();
      heightPainter.paint(canvas, Offset(x + radius + 2, y - radius));
      
      // Balance (Bottom Right)
      // Balance = left height - right height (needs calc or store in node, here we estimate or calc on fly)
      // To save complexity, we assume TreeService handles logic, but ui needs to show.
      // We will just show height for now as node structure only has height. 
      // Or we can simple text 'AVL' 
    }
  }

  @override
  bool shouldRepaint(TreePainter oldDelegate) => true; 
}
