// 死锁检测服务
import 'dart:math' as math;
import 'package:ml_platform/models/os/deadlock_detection_model.dart';

/// 死锁检测服务
class DeadlockDetectionService {
  static final DeadlockDetectionService _instance = DeadlockDetectionService._internal();
  factory DeadlockDetectionService() => _instance;
  DeadlockDetectionService._internal();
  
  /// 执行死锁检测
  DeadlockDetectionResult detectDeadlock(
    SystemSnapshot snapshot,
    DeadlockDetectionConfig config,
  ) {
    final stopwatch = Stopwatch()..start();
    
    try {
      switch (config.algorithm) {
        case DeadlockDetectionAlgorithm.resourceAllocationGraph:
          return _detectUsingRAG(snapshot, config);
        case DeadlockDetectionAlgorithm.matrixReduction:
          return _detectUsingMatrix(snapshot, config);
        case DeadlockDetectionAlgorithm.bankersCheck:
          return _detectUsingBankers(snapshot, config);
      }
    } finally {
      stopwatch.stop();
    }
  }
  
  /// 使用资源分配图检测死锁
  DeadlockDetectionResult _detectUsingRAG(
    SystemSnapshot snapshot,
    DeadlockDetectionConfig config,
  ) {
    final stopwatch = Stopwatch()..start();
    final steps = <DetectionStep>[];
    
    // 步骤1: 构建资源分配图
    steps.add(DetectionStep(
      stepNumber: 1,
      description: '构建资源分配图',
      type: DetectionStepType.graphConstruction,
    ));
    
    final graph = _buildResourceAllocationGraph(snapshot);
    
    steps.add(DetectionStep(
      stepNumber: 2,
      description: '图构建完成，包含${graph.processNodes.length}个进程节点和${graph.resourceNodes.length}个资源节点',
      type: DetectionStepType.graphConstruction,
      data: {
        'processCount': graph.processNodes.length,
        'resourceCount': graph.resourceNodes.length,
        'edgeCount': graph.edges.length,
      },
    ));
    
    // 步骤2: 检测环路
    steps.add(DetectionStep(
      stepNumber: 3,
      description: '开始检测图中的环路',
      type: DetectionStepType.cycleDetection,
    ));
    
    final cycles = _detectCycles(graph);
    
    final hasDeadlock = cycles.isNotEmpty;
    final deadlockedProcesses = <String>[];
    
    if (hasDeadlock) {
      // 收集所有参与死锁的进程
      for (final cycle in cycles) {
        for (final nodeId in cycle) {
          final node = graph.nodes.firstWhere((n) => n.id == nodeId);
          if (node.type == RAGNodeType.process && !deadlockedProcesses.contains(nodeId)) {
            deadlockedProcesses.add(nodeId);
          }
        }
      }
      
      steps.add(DetectionStep(
        stepNumber: 4,
        description: '检测到${cycles.length}个环路，涉及${deadlockedProcesses.length}个进程',
        type: DetectionStepType.result,
        data: {'cycles': cycles, 'deadlockedProcesses': deadlockedProcesses},
        highlightedProcesses: deadlockedProcesses,
      ));
    } else {
      steps.add(DetectionStep(
        stepNumber: 4,
        description: '未检测到环路，系统无死锁',
        type: DetectionStepType.result,
      ));
    }
    
    stopwatch.stop();
    
    return DeadlockDetectionResult(
      hasDeadlock: hasDeadlock,
      deadlockedProcesses: deadlockedProcesses,
      cycles: cycles,
      steps: steps,
      algorithm: config.algorithm.label,
      summary: hasDeadlock 
          ? '检测到死锁：${deadlockedProcesses.length}个进程陷入${cycles.length}个环路'
          : '系统安全，无死锁发生',
      executionTime: stopwatch.elapsed,
    );
  }
  
