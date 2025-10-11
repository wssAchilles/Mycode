// 死锁检测算法模型
import 'package:flutter/material.dart';

/// 死锁检测算法类型
enum DeadlockDetectionAlgorithm {
  resourceAllocationGraph('资源分配图法', 'RAG'),
  matrixReduction('矩阵化简法', 'Matrix'),
  bankersCheck('银行家检测', 'Banker');
  
  final String label;
  final String shortName;
  const DeadlockDetectionAlgorithm(this.label, this.shortName);
}

/// 资源分配图节点类型
enum RAGNodeType {
  process('进程', Icons.circle, Colors.blue),
  resource('资源', Icons.square, Colors.green);
  
  final String label;
  final IconData icon;
  final Color color;
  const RAGNodeType(this.label, this.icon, this.color);
}

/// 资源分配图边类型
enum RAGEdgeType {
  request('请求边', Colors.orange),
  allocation('分配边', Colors.green),
  cycle('环路', Colors.red);
  
  final String label;
  final Color color;
  const RAGEdgeType(this.label, this.color);
}

/// 资源分配图节点
class RAGNode {
  final String id;
  final String name;
  final RAGNodeType type;
  final int instances; // 资源实例数（只对资源节点有效）
  final Offset position;
  
  RAGNode({
    required this.id,
    required this.name,
    required this.type,
    this.instances = 1,
    this.position = Offset.zero,
  });
}

/// 资源分配图边
class RAGEdge {
  final String id;
  final String fromNodeId;
  final String toNodeId;
  final RAGEdgeType type;
  final bool isInCycle;
  
  RAGEdge({
    required this.id,
    required this.fromNodeId,
    required this.toNodeId,
    required this.type,
    this.isInCycle = false,
  });
}

/// 资源分配图
class ResourceAllocationGraph {
  final List<RAGNode> nodes;
  final List<RAGEdge> edges;
  final List<List<String>> cycles;
  
  ResourceAllocationGraph({
    required this.nodes,
    required this.edges,
    this.cycles = const [],
  });
  
  /// 获取进程节点
  List<RAGNode> get processNodes => 
      nodes.where((node) => node.type == RAGNodeType.process).toList();
  
  /// 获取资源节点
  List<RAGNode> get resourceNodes => 
      nodes.where((node) => node.type == RAGNodeType.resource).toList();
  
  /// 获取请求边
  List<RAGEdge> get requestEdges => 
      edges.where((edge) => edge.type == RAGEdgeType.request).toList();
  
  /// 获取分配边
  List<RAGEdge> get allocationEdges => 
      edges.where((edge) => edge.type == RAGEdgeType.allocation).toList();
}

/// 死锁检测结果
class DeadlockDetectionResult {
  final bool hasDeadlock;
  final List<String> deadlockedProcesses;
  final List<List<String>> cycles;
  final List<DetectionStep> steps;
  final String algorithm;
  final String summary;
  final Duration executionTime;
  
  DeadlockDetectionResult({
    required this.hasDeadlock,
    required this.deadlockedProcesses,
    this.cycles = const [],
    required this.steps,
    required this.algorithm,
    required this.summary,
    required this.executionTime,
  });
}

/// 检测步骤
class DetectionStep {
  final int stepNumber;
  final String description;
  final DetectionStepType type;
  final Map<String, dynamic> data;
  final List<String>? highlightedProcesses;
  final List<String>? highlightedResources;
  
  DetectionStep({
    required this.stepNumber,
    required this.description,
    required this.type,
    this.data = const {},
    this.highlightedProcesses,
    this.highlightedResources,
  });
}

/// 检测步骤类型
enum DetectionStepType {
  initialization('初始化', Colors.blue),
  graphConstruction('构建图', Colors.green),
  cycleDetection('环路检测', Colors.orange),
  matrixReduction('矩阵化简', Colors.purple),
  result('结果', Colors.red);
  
  final String label;
  final Color color;
  const DetectionStepType(this.label, this.color);
}

/// 系统状态快照
class SystemSnapshot {
  final List<ProcessInfo> processes;
  final List<ResourceInfo> resources;
  final List<List<int>> allocationMatrix;
  final List<List<int>> requestMatrix;
  final List<int> availableVector;
  final DateTime timestamp;
  
