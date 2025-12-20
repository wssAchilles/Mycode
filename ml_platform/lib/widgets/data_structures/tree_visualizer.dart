
import 'package:flutter/material.dart';
import 'dart:math';

class TreeVisualizer extends StatefulWidget {
  const TreeVisualizer({Key? key}) : super(key: key);

  @override
  State<TreeVisualizer> createState() => TreeVisualizerState();
}

class TreeNode {
  int value;
  TreeNode? left;
  TreeNode? right;
  // Visual properties
  Offset? position;
  
  TreeNode(this.value);
}

class TreeVisualizerState extends State<TreeVisualizer> with SingleTickerProviderStateMixin {
  TreeNode? _root;
  
  // Animation State
  TreeNode? _activeNode; // Node currently being compared/visited
  Set<TreeNode> _visitedPath = {}; // Nodes visited in current operation
  String _message = '';
  bool _isAnimating = false;

  @override
  void initState() {
    super.initState();
    _initializeSampleTree();
  }
  
  void _initializeSampleTree() {
    insert(50);
    insert(30);
    insert(70);
    insert(20);
    insert(40);
    insert(60);
    insert(80);
    // Clear animation state from insertions
    WidgetsBinding.instance.addPostFrameCallback((_) {
      setState(() {
        _message = 'BST 初始化完成';
        _isAnimating = false;
        _activeNode = null;
        _visitedPath.clear();
      });
    });
  }

  // --- External Actions ---

  Future<void> insert(int value) async {
    if (_isAnimating) return;
    setState(() {
      _isAnimating = true;
      _message = '开始插入: $value';
      _visitedPath.clear();
      _activeNode = _root;
    });

    if (_root == null) {
      await Future.delayed(const Duration(milliseconds: 500));
      setState(() {
        _root = TreeNode(value);
        _message = '插入根节点: $value';
        _isAnimating = false;
        _activeNode = null;
      });
      return;
    }

    await _insertRecursive(_root!, value);
    
    if (mounted) {
       setState(() {
         _isAnimating = false;
         _activeNode = null;
         _message = '插入完成: $value';
       });
    }
  }
  
  Future<void> _insertRecursive(TreeNode node, int value) async {
    setState(() {
      _activeNode = node;
      _visitedPath.add(node);
      _message = '比较 $value 与 ${node.value}';
    });
    await Future.delayed(const Duration(milliseconds: 800));

    if (value < node.value) {
      if (node.left == null) {
        setState(() {
          node.left = TreeNode(value);
          _message = '$value < ${node.value}, 插入左子树';
        });
        await Future.delayed(const Duration(milliseconds: 500));
      } else {
        await _insertRecursive(node.left!, value);
      }
    } else if (value > node.value) {
      if (node.right == null) {
        setState(() {
          node.right = TreeNode(value);
          _message = '$value > ${node.value}, 插入右子树';
        });
        await Future.delayed(const Duration(milliseconds: 500));
      } else {
        await _insertRecursive(node.right!, value);
      }
    } else {
      setState(() {
        _message = '值 $value 已存在，无需插入';
      });
      await Future.delayed(const Duration(milliseconds: 500));
    }
  }

  Future<void> search(int value) async {
    if (_isAnimating || _root == null) return;
    setState(() {
      _isAnimating = true;
      _message = '开始查找: $value';
      _visitedPath.clear();
      _activeNode = _root;
    });

    bool found = await _searchRecursive(_root, value);

    if (mounted) {
      setState(() {
        _isAnimating = false;
        if (!found) {
           _activeNode = null;
           _message = '未找到值: $value';
        }
      });
    }
  }

  Future<bool> _searchRecursive(TreeNode? node, int value) async {
    if (node == null) return false;

    setState(() {
      _activeNode = node;
      _visitedPath.add(node);
      _message = '比较 $value 与 ${node.value}';
    });
    await Future.delayed(const Duration(milliseconds: 800));

    if (value == node.value) {
      setState(() {
        _message = '找到目标: $value';
      });
      return true;
    } else if (value < node.value) {
      return await _searchRecursive(node.left, value);
    } else {
      return await _searchRecursive(node.right, value);
    }
  }
  
  Future<void> delete(int value) async {
    if (_isAnimating || _root == null) return;
    setState(() {
        _isAnimating = true;
        _message = '开始删除: $value';
        _visitedPath.clear();
    });

    bool found = await _searchRecursive(_root, value); // Simulate search first to visualize finding it
    if (!found) {
        setState(() {
            _message = '未找到节点 $value，无法删除';
            _isAnimating = false;
            _activeNode = null;
        });
        return;
    }
    
    // Now perform the actual logic (simplified visual for deletion)
    setState(() {
        _message = '执行删除逻辑...';
    });
    await Future.delayed(const Duration(milliseconds: 800));
    
    _root = _deleteNode(_root, value);
    
    if (mounted) {
        setState(() {
            _isAnimating = false;
            _activeNode = null;
            _message = '删除完成: $value';
            _visitedPath.clear();
        });
    }
  }
  