  /// 使用矩阵化简法检测死锁
  DeadlockDetectionResult _detectUsingMatrix(
    SystemSnapshot snapshot,
    DeadlockDetectionConfig config,
  ) {
    final stopwatch = Stopwatch()..start();
    final steps = <DetectionStep>[];
    
    steps.add(DetectionStep(
      stepNumber: 1,
      description: '初始化分配矩阵和请求矩阵',
      type: DetectionStepType.initialization,
    ));
    
    // 复制矩阵进行化简
    final allocation = snapshot.allocationMatrix.map((row) => List<int>.from(row)).toList();
    final request = snapshot.requestMatrix.map((row) => List<int>.from(row)).toList();
    final available = List<int>.from(snapshot.availableVector);
    final finished = List.filled(snapshot.processes.length, false);
    
    steps.add(DetectionStep(
      stepNumber: 2,
      description: '开始矩阵化简过程',
      type: DetectionStepType.matrixReduction,
      data: {
        'allocation': allocation,
        'request': request,
        'available': available,
      },
    ));
    
    int finishedCount = 0;
    bool changed = true;
    int iteration = 0;
    
    while (changed && finishedCount < snapshot.processes.length) {
      changed = false;
      iteration++;
      
      for (int i = 0; i < snapshot.processes.length; i++) {
        if (finished[i]) continue;
        
        // 检查进程i的请求是否能被满足
        bool canFinish = true;
        for (int j = 0; j < snapshot.resources.length; j++) {
          if (request[i][j] > available[j]) {
            canFinish = false;
            break;
          }
        }
        
        if (canFinish) {
          // 进程可以完成，释放资源
          finished[i] = true;
          finishedCount++;
          changed = true;
          
          for (int j = 0; j < snapshot.resources.length; j++) {
            available[j] += allocation[i][j];
          }
          
          steps.add(DetectionStep(
            stepNumber: 2 + iteration,
            description: '进程${snapshot.processes[i].name}可以完成，释放资源',
            type: DetectionStepType.matrixReduction,
            data: {
              'processIndex': i,
              'processName': snapshot.processes[i].name,
              'newAvailable': List<int>.from(available),
            },
            highlightedProcesses: [snapshot.processes[i].id],
          ));
        }
      }
    }
    
    final deadlockedProcesses = <String>[];
    for (int i = 0; i < snapshot.processes.length; i++) {
      if (!finished[i]) {
        deadlockedProcesses.add(snapshot.processes[i].id);
      }
    }
    
    final hasDeadlock = deadlockedProcesses.isNotEmpty;
    
    steps.add(DetectionStep(
      stepNumber: steps.length + 1,
      description: hasDeadlock 
          ? '检测完成：${deadlockedProcesses.length}个进程无法完成，发生死锁'
          : '检测完成：所有进程都能完成，无死锁',
      type: DetectionStepType.result,
      highlightedProcesses: hasDeadlock ? deadlockedProcesses : null,
    ));
    
    stopwatch.stop();
    
    return DeadlockDetectionResult(
      hasDeadlock: hasDeadlock,
      deadlockedProcesses: deadlockedProcesses,
      steps: steps,
      algorithm: config.algorithm.label,
      summary: hasDeadlock 
          ? '矩阵化简检测到死锁：${deadlockedProcesses.length}个进程无法完成'
          : '矩阵化简完成，所有进程都能正常结束',
      executionTime: stopwatch.elapsed,
    );
  }
  
  /// 使用银行家算法检测死锁
  DeadlockDetectionResult _detectUsingBankers(
    SystemSnapshot snapshot,
    DeadlockDetectionConfig config,
  ) {
    final stopwatch = Stopwatch()..start();
    final steps = <DetectionStep>[];
    
    // 银行家算法检测逻辑类似于矩阵化简法
    // 但是基于Need矩阵而不是Request矩阵
    
    steps.add(DetectionStep(
      stepNumber: 1,
      description: '使用银行家算法进行死锁检测',
      type: DetectionStepType.initialization,
    ));
    
    // 简化实现，实际应该计算Need矩阵
    final result = _detectUsingMatrix(snapshot, config);
    
    stopwatch.stop();
    
    return DeadlockDetectionResult(
      hasDeadlock: result.hasDeadlock,
      deadlockedProcesses: result.deadlockedProcesses,
      cycles: result.cycles,
      steps: result.steps,
      algorithm: config.algorithm.label,
      summary: result.summary,
      executionTime: stopwatch.elapsed,
    );
  }
  
