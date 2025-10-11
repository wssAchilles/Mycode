// 图结构服务
import 'dart:collection';
import 'dart:math' as math;

/// 图的顶点
class GraphVertex {
  final String id;
  final String label;
  double x;
  double y;
  Map<String, int> edges; // 邻接表：目标节点ID -> 权重
  
  // 可视化状态
  bool isVisited;
  bool isCurrentNode;
  bool isInPath;
  int distance; // 用于最短路径算法
  String? parent; // 用于路径回溯
  
  GraphVertex({
    required this.id,
    required this.label,
    this.x = 0,
    this.y = 0,
    Map<String, int>? edges,
    this.isVisited = false,
    this.isCurrentNode = false,
    this.isInPath = false,
    this.distance = 999999,
    this.parent,
  }) : edges = edges ?? {};
}

/// 图操作步骤
class GraphStep {
  final String operation;
  final String description;
  final Map<String, GraphVertex> vertices;
  final String? currentVertex;
  final List<String> visitedVertices;
  final List<String> pathVertices;
  final Map<String, int>? distances; // 用于Dijkstra
  final List<String>? queue; // 用于BFS
  final List<String>? stack; // 用于DFS
  
  GraphStep({
    required this.operation,
    required this.description,
    required this.vertices,
    this.currentVertex,
    this.visitedVertices = const [],
    this.pathVertices = const [],
    this.distances,
    this.queue,
    this.stack,
  });
}

/// 图结构服务
class GraphService {
  static final GraphService _instance = GraphService._internal();
  factory GraphService() => _instance;
  GraphService._internal();
  
  /// 深度优先搜索 (DFS)
  List<GraphStep> dfs(Map<String, GraphVertex> graph, String startId, String? targetId) {
    List<GraphStep> steps = [];
    Set<String> visited = {};
    List<String> stack = [startId];
    List<String> path = [];
    
    steps.add(GraphStep(
      operation: 'dfs',
      description: '开始深度优先搜索，从节点 $startId 开始',
      vertices: _cloneGraph(graph),
      stack: List.from(stack),
    ));
    
    while (stack.isNotEmpty) {
      String currentId = stack.removeLast();
      
      if (visited.contains(currentId)) continue;
      
      visited.add(currentId);
      path.add(currentId);
      
      // 更新图状态
      Map<String, GraphVertex> currentGraph = _cloneGraph(graph);
      for (String id in visited) {
        currentGraph[id]!.isVisited = true;
      }
      currentGraph[currentId]!.isCurrentNode = true;
      
      steps.add(GraphStep(
        operation: 'dfs',
        description: '访问节点 $currentId',
        vertices: currentGraph,
        currentVertex: currentId,
        visitedVertices: List.from(visited),
        pathVertices: List.from(path),
        stack: List.from(stack),
      ));
      
      // 如果找到目标节点
      if (targetId != null && currentId == targetId) {
        steps.add(GraphStep(
          operation: 'dfs',
          description: '找到目标节点 $targetId！',
          vertices: currentGraph,
          currentVertex: currentId,
          visitedVertices: List.from(visited),
          pathVertices: List.from(path),
        ));
        break;
      }
      
      // 将未访问的邻接节点加入栈
      GraphVertex vertex = graph[currentId]!;
      List<String> neighbors = vertex.edges.keys.toList().reversed.toList();
      for (String neighborId in neighbors) {
        if (!visited.contains(neighborId)) {
          stack.add(neighborId);
        }
      }
      
      if (stack.isNotEmpty) {
        steps.add(GraphStep(
          operation: 'dfs',
          description: '将邻接节点加入栈',
          vertices: currentGraph,
          currentVertex: currentId,
          visitedVertices: List.from(visited),
          pathVertices: List.from(path),
          stack: List.from(stack),
        ));
      }
    }
    
    steps.add(GraphStep(
      operation: 'dfs',
      description: 'DFS遍历完成',
      vertices: _cloneGraph(graph),
      visitedVertices: List.from(visited),
      pathVertices: List.from(path),
    ));
    
    return steps;
  }
  
