// 图结构可视化组件
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:collection/collection.dart';
import 'package:ml_platform/services/graph_service.dart';

/// 图结构可视化器
class GraphVisualizer extends StatefulWidget {
  final Map<String, GraphVertex> vertices;
  final String? currentVertex;
  final List<String> visitedVertices;
  final List<String> pathVertices;
  final Map<String, int>? distances;
  final AnimationController animationController;
  
  const GraphVisualizer({
    Key? key,
    required this.vertices,
    this.currentVertex,
    this.visitedVertices = const [],
    this.pathVertices = const [],
    this.distances,
    required this.animationController,
  }) : super(key: key);
  
  @override
  State<GraphVisualizer> createState() => _GraphVisualizerState();
}

class _GraphVisualizerState extends State<GraphVisualizer> {
  String? _selectedVertex;
  String? _hoveredVertex;
  
  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return GestureDetector(
          onTapDown: (details) => _handleTap(details, constraints.biggest),
          child: MouseRegion(
            onHover: (event) => _handleHover(event.localPosition, constraints.biggest),
            onExit: (_) => setState(() => _hoveredVertex = null),
            child: RepaintBoundary(
              child: CustomPaint(
                size: constraints.biggest,
                painter: GraphPainter(
                  vertices: widget.vertices,
                  currentVertex: widget.currentVertex,
                  visitedVertices: widget.visitedVertices,
                  pathVertices: widget.pathVertices,
                  distances: widget.distances,
                  selectedVertex: _selectedVertex,
                  hoveredVertex: _hoveredVertex,
                  animation: widget.animationController,
                ),
              ),
            ),
          ),
        );
      },
    );
  }
  
  void _handleTap(TapDownDetails details, Size size) {
    for (var vertex in widget.vertices.values) {
      double dx = vertex.x - details.localPosition.dx;
      double dy = vertex.y - details.localPosition.dy;
      double distance = math.sqrt(dx * dx + dy * dy);
      
      if (distance <= 25) { // 节点半径
        setState(() {
          _selectedVertex = _selectedVertex == vertex.id ? null : vertex.id;
        });
        break;
      }
    }
  }
  
  void _handleHover(Offset position, Size size) {
    String? hoveredId;
    for (var vertex in widget.vertices.values) {
      double dx = vertex.x - position.dx;
      double dy = vertex.y - position.dy;
      double distance = math.sqrt(dx * dx + dy * dy);
      
      if (distance <= 25) { // 节点半径
        hoveredId = vertex.id;
        break;
      }
    }
    
    if (hoveredId != _hoveredVertex) {
      setState(() => _hoveredVertex = hoveredId);
    }
  }
}

/// 图结构绘制器
class GraphPainter extends CustomPainter {
  final Map<String, GraphVertex> vertices;
  final String? currentVertex;
  final List<String> visitedVertices;
  final List<String> pathVertices;
  final Map<String, int>? distances;
  final String? selectedVertex;
  final String? hoveredVertex;
  final Animation<double> animation;
  
  static const double nodeRadius = 25;
  
  GraphPainter({
    required this.vertices,
    this.currentVertex,
    required this.visitedVertices,
    required this.pathVertices,
    this.distances,
    this.selectedVertex,
    this.hoveredVertex,
    required this.animation,
  }) : super(repaint: animation);
  
  @override
  void paint(Canvas canvas, Size size) {
    // 绘制边
    _drawEdges(canvas);
    
    // 绘制节点
    _drawNodes(canvas);
    
    // 绘制标签和距离
    _drawLabels(canvas);
  }
  
  void _drawEdges(Canvas canvas) {
    final drawnEdges = <String>{};
    
    for (var vertex in vertices.values) {
      for (var entry in vertex.edges.entries) {
        String edgeKey = '${vertex.id}-${entry.key}';
        String reverseKey = '${entry.key}-${vertex.id}';
        
        // 避免重复绘制无向边
        if (drawnEdges.contains(reverseKey)) continue;
        drawnEdges.add(edgeKey);
        
        var targetVertex = vertices[entry.key];
        if (targetVertex == null) continue;
        
        // 确定边的颜色
        Color edgeColor = AppTheme.borderStrong;
        double strokeWidth = 2;
        
        // 如果边在最短路径上
        if (pathVertices.contains(vertex.id) && pathVertices.contains(entry.key)) {
          int idx1 = pathVertices.indexOf(vertex.id);
          int idx2 = pathVertices.indexOf(entry.key);
          if ((idx1 - idx2).abs() == 1) {
            edgeColor = AppTheme.success;
            strokeWidth = 3;
          }
        }
        
        // 如果是当前正在访问的边
        if ((currentVertex == vertex.id && visitedVertices.contains(entry.key)) ||
            (currentVertex == entry.key && visitedVertices.contains(vertex.id))) {
          edgeColor = AppTheme.warning;
          strokeWidth = 3;
        }
        
        final paint = Paint()
          ..color = edgeColor
          ..strokeWidth = strokeWidth
          ..style = PaintingStyle.stroke;
        
        // 绘制边
        canvas.drawLine(
          Offset(vertex.x, vertex.y),
          Offset(targetVertex.x, targetVertex.y),
          paint,
        );
        
        // 绘制权重
        if (distances != null || entry.value != 1) {
          _drawEdgeWeight(
            canvas,
            Offset(vertex.x, vertex.y),
            Offset(targetVertex.x, targetVertex.y),
            entry.value.toString(),
          );
        }
      }
    }
  }
  