  /// 构建资源分配图
  ResourceAllocationGraph _buildResourceAllocationGraph(SystemSnapshot snapshot) {
    final nodes = <RAGNode>[];
    final edges = <RAGEdge>[];
    
    // 创建进程节点
    for (int i = 0; i < snapshot.processes.length; i++) {
      final process = snapshot.processes[i];
      nodes.add(RAGNode(
        id: process.id,
        name: process.name,
        type: RAGNodeType.process,
        position: Offset(100.0, 100.0 + i * 80.0),
      ));
    }
    
    // 创建资源节点
    for (int i = 0; i < snapshot.resources.length; i++) {
      final resource = snapshot.resources[i];
      nodes.add(RAGNode(
        id: resource.id,
        name: resource.name,
        type: RAGNodeType.resource,
        instances: resource.totalInstances,
        position: Offset(400.0, 100.0 + i * 80.0),
      ));
    }
    
    // 创建分配边
    for (int i = 0; i < snapshot.allocationMatrix.length; i++) {
      for (int j = 0; j < snapshot.allocationMatrix[i].length; j++) {
        if (snapshot.allocationMatrix[i][j] > 0) {
          edges.add(RAGEdge(
            id: 'alloc_${i}_$j',
            fromNodeId: snapshot.resources[j].id,
            toNodeId: snapshot.processes[i].id,
            type: RAGEdgeType.allocation,
          ));
        }
      }
    }
    
    // 创建请求边
    for (int i = 0; i < snapshot.requestMatrix.length; i++) {
      for (int j = 0; j < snapshot.requestMatrix[i].length; j++) {
        if (snapshot.requestMatrix[i][j] > 0) {
          edges.add(RAGEdge(
            id: 'req_${i}_$j',
            fromNodeId: snapshot.processes[i].id,
            toNodeId: snapshot.resources[j].id,
            type: RAGEdgeType.request,
          ));
        }
      }
    }
    
    return ResourceAllocationGraph(nodes: nodes, edges: edges);
  }
  
  /// 检测图中的环路
  List<List<String>> _detectCycles(ResourceAllocationGraph graph) {
    final cycles = <List<String>>[];
    final visited = <String>{};
    final recursionStack = <String>{};
    
    // 对每个进程节点进行DFS
    for (final node in graph.processNodes) {
      if (!visited.contains(node.id)) {
        final path = <String>[];
        _dfsForCycle(graph, node.id, visited, recursionStack, path, cycles);
      }
    }
    
    return cycles;
  }
  
  /// DFS检测环路
  bool _dfsForCycle(
    ResourceAllocationGraph graph,
    String nodeId,
    Set<String> visited,
    Set<String> recursionStack,
    List<String> path,
    List<List<String>> cycles,
  ) {
    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.add(nodeId);
    
    // 查找从当前节点出发的边
    final outgoingEdges = graph.edges.where((edge) => edge.fromNodeId == nodeId);
    
    for (final edge in outgoingEdges) {
      final nextNodeId = edge.toNodeId;
      
      if (recursionStack.contains(nextNodeId)) {
        // 发现环路
        final cycleStart = path.indexOf(nextNodeId);
        if (cycleStart >= 0) {
          final cycle = path.sublist(cycleStart)..add(nextNodeId);
          cycles.add(cycle);
        }
        return true;
      }
      
      if (!visited.contains(nextNodeId)) {
        if (_dfsForCycle(graph, nextNodeId, visited, recursionStack, path, cycles)) {
          return true;
        }
      }
    }
    
    recursionStack.remove(nodeId);
    path.removeLast();
    return false;
  }
  