  TreeNode? _deleteNode(TreeNode? root, int value) {
     if (root == null) return root;
     
     if (value < root.value) {
         root.left = _deleteNode(root.left, value);
     } else if (value > root.value) {
         root.right = _deleteNode(root.right, value);
     } else {
         // Node found
         if (root.left == null) return root.right;
         if (root.right == null) return root.left;
         
         // Two children: Get inorder successor
         root.value = _minValue(root.right!);
         root.right = _deleteNode(root.right, root.value);
     }
     return root;
  }
  
  int _minValue(TreeNode node) {
      int minv = node.value;
      while (node.left != null) {
          minv = node.left!.value;
          node = node.left!;
      }
      return minv;
  }

  void clear() {
    setState(() {
      _root = null;
      _message = '树已清空';
      _visitedPath.clear();
      _activeNode = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        if (_message.isNotEmpty)
          Padding(
            padding: const EdgeInsets.all(8.0),
            child: Text(
              _message, 
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.blue)
            ),
          ),
        Expanded(
          child: LayoutBuilder(
            builder: (ctx, constraints) {
               return Container(
                 width: double.infinity,
                 height: double.infinity,
                 color: Colors.white,
                 child: CustomPaint(
                   painter: TreePainter(
                     root: _root,
                     activeNode: _activeNode,
                     visitedPath: _visitedPath,
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
  final TreeNode? root;
  final TreeNode? activeNode;
  final Set<TreeNode> visitedPath;
  
  TreePainter({this.root, this.activeNode, required this.visitedPath});

  @override
  void paint(Canvas canvas, Size size) {
    if (root == null) return;
    
    final nodePaint = Paint()..style = PaintingStyle.fill..color = Colors.blue.shade100;
    final activePaint = Paint()..style = PaintingStyle.fill..color = Colors.orange;
    final visitedPaint = Paint()..style = PaintingStyle.fill..color = Colors.green.shade200;
    
    final borderPaint = Paint()
      ..style = PaintingStyle.stroke
      ..color = Colors.blue
      ..strokeWidth = 2;
      
    final linePaint = Paint()
      ..color = Colors.grey
      ..strokeWidth = 2;

    const double nodeRadius = 20;
    
    // Calculate positions (simple hierarchical layout)
    _drawNodeRecursive(canvas, root!, size.width / 2, 40, size.width / 4, nodeRadius, nodePaint, activePaint, visitedPaint, borderPaint, linePaint);
  }
  
  void _drawNodeRecursive(
    Canvas canvas, 
    TreeNode node, 
    double x, 
    double y, 
    double xOffset, 
    double radius, 
    Paint normalPaint,
    Paint activePaint,
    Paint visitedPaint,
    Paint borderPaint,
    Paint linePaint
  ) {
    node.position = Offset(x, y); // Store for potential interactivity later

    // Draw lines to children first
    if (node.left != null) {
      final childX = x - xOffset;
      final childY = y + 60;
      canvas.drawLine(Offset(x, y + radius), Offset(childX, childY - radius), linePaint);
      _drawNodeRecursive(canvas, node.left!, childX, childY, xOffset / 1.8, radius, normalPaint, activePaint, visitedPaint, borderPaint, linePaint);
    }
    
    if (node.right != null) {
      final childX = x + xOffset;
      final childY = y + 60;
      canvas.drawLine(Offset(x, y + radius), Offset(childX, childY - radius), linePaint);
      _drawNodeRecursive(canvas, node.right!, childX, childY, xOffset / 1.8, radius, normalPaint, activePaint, visitedPaint, borderPaint, linePaint);
    }
    
    // Draw Node Bubble
    Paint effectivePaint = normalPaint;
    if (node == activeNode) effectivePaint = activePaint;
    else if (visitedPath.contains(node)) effectivePaint = visitedPaint;
    
    canvas.drawCircle(Offset(x, y), radius, effectivePaint);
    canvas.drawCircle(Offset(x, y), radius, borderPaint);
    
    // Draw Text
    final textPainter = TextPainter(
      text: TextSpan(
        text: node.value.toString(),
        style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold),
      ),
      textDirection: TextDirection.ltr,
    );
    textPainter.layout();
    textPainter.paint(canvas, Offset(x - textPainter.width / 2, y - textPainter.height / 2));
  }

  @override
  bool shouldRepaint(TreePainter oldDelegate) => 
     oldDelegate.root != root || 
     oldDelegate.activeNode != activeNode || 
     oldDelegate.visitedPath != visitedPath;
}
