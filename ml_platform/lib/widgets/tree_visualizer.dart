// 树形结构可视化组件
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:collection/collection.dart';
import 'package:ml_platform/services/tree_service.dart';

/// 树形结构可视化器
class TreeVisualizer extends StatefulWidget {
  final BSTNode? root;
  final List<int> searchPath;
  final int? highlightNode;
  final String? rotationType;
  final BSTNode? nextRoot; // For animation
  final AnimationController animationController;
  
  const TreeVisualizer({
    Key? key,
    required this.root,
    this.nextRoot,
    this.searchPath = const [],
    this.highlightNode,
    this.rotationType,
    required this.animationController,
  }) : super(key: key);
  
  @override
  State<TreeVisualizer> createState() => _TreeVisualizerState();
}

class _TreeVisualizerState extends State<TreeVisualizer>
    with SingleTickerProviderStateMixin {
  late AnimationController _rotationController;
  late Animation<double> _rotationAnimation;
  
  @override
  void initState() {
    super.initState();
    _rotationController = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    );
    _rotationAnimation = CurvedAnimation(
      parent: _rotationController,
      curve: Curves.easeInOut,
    );
  }
  
  @override
  void didUpdateWidget(TreeVisualizer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.rotationType != null && widget.rotationType != oldWidget.rotationType) {
      _rotationController.forward(from: 0);
    }
  }
  
  @override
  void dispose() {
    _rotationController.dispose();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (widget.root != null) {
          TreeService().calculateTreeLayout(
            widget.root,
            constraints.maxWidth,
            constraints.maxHeight,
          );
        }
        
        if (widget.nextRoot != null) {
           TreeService().calculateTreeLayout(
            widget.nextRoot,
            constraints.maxWidth,
            constraints.maxHeight,
          );
        }
        
        return CustomPaint(
          size: Size(constraints.maxWidth, constraints.maxHeight),
          painter: TreePainter(
            root: widget.root,
            nextRoot: widget.nextRoot,
            searchPath: widget.searchPath,
            highlightNode: widget.highlightNode,
            rotationType: widget.rotationType,
            animation: widget.animationController,
            rotationAnimation: _rotationAnimation,
          ),
        );
      },
    );
  }
}

/// 树形结构绘制器
class TreePainter extends CustomPainter {
  final BSTNode? root;
  final BSTNode? nextRoot;
  final List<int> searchPath;
  final int? highlightNode;
  final String? rotationType;
  final Animation<double> animation;
  final Animation<double> rotationAnimation;
  
  static const double nodeRadius = 20;
  
  TreePainter({
    required this.root,
    this.nextRoot,
    required this.searchPath,
    this.highlightNode,
    this.rotationType,
    required this.animation,
    required this.rotationAnimation,
  }) : super(repaint: Listenable.merge([animation, rotationAnimation]));
  
  @override
  void paint(Canvas canvas, Size size) {
    if (root == null) return;
    
    // 如果有 nextRoot 和 旋转动画，则进行插值绘制
    if (nextRoot != null && rotationType != null && rotationAnimation.value > 0) {
      _drawAnimatedTree(canvas);
    } else {
      // 静态或者其他动画
      _drawEdges(canvas, root);
      _drawNodes(canvas, root);
      
      // 仅当没有 nextRoot 时绘制简单的旋转指示器
      if (nextRoot == null && rotationType != null && rotationAnimation.value > 0) {
        _drawRotationEffect(canvas, size);
      }
    }
  }

