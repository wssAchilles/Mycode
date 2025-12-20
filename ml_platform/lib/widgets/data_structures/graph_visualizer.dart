
import 'package:flutter/material.dart';
import 'dart:math';

/// 图算法可视化组件 (交互增强版 - 统一手势)
class GraphVisualizer extends StatefulWidget {
  const GraphVisualizer({Key? key}) : super(key: key);

  @override
  State<GraphVisualizer> createState() => GraphVisualizerState();
}

class GraphVisualizerState extends State<GraphVisualizer> with SingleTickerProviderStateMixin {
  // Graph Data
  final Map<int, List<Map<String, dynamic>>> _adjacencyList = {};
  final Map<int, Offset> _positions = {};
  int _nextNodeId = 0;
  
  // Settings
  bool _isDirected = false;

  // Animation State
  Set<int> _visited = {};
  List<int> _path = [];
  Map<int, int> _distances = {};
  
  int? _activeNode;
  bool _isAnimating = false;
  String _message = '';
  
  // Interaction State
  int? _draggedNode;
  Offset? _dragStartPos; // To revert position if drag ends in a link

  @override
  void initState() {
    super.initState();
    _initializeSampleGraph();
  }
  
  void _initializeSampleGraph() {
    _adjacencyList.clear();
    _positions.clear();
    _nextNodeId = 0;
    _visited.clear();
    _path.clear();
    _distances.clear();

    // Sample
    addVertex(pos: const Offset(300, 100)); // 0
    addVertex(pos: const Offset(150, 200)); // 1
    addVertex(pos: const Offset(450, 200)); // 2
    addVertex(pos: const Offset(100, 350)); // 3
    addVertex(pos: const Offset(500, 350)); // 4
    addVertex(pos: const Offset(300, 300)); // 5
    
    // Edges
    addEdge(0, 1, weight: 4);
    addEdge(0, 2, weight: 2);
    addEdge(1, 3, weight: 3);
    addEdge(2, 4, weight: 5);
    addEdge(1, 5, weight: 3);
    if (_isDirected) {
       addEdge(5, 2, weight: 1); 
    } else {
       addEdge(5, 2, weight: 1);
       addEdge(3, 5, weight: 2);
    }
  }

  void addVertex({Offset? pos}) {
    int id = _nextNodeId++;
    _adjacencyList[id] = [];
    if (pos == null) {
       final rand = Random();
       _positions[id] = Offset(
          50.0 + rand.nextDouble() * 500.0, 
          50.0 + rand.nextDouble() * 300.0
       );
    } else {
       _positions[id] = pos;
    }
    setState(() {});
  }

  void addEdge(int from, int to, {int weight = 1}) {
    if (_adjacencyList.containsKey(from) && _adjacencyList.containsKey(to)) {
      bool exists = _adjacencyList[from]!.any((edge) => edge['target'] == to);
      if (!exists) {
        _adjacencyList[from]!.add({'target': to, 'weight': weight});
        if (!_isDirected) {
           if (!_adjacencyList[to]!.any((edge) => edge['target'] == from)) {
             _adjacencyList[to]!.add({'target': from, 'weight': weight});
           }
        }
        setState(() {});
      }
    }
  }
  
  void removeEdge(int from, int to) {
    if (_adjacencyList.containsKey(from)) {
      _adjacencyList[from]!.removeWhere((edge) => edge['target'] == to);
      if (!_isDirected && _adjacencyList.containsKey(to)) {
          _adjacencyList[to]!.removeWhere((edge) => edge['target'] == from);
      }
      setState(() {});
    }
  }
  
  void updateEdgeWeight(int from, int to, int newWeight) {
     if (_adjacencyList.containsKey(from)) {
        for(var edge in _adjacencyList[from]!) {
            if (edge['target'] == to) {
                edge['weight'] = newWeight;
            }
        }
        if (!_isDirected && _adjacencyList.containsKey(to)) {
            for(var edge in _adjacencyList[to]!) {
                if (edge['target'] == from) {
                    edge['weight'] = newWeight;
                }
            }
        }
        setState(() {});
     }
  }

  // --- Algorithms ---
  