  /// 广度优先搜索 (BFS)
  List<GraphStep> bfs(Map<String, GraphVertex> graph, String startId, String? targetId) {
    List<GraphStep> steps = [];
    Set<String> visited = {startId};
    Queue<String> queue = Queue.from([startId]);
    List<String> path = [];
    
    steps.add(GraphStep(
      operation: 'bfs',
      description: '开始广度优先搜索，从节点 $startId 开始',
      vertices: _cloneGraph(graph),
      queue: queue.toList(),
    ));
    
    while (queue.isNotEmpty) {
      String currentId = queue.removeFirst();
      path.add(currentId);
      
      // 更新图状态
      Map<String, GraphVertex> currentGraph = _cloneGraph(graph);
      for (String id in visited) {
        currentGraph[id]!.isVisited = true;
      }
      currentGraph[currentId]!.isCurrentNode = true;
      
      steps.add(GraphStep(
        operation: 'bfs',
        description: '访问节点 $currentId',
        vertices: currentGraph,
        currentVertex: currentId,
        visitedVertices: List.from(visited),
        pathVertices: List.from(path),
        queue: queue.toList(),
      ));
      
      // 如果找到目标节点
      if (targetId != null && currentId == targetId) {
        steps.add(GraphStep(
          operation: 'bfs',
          description: '找到目标节点 $targetId！',
          vertices: currentGraph,
          currentVertex: currentId,
          visitedVertices: List.from(visited),
          pathVertices: List.from(path),
        ));
        break;
      }
      
      // 将未访问的邻接节点加入队列
      GraphVertex vertex = graph[currentId]!;
      List<String> newNeighbors = [];
      for (String neighborId in vertex.edges.keys) {
        if (!visited.contains(neighborId)) {
          visited.add(neighborId);
          queue.add(neighborId);
          newNeighbors.add(neighborId);
        }
      }
      
      if (newNeighbors.isNotEmpty) {
        steps.add(GraphStep(
          operation: 'bfs',
          description: '将邻接节点 ${newNeighbors.join(", ")} 加入队列',
          vertices: currentGraph,
          currentVertex: currentId,
          visitedVertices: List.from(visited),
          pathVertices: List.from(path),
          queue: queue.toList(),
        ));
      }
    }
    
    steps.add(GraphStep(
      operation: 'bfs',
      description: 'BFS遍历完成',
      vertices: _cloneGraph(graph),
      visitedVertices: List.from(visited),
      pathVertices: List.from(path),
    ));
    
    return steps;
  }
  
  /// Dijkstra最短路径算法
  List<GraphStep> dijkstra(Map<String, GraphVertex> graph, String startId, String targetId) {
    List<GraphStep> steps = [];
    Map<String, int> distances = {};
    Map<String, String?> previous = {};
    Set<String> visited = {};
    
    // 初始化距离
    for (String id in graph.keys) {
      distances[id] = id == startId ? 0 : 999999;
      previous[id] = null;
    }
    
    steps.add(GraphStep(
      operation: 'dijkstra',
      description: '初始化Dijkstra算法，起点 $startId，终点 $targetId',
      vertices: _cloneGraph(graph),
      distances: Map.from(distances),
    ));
    
    while (visited.length < graph.length) {
      // 找到未访问节点中距离最小的
      String? currentId;
      int minDistance = 999999;
      for (String id in graph.keys) {
        if (!visited.contains(id) && distances[id]! < minDistance) {
          currentId = id;
          minDistance = distances[id]!;
        }
      }
      
      if (currentId == null) break;
      
      visited.add(currentId);
      
      // 更新图状态
      Map<String, GraphVertex> currentGraph = _cloneGraph(graph);
      for (String id in visited) {
        currentGraph[id]!.isVisited = true;
        currentGraph[id]!.distance = distances[id]!;
      }
      currentGraph[currentId]!.isCurrentNode = true;
      
      steps.add(GraphStep(
        operation: 'dijkstra',
        description: '选择节点 $currentId，当前距离 ${distances[currentId]}',
        vertices: currentGraph,
        currentVertex: currentId,
        visitedVertices: List.from(visited),
        distances: Map.from(distances),
      ));
      
      // 如果到达目标节点
      if (currentId == targetId) {
        // 构建最短路径
        List<String> shortestPath = [];
        String? pathNode = targetId;
        while (pathNode != null) {
          shortestPath.insert(0, pathNode);
          pathNode = previous[pathNode];
        }
        
        // 标记路径
        for (String id in shortestPath) {
          currentGraph[id]!.isInPath = true;
        }
        
        steps.add(GraphStep(
          operation: 'dijkstra',
          description: '找到最短路径！距离: ${distances[targetId]}，路径: ${shortestPath.join(" -> ")}',
          vertices: currentGraph,
          currentVertex: targetId,
          visitedVertices: List.from(visited),
          pathVertices: shortestPath,
          distances: Map.from(distances),
        ));
        break;
      }
      
      // 更新邻接节点的距离
      GraphVertex vertex = graph[currentId]!;
      for (String neighborId in vertex.edges.keys) {
        if (!visited.contains(neighborId)) {
          int altDistance = distances[currentId]! + vertex.edges[neighborId]!;
          if (altDistance < distances[neighborId]!) {
            distances[neighborId] = altDistance;
            previous[neighborId] = currentId;
            
            steps.add(GraphStep(
              operation: 'dijkstra',
              description: '更新节点 $neighborId 的距离: ${distances[neighborId]} (通过 $currentId)',
              vertices: currentGraph,
              currentVertex: currentId,
              visitedVertices: List.from(visited),
              distances: Map.from(distances),
            ));
          }
        }
      }
    }
    
    return steps;
  }
  