  void _drawNodes(Canvas canvas) {
    for (var vertex in vertices.values) {
      // 确定节点颜色
      Color nodeColor = AppTheme.primary;
      Color borderColor = AppTheme.primaryDark;
      double scale = 1.0;
      
      if (vertex.id == currentVertex) {
        nodeColor = AppTheme.error;
        borderColor = AppTheme.error;
        scale = 1.2 + 0.1 * math.sin(animation.value * 2 * math.pi);
      } else if (pathVertices.contains(vertex.id)) {
        nodeColor = AppTheme.success;
        borderColor = AppTheme.success;
      } else if (visitedVertices.contains(vertex.id)) {
        nodeColor = AppTheme.warning;
        borderColor = AppTheme.warning;
      } else if (vertex.id == selectedVertex) {
        nodeColor = AppTheme.secondary;
        borderColor = AppTheme.secondary;
      } else if (vertex.id == hoveredVertex) {
        nodeColor = AppTheme.primary.withOpacity(0.7);
        scale = 1.1;
      }
      
      // 绘制节点阴影
      final shadowPaint = Paint()
        ..color = AppTheme.borderStrong
        ..style = PaintingStyle.fill;
      
      canvas.drawCircle(
        Offset(vertex.x + 3, vertex.y + 3),
        nodeRadius * scale,
        shadowPaint,
      );
      
      // 绘制节点
      final paint = Paint()
        ..color = nodeColor
        ..style = PaintingStyle.fill;
      
      canvas.drawCircle(
        Offset(vertex.x, vertex.y),
        nodeRadius * scale,
        paint,
      );
      
      // 绘制节点边框
      final borderPaint = Paint()
        ..color = borderColor
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2;
      
      canvas.drawCircle(
        Offset(vertex.x, vertex.y),
        nodeRadius * scale,
        borderPaint,
      );
    }
  }
  
  void _drawLabels(Canvas canvas) {
    for (var vertex in vertices.values) {
      // 绘制节点标签
      _drawNodeLabel(
        canvas,
        vertex.label,
        Offset(vertex.x, vertex.y),
      );
      
      // 绘制距离（如果有）
      if (distances != null && distances![vertex.id] != null && distances![vertex.id]! < 999999) {
        _drawDistanceLabel(
          canvas,
          distances![vertex.id].toString(),
          Offset(vertex.x, vertex.y - nodeRadius - 15),
        );
      }
    }
  }
  