  Future<void> dfs() async {
    if (_adjacencyList.isEmpty || _isAnimating) return;
    int startNode = _adjacencyList.keys.first;
    await _startTraversal(startNode, _performDFS, "DFS");
  }

  Future<void> _performDFS(int current, Set<int> visited, List<int> path) async {
    visited.add(current);
    path.add(current);
    setState(() {
      _activeNode = current;
      _visited = Set.from(visited);
      _path = List.from(path);
      _message = 'DFS访问: $current';
    });
    await Future.delayed(const Duration(milliseconds: 600));
    
    List<Map<String, dynamic>> neighbors = _adjacencyList[current] ?? [];
    neighbors.sort((a, b) => (a['target'] as int).compareTo(b['target'] as int));
    
    for (var edge in neighbors) {
      if (!visited.contains(edge['target'])) {
        if (!mounted) return;
        await _performDFS(edge['target'], visited, path);
      }
    }
  }

  Future<void> bfs() async {
    if (_adjacencyList.isEmpty || _isAnimating) return;
    int start = _adjacencyList.keys.first;
    await _startTraversal(start, _performBFS, "BFS");
  }

  Future<void> _performBFS(int start, Set<int> visited, List<int> path) async {
     List<int> queue = [start];
     visited.add(start);
     while (queue.isNotEmpty) {
        if (!mounted) return;
        int current = queue.removeAt(0);
        path.add(current);
        setState(() {
          _activeNode = current;
          _visited = Set.from(visited);
          _path = List.from(path);
          _message = 'BFS访问: $current';
        });
        await Future.delayed(const Duration(milliseconds: 600));
        
        List<Map<String, dynamic>> neighbors = _adjacencyList[current] ?? [];
        neighbors.sort((a, b) => (a['target'] as int).compareTo(b['target'] as int));
        
        for (var edge in neighbors) {
           if (!visited.contains(edge['target'])) {
              visited.add(edge['target']);
              queue.add(edge['target']);
           }
        }
     }
  }

  Future<void> dijkstra() async {
      if (_adjacencyList.isEmpty || _isAnimating) return;
      int startNode = _adjacencyList.keys.first;
      
      setState(() {
        _isAnimating = true;
        _visited.clear();
        _path.clear();
        _distances.clear();
        for(var key in _adjacencyList.keys) {
            _distances[key] = (key == startNode) ? 0 : 9999;
        }
        _message = 'Dijkstra 最短路径计算...';
      });

      Set<int> unvisited = Set.from(_adjacencyList.keys);
      while(unvisited.isNotEmpty) {
           if (!mounted) return;
           int? u;
           int minDist = 99999;
           for(var node in unvisited) {
               if ((_distances[node] ?? 9999) < minDist) {
                   minDist = _distances[node]!;
                   u = node;
               }
           }
           if (u == null || minDist == 9999) break;
           unvisited.remove(u);
           
           setState(() {
               _activeNode = u;
               _visited.add(u!);
               _message = '处理节点 $u (Dist: $minDist)';
           });
           await Future.delayed(const Duration(milliseconds: 600));
           
           List<Map<String, dynamic>> neighbors = _adjacencyList[u] ?? [];
           for (var edge in neighbors) {
               int v = edge['target'];
               int weight = edge['weight'];
               if (unvisited.contains(v)) {
                   int newDist = minDist + weight;
                   if (newDist < (_distances[v] ?? 9999)) {
                       setState(() {
                           _distances[v] = newDist;
                       });
                       await Future.delayed(const Duration(milliseconds: 300));
                   }
               }
           }
      }
      if (mounted) {
        setState(() {
            _isAnimating = false;
            _activeNode = null;
            _message = 'Dijkstra 完成';
        });
      }
  }

  Future<void> _startTraversal(int start, Function fn, String type) async {
    setState(() {
       _isAnimating = true;
       _visited.clear();
       _path.clear();
       _distances.clear();
       _message = '开始 $type...';
    });
    await fn(start, {}, []);
    if (mounted) {
       setState(() { _isAnimating = false; _activeNode = null; _message = '$type 完成'; });
    }
  }

  void clear() {
     _initializeSampleGraph();
     setState(() {
       _adjacencyList.clear();
       _positions.clear();
       _nextNodeId = 0;
       _visited.clear();
       _path.clear();
       _distances.clear();
       _message = '';
     });
  }
  