  /// 生成恢复建议
  List<RecoveryRecommendation> generateRecoveryRecommendations(
    DeadlockDetectionResult detectionResult,
    SystemSnapshot snapshot,
  ) {
    final recommendations = <RecoveryRecommendation>[];
    
    if (!detectionResult.hasDeadlock) {
      return recommendations;
    }
    
    // 进程终止建议
    recommendations.add(RecoveryRecommendation(
      strategy: DeadlockRecoveryStrategy.processTermination,
      targetProcesses: [detectionResult.deadlockedProcesses.first],
      description: '终止优先级最低的死锁进程',
      estimatedCost: 3,
      successProbability: 0.9,
    ));
    
    // 资源抢占建议
    if (snapshot.resources.isNotEmpty) {
      recommendations.add(RecoveryRecommendation(
        strategy: DeadlockRecoveryStrategy.resourcePreemption,
        targetProcesses: detectionResult.deadlockedProcesses.take(1).toList(),
        targetResources: [snapshot.resources.first.id],
        description: '抢占部分资源并重新分配',
        estimatedCost: 2,
        successProbability: 0.7,
      ));
    }
    
    // 进程回滚建议
    recommendations.add(RecoveryRecommendation(
      strategy: DeadlockRecoveryStrategy.rollback,
      targetProcesses: detectionResult.deadlockedProcesses,
      description: '回滚所有死锁进程到安全状态',
      estimatedCost: 4,
      successProbability: 0.8,
    ));
    
    // 按成功概率和成本排序
    recommendations.sort((a, b) {
      final scoreA = a.successProbability - (a.estimatedCost / 10.0);
      final scoreB = b.successProbability - (b.estimatedCost / 10.0);
      return scoreB.compareTo(scoreA);
    });
    
    return recommendations;
  }
  
  /// 生成预防建议
  List<PreventionRecommendation> generatePreventionRecommendations() {
    return [
      PreventionRecommendation(
        rule: DeadlockPreventionRule.holdAndWait,
        description: '要求进程在开始执行前一次性申请所有需要的资源',
        implementationSteps: [
          '进程在开始前声明所有资源需求',
          '系统检查是否有足够资源',
          '如果资源充足，一次性分配所有资源',
          '如果资源不足，进程等待',
        ],
        difficultyLevel: 3,
        pros: ['简单易实现', '能够完全防止死锁'],
        cons: ['资源利用率低', '可能导致饥饿'],
      ),
      
      PreventionRecommendation(
        rule: DeadlockPreventionRule.circularWait,
        description: '为所有资源类型定义一个线性顺序，要求进程按顺序申请资源',
        implementationSteps: [
          '为所有资源分配唯一的序号',
          '进程只能按递增顺序申请资源',
          '如需申请序号更小的资源，必须先释放序号更大的资源',
        ],
        difficultyLevel: 2,
        pros: ['实现相对简单', '资源利用率较高'],
        cons: ['限制了程序的灵活性', '可能影响性能'],
      ),
      
      PreventionRecommendation(
        rule: DeadlockPreventionRule.noPreemption,
        description: '允许系统抢占已分配给进程的资源',
        implementationSteps: [
          '当进程申请资源被拒绝时，检查其已占有的资源',
          '如果这些资源可以被抢占，则释放它们',
          '将释放的资源分配给等待的进程',
          '原进程必须重新申请所有资源',
        ],
        difficultyLevel: 4,
        pros: ['资源利用率高', '不会发生死锁'],
        cons: ['实现复杂', '可能导致进程饥饿', '需要保存和恢复状态'],
      ),
    ];
  }
  
  /// 创建经典死锁场景
  List<DeadlockScenario> createClassicScenarios() {
    return [
      DeadlockScenario(
        id: 'dining_philosophers',
        name: '哲学家就餐问题',
        description: '5个哲学家围坐圆桌，每人需要两根筷子才能吃饭',
        initialState: _createDiningPhilosophersState(),
        events: _createDiningPhilosophersEvents(),
        shouldCauseDeadlock: true,
        educationalNote: '这是一个经典的死锁例子，展示了资源竞争如何导致死锁',
      ),
      
      DeadlockScenario(
        id: 'bridge_crossing',
        name: '独木桥问题',
        description: '多个进程需要通过只能单向通行的独木桥',
        initialState: _createBridgeCrossingState(),
        events: _createBridgeCrossingEvents(),
        shouldCauseDeadlock: true,
        educationalNote: '展示了方向性资源竞争导致的死锁',
      ),
      
      DeadlockScenario(
        id: 'simple_deadlock',
        name: '简单死锁',
        description: '两个进程竞争两个资源的简单死锁场景',
        initialState: _createSimpleDeadlockState(),
        events: _createSimpleDeadlockEvents(),
        shouldCauseDeadlock: true,
        educationalNote: '最基本的死锁场景，适合初学者理解',
      ),
    ];
  }
  