  void _drawNodeLabel(Canvas canvas, String label, Offset center) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: label,
        style: const TextStyle(
          color: AppTheme.textPrimary,
          fontSize: 16,
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
  
  void _drawDistanceLabel(Canvas canvas, String distance, Offset position) {
    // 绘制背景
    final bgPaint = Paint()
      ..color = AppTheme.secondary
      ..style = PaintingStyle.fill;
    
    final bgRect = RRect.fromRectAndRadius(
      Rect.fromCenter(
        center: position,
        width: 30,
        height: 20,
      ),
      const Radius.circular(4),
    );
    
    canvas.drawRRect(bgRect, bgPaint);
    
    // 绘制文本
    final textPainter = TextPainter(
      text: TextSpan(
        text: distance,
        style: const TextStyle(
          color: AppTheme.textPrimary,
          fontSize: 12,
          fontWeight: FontWeight.bold,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    
    textPainter.paint(
      canvas,
      position - Offset(textPainter.width / 2, textPainter.height / 2),
    );
  }
  
  void _drawEdgeWeight(Canvas canvas, Offset start, Offset end, String weight) {
    // 计算边的中点
    final midPoint = Offset(
      (start.dx + end.dx) / 2,
      (start.dy + end.dy) / 2,
    );
    
    // 绘制背景
    final bgPaint = Paint()
      ..color = AppTheme.surface
      ..style = PaintingStyle.fill;
    
    canvas.drawCircle(midPoint, 12, bgPaint);
    
    // 绘制边框
    final borderPaint = Paint()
      ..color = AppTheme.borderStrong
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    
    canvas.drawCircle(midPoint, 12, borderPaint);
    
    // 绘制权重文本
    final textPainter = TextPainter(
      text: TextSpan(
        text: weight,
        style: TextStyle(
          color: AppTheme.background,
          fontSize: 11,
          fontWeight: FontWeight.bold,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    
    textPainter.paint(
      canvas,
      midPoint - Offset(textPainter.width / 2, textPainter.height / 2),
    );
  }
  
  @override
  bool shouldRepaint(covariant GraphPainter oldDelegate) {
    // 使用深度比较来更准确地判断是否需要重绘
    return !const DeepCollectionEquality().equals(oldDelegate.vertices, vertices) ||
        oldDelegate.currentVertex != currentVertex ||
        !const DeepCollectionEquality().equals(oldDelegate.visitedVertices, visitedVertices) ||
        !const DeepCollectionEquality().equals(oldDelegate.pathVertices, pathVertices) ||
        !const DeepCollectionEquality().equals(oldDelegate.distances, distances) ||
        oldDelegate.selectedVertex != selectedVertex ||
        oldDelegate.hoveredVertex != hoveredVertex;
  }
}

/// 图操作控制面板
class GraphControlPanel extends StatefulWidget {
  final Function(String algorithm, String? startNode, String? endNode) onExecute;
  final Function() onReset;
  final Function() onGenerateRandom;
  final Function(String nodeId) onAddNode;
  final Function(String from, String to, int weight) onAddEdge;
  
  const GraphControlPanel({
    Key? key,
    required this.onExecute,
    required this.onReset,
    required this.onGenerateRandom,
    required this.onAddNode,
    required this.onAddEdge,
  }) : super(key: key);
  
  @override
  State<GraphControlPanel> createState() => _GraphControlPanelState();
}

class _GraphControlPanelState extends State<GraphControlPanel> {
  String _selectedAlgorithm = 'dfs';
  final TextEditingController _startNodeController = TextEditingController();
  final TextEditingController _endNodeController = TextEditingController();
  
  @override
  void dispose() {
    _startNodeController.dispose();
    _endNodeController.dispose();
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
              '图算法操作',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            
            // 算法选择
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('选择算法：'),
                const SizedBox(height: 8),
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'dfs', label: Text('DFS')),
                    ButtonSegment(value: 'bfs', label: Text('BFS')),
                    ButtonSegment(value: 'dijkstra', label: Text('Dijkstra')),
                  ],
                  selected: {_selectedAlgorithm},
                  onSelectionChanged: (selected) {
                    setState(() {
                      _selectedAlgorithm = selected.first;
                    });
                  },
                ),
              ],
            ),
            const SizedBox(height: 16),
            
            // 节点输入
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _startNodeController,
                    decoration: InputDecoration(
                      labelText: '起始节点',
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
                Expanded(
                  child: TextField(
                    controller: _endNodeController,
                    decoration: InputDecoration(
                      labelText: _selectedAlgorithm == 'dijkstra' ? '目标节点' : '目标节点(可选)',
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
              ],
            ),
            const SizedBox(height: 16),
            
            // 执行按钮
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _executeAlgorithm,
                icon: const Icon(Icons.play_arrow),
                label: const Text('执行算法'),
              ),
            ),
            const SizedBox(height: 12),
            
            // 功能按钮
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ElevatedButton.icon(
                  onPressed: widget.onGenerateRandom,
                  icon: const Icon(Icons.auto_graph),
                  label: const Text('生成示例图'),
                ),
                ElevatedButton.icon(
                  onPressed: widget.onReset,
                  icon: const Icon(Icons.refresh),
                  label: const Text('重置'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.warning,
                    foregroundColor: AppTheme.textPrimary,
                  ),
                ),
              ],
            ),
            
            // 算法说明
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.primary.withOpacity(0.08),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _getAlgorithmDescription(),
                    style: const TextStyle(fontSize: 13),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
  
  void _executeAlgorithm() {
    final startNode = _startNodeController.text.trim();
    if (startNode.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请输入起始节点')),
      );
      return;
    }
    
    final endNode = _endNodeController.text.trim();
    if (_selectedAlgorithm == 'dijkstra' && endNode.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Dijkstra算法需要指定目标节点')),
      );
      return;
    }
    
    widget.onExecute(
      _selectedAlgorithm,
      startNode,
      endNode.isEmpty ? null : endNode,
    );
  }
  
  String _getAlgorithmDescription() {
    switch (_selectedAlgorithm) {
      case 'dfs':
        return 'DFS（深度优先搜索）：从起始节点开始，尽可能深地搜索图的分支，直到访问完所有可达节点。';
      case 'bfs':
        return 'BFS（广度优先搜索）：从起始节点开始，逐层访问所有节点，先访问距离近的节点。';
      case 'dijkstra':
        return 'Dijkstra（最短路径）：找到从起始节点到目标节点的最短路径，适用于带权重的图。';
      default:
        return '';
    }
  }
}