  // --- Interactions ---

  int? _hitTestNode(Offset localPos) {
      for (final entry in _positions.entries) {
         if ((entry.value - localPos).distance < 25.0) { // Radius + margin
             return entry.key;
         }
      }
      return null;
  }
  
  List<int>? _hitTestEdge(Offset localPos) {
      for(var from in _adjacencyList.keys) {
          final p1 = _positions[from];
          if (p1 == null) continue;
          
          for(var edge in _adjacencyList[from]!) {
              int to = edge['target'];
              final p2 = _positions[to];
              if (p2 == null) continue;
              
              double dist = _distToSegment(localPos, p1, p2);
              if (dist < 10.0) {
                  return [from, to];
              }
          }
      }
      return null;
  }
  
  double _distToSegment(Offset p, Offset v, Offset w) {
      final l2 = (v - w).distanceSquared;
      if (l2 == 0) return (p - v).distance;
      double t = ((p.dx - v.dx) * (w.dx - v.dx) + (p.dy - v.dy) * (w.dy - v.dy)) / l2;
      t = max(0, min(1, t));
      final proj = Offset(v.dx + t * (w.dx - v.dx), v.dy + t * (w.dy - v.dy));
      return (p - proj).distance;
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Top Toolbar
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          color: Colors.grey.shade100,
          child: Row(
            children: [
               Text('图模式: ${_isDirected ? "有向图" : "无向图"}', style: const TextStyle(fontWeight: FontWeight.bold)),
               const SizedBox(width: 8),
               Switch(
                 value: _isDirected, 
                 onChanged: (val) {
                    setState(() {
                       _isDirected = val;
                       _initializeSampleGraph();
                       _message = '切换至 ${_isDirected ? "有向图" : "无向图"} (已重置)';
                    });
                 }
               ),
               const Spacer(),
               Column(
                 crossAxisAlignment: CrossAxisAlignment.end,
                 children: [
                   if (_isDirected) const Text('长按拖拽可移动，拖拽到其他节点可连线', style: TextStyle(fontSize: 10, color: Colors.grey)),
                   _isDirected 
                      ? const Text('双击箭头删除连线', style: TextStyle(fontSize: 12, color: Colors.grey))
                      : const Text('双击数字修改权重，可自由拖动', style: TextStyle(fontSize: 12, color: Colors.grey)),
                 ],
               )
            ],
          ),
        ),
        if (_message.isNotEmpty)
           Padding(
             padding: const EdgeInsets.all(4),
             child: Text(_message, style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.blue)),
           ),
        Expanded(
          child: LayoutBuilder(
            builder: (ctx, constraints) {
               return GestureDetector(
                 onDoubleTapDown: (details) {
                     final renderBox = context.findRenderObject() as RenderBox;
                     final localPos = renderBox.globalToLocal(details.globalPosition);
                     
                     final edge = _hitTestEdge(localPos);
                     if (edge != null) {
                         int u = edge[0]; // From
                         int v = edge[1]; // To
                         
                         if (_isDirected) {
                             removeEdge(u, v);
                             setState(() { _message = '已删除边 $u -> $v'; });
                         } else {
                             _showWeightEditDialog(u, v);
                         }
                         return;
                     }
                 },
                 onPanStart: (details) {
                    if (_isAnimating) return; // Only block when animating
                    final renderBox = context.findRenderObject() as RenderBox;
                    final localPos = renderBox.globalToLocal(details.globalPosition);
                    
                    int? node = _hitTestNode(localPos);
                    
                    if (node != null) {
                        setState(() {
                           _draggedNode = node;
                           _dragStartPos = _positions[node]; // Save initial pos
                        });
                    }
                 },
                 onPanUpdate: (details) {
                    if (_draggedNode != null) {
                         final renderBox = context.findRenderObject() as RenderBox;
                         final localPos = renderBox.globalToLocal(details.globalPosition);
                         
                         setState(() {
                            _positions[_draggedNode!] = localPos;
                         });
                    }
                 },
                 onPanEnd: (details) {
                    if (_draggedNode != null) {
                       // Check drop target
                       // Use global position converted to local? Or just current position of dragged node?
                       // _positions[_draggedNode] is the current visual position (under finger).
                       // We check if this position is close to ANOTHER node.
                       
                       Offset currentPos = _positions[_draggedNode!]!;
                       int? targetNode = _hitTestNode(currentPos); // This might hit itself...
                       
                       // Need to exclude itself from hit test or check ID
                       // Let's iterate manually to exclude _draggedNode
                       int? hitOther;
                       for (final entry in _positions.entries) {
                           if (entry.key == _draggedNode) continue;
                           if ((entry.value - currentPos).distance < 30.0) {
                               hitOther = entry.key;
                               break;
                           }
                       }
                       
                       if (hitOther != null && _isDirected) {
                            // Hit another node in Directed Mode -> Create Link
                            addEdge(_draggedNode!, hitOther, weight: 1);
                            setState(() { 
                               _message = '已连接 $_draggedNode -> $hitOther'; 
                               // Revert position to start (Snap back visual)
                               if (_dragStartPos != null) {
                                   _positions[_draggedNode!] = _dragStartPos!;
                               }
                            });
                       }
                       // Else: Move is accepted. Node stays at new position.
                    }
                    
                    setState(() {
                       _draggedNode = null;
                       _dragStartPos = null;
                    });
                 },
                 child: Container(
                   color: Colors.white,
                   width: constraints.maxWidth,
                   height: constraints.maxHeight,
                   child: CustomPaint(
                     painter: GraphPainter(
                        adjacencyList: _adjacencyList,
                        positions: _positions,
                        visited: _visited,
                        activeNode: _activeNode,
                        distances: _distances,
                        isDirected: _isDirected,
                     ),
                   ),
                 ),
               );
            },
          ),
        ),
      ],
    );
  }

  Future<void> _showWeightEditDialog(int u, int v) async {
      int currentW = 1;
      var edge = _adjacencyList[u]!.firstWhere((e) => e['target'] == v, orElse: () => {});
      if (edge.isNotEmpty) currentW = edge['weight'];
      
      final controller = TextEditingController(text: currentW.toString());
      
      await showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
           title: const Text('修改边权重'),
           content: TextField(
              controller: controller,
              keyboardType: TextInputType.number,
              autofocus: true,
              decoration: const InputDecoration(labelText: '新权重'),
           ),
           actions: [
              TextButton(onPressed: ()=>Navigator.pop(ctx), child: const Text('取消')),
              ElevatedButton(
                 onPressed: () {
                    final val = int.tryParse(controller.text);
                    if (val != null) {
                       updateEdgeWeight(u, v, val);
                       Navigator.pop(ctx);
                    }
                 },
                 child: const Text('确定')
              )
           ],
        )
      );
  }
}