  void _drawAnimatedTree(Canvas canvas) {
    // 1. 收集所有节点的位置
    final Map<int, Offset> startPos = {};
    final Map<int, Offset> endPos = {};
    final Map<int, BSTNode> nodes = {}; // Store node data
    
    _collectNodes(root, startPos, nodes);
    _collectNodes(nextRoot, endPos, nodes); // nextRoot defines the target positions
    
    // 2. 绘制边 (使用插值后的位置)
    // 这里的挑战是边的连接关系也在变化。
    // 在旋转过程中，父子关系变了。
    // 简单的做法：绘制 nextRoot 的拓扑结构，但是节点位置使用插值。
    // 这样当 t=0时，如果拓扑结构不同，原来的线会连接到错误的位置（看起来穿模）。
    // 更好的做法：fade out old edges, fade in new edges? 
    // 或者只绘制 end state 的拓扑，但是位置从 start 移动到 end。
    // 当 t=0 时，end state 拓扑 + start positions 可能看起来很乱。
    
    // 折衷方案：在前半段绘制 startStore edges，后半段绘制 endStore edges? 
    // 或者：一直绘制 start 结构的边，但是连接点的坐标在移动。
    // 但是 start 结构在旋转后某些边会断开。
    
    // 让我们尝试：绘制当前存在的连接关系。由于我们是对 node 位置进行插值。
    // 如果我们遍历 root (start state) 的边，并使用插值得出的 node 坐标画线。
    // 那么线会随着节点移动而移动。
    // 但是在这个过程中，有些边会消失(断开)，有些边会生成。
    // 比如 LL 旋转： y-left->x 变成 x-right->y。
    // start 状态下有 edge y->x。 end 状态下有 x->y。
    // 如果我们在 t=0.5 时，同时画 y->x 和 x->y，会重叠。
    
    // 简化：只绘制节点移动。边淡入淡出。
    // t < 0.5: Draw edges from root (start state), opacity 1.0 -> 0.0
    // t > 0.5: Draw edges from nextRoot (end state), opacity 0.0 -> 1.0
    
    final t = rotationAnimation.value;
    
    if (t < 0.5) {
      _drawInterpolatedEdges(canvas, root, startPos, endPos, t, 1.0 - (t * 2));
    } else {
      _drawInterpolatedEdges(canvas, nextRoot, startPos, endPos, t, (t - 0.5) * 2);
    }
    
    // 3. 绘制节点 (插值位置)
    // Union of all nodes
    final allKeys = {...startPos.keys, ...endPos.keys};
    for (var key in allKeys) {
      final s = startPos[key];
      final e = endPos[key];
      
      Offset currentPos;
      if (s != null && e != null) {
        currentPos = Offset.lerp(s, e, t)!;
      } else if (s != null) {
        currentPos = s; // Only in start (should not happen in rotation)
      } else {
        currentPos = e!; // Only in end
      }
      
      _drawSingleNode(canvas, nodes[key]!, currentPos, nodes[key]!.value == highlightNode);
    }
  }
  
  void _collectNodes(BSTNode? node, Map<int, Offset> positions, Map<int, BSTNode> nodeData) {
    if (node == null) return;
    positions[node.value] = Offset(node.x, node.y);
    nodeData[node.value] = node;
    _collectNodes(node.left, positions, nodeData);
    _collectNodes(node.right, positions, nodeData);
  }
  
  void _drawInterpolatedEdges(Canvas canvas, BSTNode? node, Map<int, Offset> startPos, Map<int, Offset> endPos, double t, double opacity) {
    if (node == null) return;
    
    final paint = Paint()
      ..color = Colors.grey.shade400.withOpacity(opacity)
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;
      
    final myPos = _getPoistion(node.value, startPos, endPos, t);
    
    if (node.left != null) {
       final childPos = _getPoistion(node.left!.value, startPos, endPos, t);
       canvas.drawLine(myPos, childPos, paint);
       _drawInterpolatedEdges(canvas, node.left, startPos, endPos, t, opacity);
    }
    
    if (node.right != null) {
       final childPos = _getPoistion(node.right!.value, startPos, endPos, t);
       canvas.drawLine(myPos, childPos, paint);
       _drawInterpolatedEdges(canvas, node.right, startPos, endPos, t, opacity);
    }
  }
  
  Offset _getPoistion(int value, Map<int, Offset> start, Map<int, Offset> end, double t) {
      final s = start[value];
      final e = end[value];
      if (s != null && e != null) return Offset.lerp(s, e, t)!;
      return s ?? e!;
  }
  
  void _drawSingleNode(Canvas canvas, BSTNode node, Offset center, bool isHighlighted) {
    Color nodeColor = Colors.blue;
    Color textColor = Colors.white;
    double scale = 1.0;
    
    
    // 绘制节点背景
    if (highlightNode == node.value) {
      // Keep blue for highlight, or maybe another color?
      // Original logic: highlight=Red. But now Red means color.
      // Let's use Yellow/Purple for highlight.
       nodeColor = Colors.green; // Highlight current node
       scale = 1.2 + 0.1 * math.sin(animation.value * 2 * math.pi);
    } else if (searchPath.contains(node.value)) {
       nodeColor = Colors.orange;
    } else {
       // R-B Color
       nodeColor = node.isRed ? Colors.red : Colors.black;
    }
    
    final paint = Paint()
      ..color = nodeColor
      ..style = PaintingStyle.fill;
    
    canvas.drawCircle(center, nodeRadius * scale, paint);
    
    // 绘制节点边框
    final borderPaint = Paint()
      ..color = nodeColor.withOpacity(0.8)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    
    canvas.drawCircle(center, nodeRadius * scale, borderPaint);
    
    // 绘制节点值
    _drawNodeValue(canvas, node.value.toString(), center, textColor);
    
    // 绘制高度标签（AVL树）
    if (node.height > 1) {
      _drawHeightLabel(canvas, node.height, Offset(center.dx + nodeRadius + 5, center.dy - nodeRadius - 5));
    }
  }