  SystemSnapshot({
    required this.processes,
    required this.resources,
    required this.allocationMatrix,
    required this.requestMatrix,
    required this.availableVector,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();
}

/// 进程信息
class ProcessInfo {
  final String id;
  final String name;
  final ProcessState state;
  final List<String> waitingFor;
  final List<String> holding;
  
  ProcessInfo({
    required this.id,
    required this.name,
    required this.state,
    this.waitingFor = const [],
    this.holding = const [],
  });
}

/// 进程状态
enum ProcessState {
  running('运行', Colors.green),
  ready('就绪', Colors.blue),
  blocked('阻塞', Colors.red),
  terminated('终止', Colors.grey);
  
  final String label;
  final Color color;
  const ProcessState(this.label, this.color);
}

/// 资源信息
class ResourceInfo {
  final String id;
  final String name;
  final int totalInstances;
  final int availableInstances;
  final List<String> allocatedTo;
  
  ResourceInfo({
    required this.id,
    required this.name,
    required this.totalInstances,
    required this.availableInstances,
    this.allocatedTo = const [],
  });
}

/// 死锁恢复策略
enum DeadlockRecoveryStrategy {
  processTermination('进程终止'),
  resourcePreemption('资源抢占'),
  rollback('进程回滚'),
  checkpoint('检查点恢复');
  
  final String label;
  const DeadlockRecoveryStrategy(this.label);
}

/// 恢复建议
class RecoveryRecommendation {
  final DeadlockRecoveryStrategy strategy;
  final List<String> targetProcesses;
  final List<String> targetResources;
  final String description;
  final int estimatedCost;
  final double successProbability;
  
  RecoveryRecommendation({
    required this.strategy,
    required this.targetProcesses,
    this.targetResources = const [],
    required this.description,
    required this.estimatedCost,
    required this.successProbability,
  });
}

/// 死锁统计信息
class DeadlockStatistics {
  final int totalDetections;
  final int deadlockCount;
  final double deadlockRate;
  final Map<String, int> algorithmUsage;
  final Map<String, double> algorithmAccuracy;
  final Duration averageDetectionTime;
  final List<String> commonDeadlockPatterns;
  
  DeadlockStatistics({
    required this.totalDetections,
    required this.deadlockCount,
    required this.deadlockRate,
    this.algorithmUsage = const {},
    this.algorithmAccuracy = const {},
    required this.averageDetectionTime,
    this.commonDeadlockPatterns = const [],
  });
}

/// 死锁预防规则
enum DeadlockPreventionRule {
  mutualExclusion('破坏互斥条件'),
  holdAndWait('破坏占有和等待'),
  noPreemption('破坏不可抢占'),
  circularWait('破坏循环等待');
  
  final String label;
  const DeadlockPreventionRule(this.label);
}

/// 预防建议
class PreventionRecommendation {
  final DeadlockPreventionRule rule;
  final String description;
  final List<String> implementationSteps;
  final int difficultyLevel; // 1-5
  final List<String> pros;
  final List<String> cons;
  
  PreventionRecommendation({
    required this.rule,
    required this.description,
    required this.implementationSteps,
    required this.difficultyLevel,
    required this.pros,
    required this.cons,
  });
}

/// 死锁模拟场景
class DeadlockScenario {
  final String id;
  final String name;
  final String description;
  final SystemSnapshot initialState;
  final List<SystemEvent> events;
  final bool shouldCauseDeadlock;
  final String educationalNote;
  
  DeadlockScenario({
    required this.id,
    required this.name,
    required this.description,
    required this.initialState,
    required this.events,
    required this.shouldCauseDeadlock,
    required this.educationalNote,
  });
}

/// 系统事件
class SystemEvent {
  final String id;
  final SystemEventType type;
  final String processId;
  final String? resourceId;
  final int timestamp;
  final Map<String, dynamic> parameters;
  
  SystemEvent({
    required this.id,
    required this.type,
    required this.processId,
    this.resourceId,
    required this.timestamp,
    this.parameters = const {},
  });
}

/// 系统事件类型
enum SystemEventType {
  resourceRequest('资源请求'),
  resourceRelease('资源释放'),
  processCreate('进程创建'),
  processTerminate('进程终止');
  
  final String label;
  const SystemEventType(this.label);
}

/// 死锁检测配置
class DeadlockDetectionConfig {
  final DeadlockDetectionAlgorithm algorithm;
  final bool enableVisualization;
  final bool showSteps;
  final int maxCycles; // 最大检测环路数
  final Duration timeout;
  
  const DeadlockDetectionConfig({
    this.algorithm = DeadlockDetectionAlgorithm.resourceAllocationGraph,
    this.enableVisualization = true,
    this.showSteps = true,
    this.maxCycles = 10,
    this.timeout = const Duration(seconds: 30),
  });
}