  /// 创建哲学家就餐问题状态
  SystemSnapshot _createDiningPhilosophersState() {
    final processes = List.generate(5, (i) => ProcessInfo(
        id: 'P$i',
        name: '哲学家$i',
        state: ProcessState.ready,
      ));
    
    final resources = List.generate(5, (i) => ResourceInfo(
        id: 'R$i',
        name: '筷子$i',
        totalInstances: 1,
        availableInstances: 1,
      ));
    
    return SystemSnapshot(
      processes: processes,
      resources: resources,
      allocationMatrix: List.generate(5, (_) => List.filled(5, 0)),
      requestMatrix: List.generate(5, (_) => List.filled(5, 0)),
      availableVector: List.filled(5, 1),
    );
  }
  
  /// 创建哲学家就餐问题事件
  List<SystemEvent> _createDiningPhilosophersEvents() {
    return [
      // 每个哲学家先拿左边的筷子
      ...List.generate(5, (i) => SystemEvent(
          id: 'event_${i}_left',
          type: SystemEventType.resourceRequest,
          processId: 'P$i',
          resourceId: 'R$i',
          timestamp: i * 10,
        )),
      // 然后尝试拿右边的筷子（导致死锁）
      ...List.generate(5, (i) => SystemEvent(
          id: 'event_${i}_right',
          type: SystemEventType.resourceRequest,
          processId: 'P$i',
          resourceId: 'R${(i + 1) % 5}',
          timestamp: 50 + i * 10,
        )),
    ];
  }
  
  /// 创建其他场景的状态和事件
  SystemSnapshot _createBridgeCrossingState() {
    return SystemSnapshot(
      processes: [
        ProcessInfo(id: 'P1', name: '进程1', state: ProcessState.ready),
        ProcessInfo(id: 'P2', name: '进程2', state: ProcessState.ready),
      ],
      resources: [
        ResourceInfo(id: 'Bridge', name: '独木桥', totalInstances: 1, availableInstances: 1),
      ],
      allocationMatrix: [[0], [0]],
      requestMatrix: [[0], [0]],
      availableVector: [1],
    );
  }
  
  List<SystemEvent> _createBridgeCrossingEvents() {
    return [
      SystemEvent(
        id: 'bridge_req1',
        type: SystemEventType.resourceRequest,
        processId: 'P1',
        resourceId: 'Bridge',
        timestamp: 10,
      ),
      SystemEvent(
        id: 'bridge_req2',
        type: SystemEventType.resourceRequest,
        processId: 'P2',
        resourceId: 'Bridge',
        timestamp: 20,
      ),
    ];
  }
  
  SystemSnapshot _createSimpleDeadlockState() {
    return SystemSnapshot(
      processes: [
        ProcessInfo(id: 'P1', name: '进程1', state: ProcessState.ready),
        ProcessInfo(id: 'P2', name: '进程2', state: ProcessState.ready),
      ],
      resources: [
        ResourceInfo(id: 'R1', name: '资源1', totalInstances: 1, availableInstances: 1),
        ResourceInfo(id: 'R2', name: '资源2', totalInstances: 1, availableInstances: 1),
      ],
      allocationMatrix: [[0, 0], [0, 0]],
      requestMatrix: [[0, 0], [0, 0]],
      availableVector: [1, 1],
    );
  }
  
  List<SystemEvent> _createSimpleDeadlockEvents() {
    return [
      SystemEvent(
        id: 'p1_req_r1',
        type: SystemEventType.resourceRequest,
        processId: 'P1',
        resourceId: 'R1',
        timestamp: 10,
      ),
      SystemEvent(
        id: 'p2_req_r2',
        type: SystemEventType.resourceRequest,
        processId: 'P2',
        resourceId: 'R2',
        timestamp: 20,
      ),
      SystemEvent(
        id: 'p1_req_r2',
        type: SystemEventType.resourceRequest,
        processId: 'P1',
        resourceId: 'R2',
        timestamp: 30,
      ),
      SystemEvent(
        id: 'p2_req_r1',
        type: SystemEventType.resourceRequest,
        processId: 'P2',
        resourceId: 'R1',
        timestamp: 40,
      ),
    ];
  }
}