  void _drawEdges(Canvas canvas, BSTNode? node) {
    if (node == null) return;
    
    final paint = Paint()
      ..color = Colors.grey.shade400
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;
    
    if (node.left != null) {
      // 检查是否在搜索路径上
      if (searchPath.contains(node.value) && searchPath.contains(node.left!.value)) {
        paint.color = Colors.orange;
        paint.strokeWidth = 3;
      }
      
      canvas.drawLine(
        Offset(node.x, node.y),
        Offset(node.left!.x, node.left!.y),
        paint,
      );
      
      _drawEdges(canvas, node.left);
    }
    
    if (node.right != null) {
      // 重置画笔颜色
      paint.color = Colors.grey.shade400;
      paint.strokeWidth = 2;
      
      // 检查是否在搜索路径上
      if (searchPath.contains(node.value) && searchPath.contains(node.right!.value)) {
        paint.color = Colors.orange;
        paint.strokeWidth = 3;
      }
      
      canvas.drawLine(
        Offset(node.x, node.y),
        Offset(node.right!.x, node.right!.y),
        paint,
      );
      
      _drawEdges(canvas, node.right);
    }
  }
  
  void _drawNodes(Canvas canvas, BSTNode? node) {
    if (node == null) return;
    
    // 先绘制子节点（深度优先）
    _drawNodes(canvas, node.left);
    _drawNodes(canvas, node.right);
    
    // 确定节点颜色
    Color nodeColor = Colors.blue;
    Color textColor = Colors.white;
    double scale = 1.0;
    
    if (node.value == highlightNode) {
      nodeColor = Colors.red;
      scale = 1.2 + 0.1 * math.sin(animation.value * 2 * math.pi);
    } else if (searchPath.contains(node.value)) {
      nodeColor = Colors.orange;
    }
    
    // 绘制节点背景
    final paint = Paint()
      ..color = nodeColor
      ..style = PaintingStyle.fill;
    
    final center = Offset(node.x, node.y);
    canvas.drawCircle(center, nodeRadius * scale, paint);
    
    // 绘制节点边框
    final borderPaint = Paint()
      ..color = nodeColor.withOpacity(0.8)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    
    canvas.drawCircle(center, nodeRadius * scale, borderPaint);
    
    // 绘制节点值
    _drawNodeValue(canvas, node.value.toString(), center, textColor);
    
    // 绘制高度标签（AVL树）
    if (node.height > 1) {
      _drawHeightLabel(canvas, node.height, Offset(node.x + nodeRadius + 5, node.y - nodeRadius - 5));
    }
  }
  
  void _drawNodeValue(Canvas canvas, String value, Offset center, Color color) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: value,
        style: TextStyle(
          color: color,
          fontSize: 14,
          fontWeight: FontWeight.bold,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    
    textPainter.paint(
      canvas,
      center - Offset(textPainter.width / 2, textPainter.height / 2),
    );
  }
  
  void _drawHeightLabel(Canvas canvas, int height, Offset position) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: 'h=$height',
        style: TextStyle(
          color: Colors.grey.shade600,
          fontSize: 10,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    
    textPainter.paint(canvas, position);
  }
  
  void _drawRotationEffect(Canvas canvas, Size size) {
    if (rotationType == null) return;
    
    // 绘制旋转指示箭头
    final paint = Paint()
      ..color = Colors.purple.withOpacity(0.5 * rotationAnimation.value)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3;
    
    final center = Offset(size.width / 2, size.height / 2);
    final radius = 30.0;
    
    if (rotationType == 'left' || rotationType == 'right') {
      final startAngle = rotationType == 'left' ? -math.pi / 2 : math.pi / 2;
      final sweepAngle = (rotationType == 'left' ? -1 : 1) * math.pi * rotationAnimation.value;
      
      canvas.drawArc(
        Rect.fromCircle(center: center, radius: radius),
        startAngle,
        sweepAngle,
        false,
        paint,
      );
      
      // 绘制箭头
      final arrowTip = center + Offset(
        radius * math.cos(startAngle + sweepAngle),
        radius * math.sin(startAngle + sweepAngle),
      );
      
      _drawArrowHead(canvas, arrowTip, startAngle + sweepAngle, paint);
    }
  }
  