  /// 生成示例图
  Map<String, GraphVertex> generateSampleGraph() {
    Map<String, GraphVertex> graph = {};
    
    // 创建顶点
    graph['A'] = GraphVertex(id: 'A', label: 'A', x: 100, y: 100);
    graph['B'] = GraphVertex(id: 'B', label: 'B', x: 250, y: 100);
    graph['C'] = GraphVertex(id: 'C', label: 'C', x: 400, y: 100);
    graph['D'] = GraphVertex(id: 'D', label: 'D', x: 100, y: 250);
    graph['E'] = GraphVertex(id: 'E', label: 'E', x: 250, y: 250);
    graph['F'] = GraphVertex(id: 'F', label: 'F', x: 400, y: 250);
    
    // 添加边
    graph['A']!.edges = {'B': 4, 'D': 2};
    graph['B']!.edges = {'A': 4, 'C': 3, 'D': 1, 'E': 5};
    graph['C']!.edges = {'B': 3, 'E': 2, 'F': 6};
    graph['D']!.edges = {'A': 2, 'B': 1, 'E': 8};
    graph['E']!.edges = {'B': 5, 'C': 2, 'D': 8, 'F': 1};
    graph['F']!.edges = {'C': 6, 'E': 1};
    
    return graph;
  }
  
  /// 自动布局图节点（使用力导向布局）
  void autoLayout(Map<String, GraphVertex> graph, double width, double height) {
    final random = math.Random();
    final vertices = graph.values.toList();
    final n = vertices.length;
    
    // 初始化随机位置
    for (var vertex in vertices) {
      vertex.x = random.nextDouble() * width;
      vertex.y = random.nextDouble() * height;
    }
    
    // 力导向布局迭代
    for (int iteration = 0; iteration < 100; iteration++) {
      // 计算斥力（所有节点之间）
      for (int i = 0; i < n; i++) {
        for (int j = i + 1; j < n; j++) {
          var v1 = vertices[i];
          var v2 = vertices[j];
          
          double dx = v2.x - v1.x;
          double dy = v2.y - v1.y;
          double distance = math.sqrt(dx * dx + dy * dy);
          
          if (distance > 0) {
            double force = 5000 / (distance * distance);
            double fx = (dx / distance) * force;
            double fy = (dy / distance) * force;
            
            v1.x -= fx;
            v1.y -= fy;
            v2.x += fx;
            v2.y += fy;
          }
        }
      }
      
      // 计算引力（连接的节点之间）
      for (var vertex in vertices) {
        for (var neighborId in vertex.edges.keys) {
          var neighbor = graph[neighborId]!;
          
          double dx = neighbor.x - vertex.x;
          double dy = neighbor.y - vertex.y;
          double distance = math.sqrt(dx * dx + dy * dy);
          
          if (distance > 0) {
            double force = distance * 0.01;
            double fx = (dx / distance) * force;
            double fy = (dy / distance) * force;
            
            vertex.x += fx;
            vertex.y += fy;
          }
        }
      }
      
      // 限制在画布范围内
      for (var vertex in vertices) {
        vertex.x = vertex.x.clamp(50, width - 50);
        vertex.y = vertex.y.clamp(50, height - 50);
      }
    }
  }
  
  /// 克隆图
  Map<String, GraphVertex> _cloneGraph(Map<String, GraphVertex> graph) {
    Map<String, GraphVertex> cloned = {};
    for (var entry in graph.entries) {
      var vertex = entry.value;
      cloned[entry.key] = GraphVertex(
        id: vertex.id,
        label: vertex.label,
        x: vertex.x,
        y: vertex.y,
        edges: Map.from(vertex.edges),
        isVisited: vertex.isVisited,
        isCurrentNode: vertex.isCurrentNode,
        isInPath: vertex.isInPath,
        distance: vertex.distance,
        parent: vertex.parent,
      );
    }
    return cloned;
  }
}
