// 树形结构可视化组件 - Academic Tech Dark 风格优化
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:collection/collection.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/services/tree_service.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/widgets/common/glass_widgets.dart';

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
        
        return RepaintBoundary(
          child: CustomPaint(
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
  
  static const double nodeRadius = 22;
  
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
    final Map<int, Offset> startPos = {};
    final Map<int, Offset> endPos = {};
    final Map<int, BSTNode> nodes = {}; 
    
    _collectNodes(root, startPos, nodes);
    _collectNodes(nextRoot, endPos, nodes); 
    
    final t = rotationAnimation.value;
    
    if (t < 0.5) {
      _drawInterpolatedEdges(canvas, root, startPos, endPos, t, 1.0 - (t * 2));
    } else {
      _drawInterpolatedEdges(canvas, nextRoot, startPos, endPos, t, (t - 0.5) * 2);
    }
    
    // 3. 绘制节点 (插值位置)
    final allKeys = {...startPos.keys, ...endPos.keys};
    for (var key in allKeys) {
      final s = startPos[key];
      final e = endPos[key];
      
      Offset currentPos;
      if (s != null && e != null) {
        currentPos = Offset.lerp(s, e, t)!;
      } else if (s != null) {
        currentPos = s; 
      } else {
        currentPos = e!;
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
      ..color = AppTheme.glassBorder.withOpacity(opacity)
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
    Color baseColor = AppTheme.surface;
    Color borderColor = AppTheme.primary;
    double scale = 1.0;
    
    if (highlightNode == node.value) {
       baseColor = AppTheme.secondary.withOpacity(0.3);
       borderColor = AppTheme.secondary;
       scale = 1.2 + 0.1 * math.sin(animation.value * 2 * math.pi);
    } else if (searchPath.contains(node.value)) {
       baseColor = AppTheme.primary.withOpacity(0.3);
       borderColor = AppTheme.primary;
    } else {
       // R-B Color logic maintained but with glass style
       if (node.isRed) {
         borderColor = AppTheme.error;
         baseColor = AppTheme.error.withOpacity(0.2);
       } else {
         borderColor = AppTheme.textSecondary; // Black nodes -> Grey border in dark mode
         baseColor = AppTheme.surface;
       }
    }
    
    // 绘制节点光晕 (Glow)
    if (isHighlighted || searchPath.contains(node.value)) {
      final glowPaint = Paint()
        ..color = borderColor.withOpacity(0.5)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8);
      canvas.drawCircle(center, nodeRadius * scale + 2, glowPaint);
    }
    
    // 绘制节点主体 (Glass Effect)
    final paint = Paint()
      ..style = PaintingStyle.fill;
      
    // Radial Gradient for 3D/Glass look
    paint.shader = RadialGradient(
      colors: [
        baseColor.withOpacity(0.7),
        baseColor.withOpacity(0.9),
      ],
      stops: const [0.0, 1.0],
      center: Alignment(-0.3, -0.3),
    ).createShader(Rect.fromCircle(center: center, radius: nodeRadius * scale));
    
    canvas.drawCircle(center, nodeRadius * scale, paint);
    
    // 绘制节点边框 (Neon Ring)
    final borderPaint = Paint()
      ..color = borderColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    
    canvas.drawCircle(center, nodeRadius * scale, borderPaint);
    
    // 绘制高光 (Reflection)
    final reflectionPaint = Paint()
      ..color = AppTheme.textPrimary.withOpacity(0.3)
      ..style = PaintingStyle.fill;
    
    canvas.drawCircle(
      center + const Offset(-6, -6),
      nodeRadius * 0.3 * scale,
      reflectionPaint,
    );
    
    // 绘制节点值
    _drawNodeValue(canvas, node.value.toString(), center, AppTheme.textPrimary);
    
    // 绘制高度标签（AVL树）
    if (node.height > 1) {
      _drawHeightLabel(canvas, node.height, Offset(center.dx + nodeRadius + 5, center.dy - nodeRadius - 5));
    }
  }

  void _drawEdges(Canvas canvas, BSTNode? node) {
    if (node == null) return;
    
    final paint = Paint()
      ..color = AppTheme.glassBorder.withOpacity(0.5)
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;
    
    if (node.left != null) {
      // 检查是否在搜索路径上
      if (searchPath.contains(node.value) && searchPath.contains(node.left!.value)) {
        paint.color = AppTheme.primary;
        paint.strokeWidth = 3;
        // Search path glow lines?
      }
      
      canvas.drawLine(
        Offset(node.x, node.y),
        Offset(node.left!.x, node.left!.y),
        paint,
      );
      
      _drawEdges(canvas, node.left);
    }
    
    if (node.right != null) {
      // 重置
      paint.color = AppTheme.glassBorder.withOpacity(0.5);
      paint.strokeWidth = 2;
      
      // 检查是否在搜索路径上
      if (searchPath.contains(node.value) && searchPath.contains(node.right!.value)) {
        paint.color = AppTheme.primary;
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
    
    // 先绘制子节点
    _drawNodes(canvas, node.left);
    _drawNodes(canvas, node.right);
    
    bool isHighlighted = (node.value == highlightNode);
    // Draw with new method
    _drawSingleNode(canvas, node, Offset(node.x, node.y), isHighlighted);
  }
  
  void _drawNodeValue(Canvas canvas, String value, Offset center, Color color) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: value,
        style: TextStyle(
          color: color,
          fontSize: 14,
          fontWeight: FontWeight.bold,
          fontFamily: AppTheme.codeFont,
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
          color: AppTheme.textSecondary,
          fontSize: 10,
          fontFamily: AppTheme.codeFont,
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
      ..color = AppTheme.secondary.withOpacity(0.8 * rotationAnimation.value)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3;
    
    final center = Offset(size.width / 2, size.height / 2);
    final radius = 50.0; // Larger for better visibility
    
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
    final arrowLength = 12.0;
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
        oldDelegate.rotationType != rotationType ||
        oldDelegate.animation.value != animation.value ||
        oldDelegate.rotationAnimation.value != rotationAnimation.value;
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
    return GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
               Icon(widget.isAVL ? Icons.balance : Icons.account_tree, color: AppTheme.primary),
               const SizedBox(width: 8),
               Text(
                widget.isAVL ? 'AVL树操作' : '二叉搜索树操作',
                style: AppTheme.darkTheme.textTheme.titleMedium,
              ),
            ],
          ),
          const SizedBox(height: 16),
          
          // 操作选择
          Wrap(
            spacing: 16,
            children: [
              _buildRadio('insert', '插入'),
              _buildRadio('delete', '删除'),
              _buildRadio('search', '查找'),
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
                  style: const TextStyle(color: AppTheme.textPrimary, fontFamily: AppTheme.codeFont),
                  decoration: const InputDecoration(
                    labelText: '输入整数值',
                    prefixIcon: Icon(Icons.numbers),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              NeonButton(
                onPressed: _executeOperation,
                text: '执行',
                icon: Icons.play_arrow,
                width: 100,
                height: 48,
              ),
            ],
          ),
          const SizedBox(height: 16),
          
          // 功能按钮
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: widget.onGenerateRandom,
                  icon: const Icon(Icons.shuffle),
                  label: const Text('随机生成'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.primary,
                    side: const BorderSide(color: AppTheme.primary),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: widget.onReset,
                  icon: const Icon(Icons.refresh),
                  label: const Text('重置'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.error,
                    side: const BorderSide(color: AppTheme.error),
                  ),
                ),
              ),
            ],
          ),
          
          // 树信息
          if (widget.isAVL) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.primary.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppTheme.primary.withOpacity(0.3)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'AVL树特性',
                    style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primary),
                  ),
                  const SizedBox(height: 4),
                  _buildFeatureText('• 自平衡二叉搜索树'),
                  _buildFeatureText('• 任意节点的左右子树高度差不超过1'),
                  _buildFeatureText('• 插入和删除操作可能触发自动旋转'),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
  
  Widget _buildRadio(String value, String label) {
    final isSelected = _selectedOperation == value;
    return InkWell(
      onTap: () => setState(() => _selectedOperation = value),
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? AppTheme.primary.withOpacity(0.2) : Colors.transparent,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? AppTheme.primary : AppTheme.borderSubtle,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (isSelected) 
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: Icon(Icons.check, size: 16, color: AppTheme.primary),
              ),
            Text(
              label,
              style: TextStyle(
                color: isSelected ? AppTheme.primary : AppTheme.textSecondary,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildFeatureText(String text) {
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Text(
        text,
        style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
      ),
    );
  }
  
  void _executeOperation() {
    final value = int.tryParse(_valueController.text);
    if (value == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('请输入有效的整数'),
          backgroundColor: AppTheme.error,
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }
    
    widget.onOperation(_selectedOperation, value);
    _valueController.clear();
  }
}