  void _drawArrowHead(Canvas canvas, Offset tip, double angle, Paint paint) {
    final path = Path();
    final arrowLength = 10.0;
    final arrowAngle = math.pi / 6;
    
    path.moveTo(tip.dx, tip.dy);
    path.lineTo(
      tip.dx - arrowLength * math.cos(angle - arrowAngle),
      tip.dy - arrowLength * math.sin(angle - arrowAngle),
    );
    path.moveTo(tip.dx, tip.dy);
    path.lineTo(
      tip.dx - arrowLength * math.cos(angle + arrowAngle),
      tip.dy - arrowLength * math.sin(angle + arrowAngle),
    );
    
    canvas.drawPath(path, paint);
  }
  
  @override
  bool shouldRepaint(covariant TreePainter oldDelegate) {
    // 使用深度比较来检查树结构是否真的发生了变化
    return !const DeepCollectionEquality().equals(oldDelegate.root, root) ||
        !const DeepCollectionEquality().equals(oldDelegate.nextRoot, nextRoot) ||
        !const DeepCollectionEquality().equals(oldDelegate.searchPath, searchPath) ||
        oldDelegate.highlightNode != highlightNode ||
        oldDelegate.rotationType != rotationType;
  }
}

/// 树操作控制面板
class TreeControlPanel extends StatefulWidget {
  final Function(String operation, int value) onOperation;
  final Function() onReset;
  final Function() onGenerateRandom;
  final bool isAVL;
  
  const TreeControlPanel({
    Key? key,
    required this.onOperation,
    required this.onReset,
    required this.onGenerateRandom,
    this.isAVL = false,
  }) : super(key: key);
  
  @override
  State<TreeControlPanel> createState() => _TreeControlPanelState();
}

class _TreeControlPanelState extends State<TreeControlPanel> {
  final TextEditingController _valueController = TextEditingController();
  String _selectedOperation = 'insert';
  
  @override
  void dispose() {
    _valueController.dispose();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.isAVL ? 'AVL树操作' : '二叉搜索树操作',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            
            // 操作选择
            Row(
              children: [
                Radio<String>(
                  value: 'insert',
                  groupValue: _selectedOperation,
                  onChanged: (value) => setState(() => _selectedOperation = value!),
                ),
                const Text('插入'),
                Radio<String>(
                  value: 'delete',
                  groupValue: _selectedOperation,
                  onChanged: (value) => setState(() => _selectedOperation = value!),
                ),
                const Text('删除'),
                Radio<String>(
                  value: 'search',
                  groupValue: _selectedOperation,
                  onChanged: (value) => setState(() => _selectedOperation = value!),
                ),
                const Text('查找'),
              ],
            ),
            const SizedBox(height: 16),
            
            // 值输入
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _valueController,
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(
                      labelText: '输入值',
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: _executeOperation,
                  child: const Text('执行'),
                ),
              ],
            ),
            const SizedBox(height: 16),
            
            // 功能按钮
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ElevatedButton.icon(
                  onPressed: widget.onGenerateRandom,
                  icon: const Icon(Icons.shuffle),
                  label: const Text('随机生成'),
                ),
                ElevatedButton.icon(
                  onPressed: widget.onReset,
                  icon: const Icon(Icons.refresh),
                  label: const Text('重置'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.orange,
                    foregroundColor: Colors.white,
                  ),
                ),
              ],
            ),
            
            // 树信息
            if (widget.isAVL) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.blue.shade50,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: const [
                    Text(
                      'AVL树特性：',
                      style: TextStyle(fontWeight: FontWeight.bold),
                    ),
                    SizedBox(height: 4),
                    Text('• 自平衡二叉搜索树'),
                    Text('• 任意节点的左右子树高度差不超过1'),
                    Text('• 插入和删除操作可能触发旋转'),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
  
  void _executeOperation() {
    final value = int.tryParse(_valueController.text);
    if (value == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请输入有效的整数')),
      );
      return;
    }
    
    widget.onOperation(_selectedOperation, value);
    _valueController.clear();
  }
}