class GraphPainter extends CustomPainter {
  final Map<int, List<Map<String, dynamic>>> adjacencyList;
  final Map<int, Offset> positions;
  final Set<int> visited;
  final int? activeNode;
  final Map<int, int> distances;
  final bool isDirected;

  GraphPainter({
    required this.adjacencyList,
    required this.positions,
    required this.visited,
    this.activeNode,
    this.distances = const {},
    required this.isDirected,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final edgePaint = Paint()
      ..color = Colors.grey.shade400
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;

    final arrowPaint = Paint()
      ..color = Colors.grey.shade400
      ..style = PaintingStyle.fill;
      
    final nodePaint = Paint()..style = PaintingStyle.fill;
    const double radius = 20.0;
    
    // Draw Edges
    adjacencyList.forEach((from, neighbors) {
       final p1 = positions[from];
       if (p1 == null) return;
       
       for (var edge in neighbors) {
          int to = edge['target'];
          int weight = edge['weight'];
          final p2 = positions[to];
          if (p2 == null) continue;
          
          if (!isDirected) {
             if (from < to) {
                 canvas.drawLine(p1, p2, edgePaint);
                 _drawWeight(canvas, (p1+p2)/2, weight.toString());
             }
          } else {
             // Directed
             bool hasReverse = false;
             if (adjacencyList.containsKey(to)) {
                 hasReverse = adjacencyList[to]!.any((e) => e['target'] == from);
             }
             
             if (hasReverse) {
                _drawCurvedArrow(canvas, p1, p2, edgePaint, arrowPaint, radius, weight.toString());
             } else {
                _drawArrow(canvas, p1, p2, edgePaint, arrowPaint, radius);
                _drawWeight(canvas, (p1+p2)/2, weight.toString());
             }
          }
       }
    });
    
    // Draw Nodes
    positions.forEach((id, pos) {
       Color color = Colors.blue.shade100;
       if (visited.contains(id)) color = Colors.green.shade200;
       if (id == activeNode) color = Colors.orange;
       
       nodePaint.color = color;
       canvas.drawCircle(pos, radius, nodePaint);
       
       final borderPaint = Paint()
         ..color = (id == activeNode) ? Colors.red : Colors.blue
         ..style = PaintingStyle.stroke
         ..strokeWidth = 2;
       canvas.drawCircle(pos, radius, borderPaint);
       
       _drawText(canvas, pos, id.toString(), isId: true);
       
       if (distances.containsKey(id)) {
           int dist = distances[id]!;
           String label = (dist >= 9999) ? "∞" : "$dist";
           _drawText(canvas, pos + const Offset(0, -35), "d: $label", fontSize: 12, color: Colors.purple);
       }
    });
  }
  
  void _drawArrow(Canvas canvas, Offset p1, Offset p2, Paint linePaint, Paint arrowPaint, double nodeRadius) {
     final d = p2 - p1;
     final dist = d.distance;
     if (dist <= nodeRadius * 2) return;
     
     final start = p1 + d * (nodeRadius / dist);
     final end = p2 - d * (nodeRadius / dist);
     
     canvas.drawLine(start, end, linePaint);
     _drawArrowHead(canvas, start, end, arrowPaint);
  }
  
  void _drawCurvedArrow(Canvas canvas, Offset p1, Offset p2, Paint linePaint, Paint arrowPaint, double nodeRadius, String weight) {
      final d = p2 - p1;
      final dist = d.distance;
      final normal = Offset(-d.dy, d.dx) / dist; 
      final control = (p1 + p2) / 2 + normal * 40;
      
      final path = Path();
      path.moveTo(p1.dx, p1.dy);
      path.quadraticBezierTo(control.dx, control.dy, p2.dx, p2.dy);
      
      canvas.drawPath(path, linePaint);
      
      final tangent = p2 - control;
      final tangentNorm = tangent / tangent.distance;
      final arrowPos = p2 - tangentNorm * nodeRadius;
      
      _drawArrowHead(canvas, control, arrowPos, arrowPaint);
      _drawWeight(canvas, control, weight);
  }

  void _drawArrowHead(Canvas canvas, Offset from, Offset to, Paint paint) {
     final d = to - from;
     final angle = atan2(d.dy, d.dx);
     const arrowSize = 10.0;
     const arrowAngle = pi / 6;
     
     final path = Path();
     path.moveTo(to.dx, to.dy);
     path.lineTo(to.dx - arrowSize * cos(angle - arrowAngle), to.dy - arrowSize * sin(angle - arrowAngle));
     path.lineTo(to.dx - arrowSize * cos(angle + arrowAngle), to.dy - arrowSize * sin(angle + arrowAngle));
     path.close();
     canvas.drawPath(path, paint);
  }
  
  void _drawWeight(Canvas canvas, Offset pos, String text) {
      final tp = TextPainter(
        text: TextSpan(
           text: text,
           style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold, fontSize: 14, backgroundColor: Colors.white),
        ),
        textDirection: TextDirection.ltr
      );
      tp.layout();
      tp.paint(canvas, pos - Offset(tp.width/2, tp.height/2));
  }
  
  void _drawText(Canvas canvas, Offset pos, String text, {bool isId = false, double fontSize = 14, Color color = Colors.black}) {
       final tp = TextPainter(
         text: TextSpan(
           text: text,
           style: TextStyle(color: color, fontWeight: isId ? FontWeight.bold : FontWeight.normal, fontSize: fontSize),
         ),
         textDirection: TextDirection.ltr
       );
       tp.layout();
       tp.paint(canvas, pos - Offset(tp.width/2, tp.height/2));
  }

  @override
  bool shouldRepaint(GraphPainter oldDelegate) {
    return true;
  }
}
