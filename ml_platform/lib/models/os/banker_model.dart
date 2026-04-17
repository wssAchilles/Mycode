// 银行家算法模型
import 'package:flutter/material.dart';

/// 银行家算法状态
class BankerState {
  final int processCount;     // 进程数量
  final int resourceCount;    // 资源种类数量
  final List<List<int>> max;  // 最大需求矩阵
  final List<List<int>> allocation; // 已分配矩阵
  final List<List<int>> need;  // 需求矩阵
  final List<int> available;   // 可用资源向量
  final List<String> processNames; // 进程名称
  final List<String> resourceNames; // 资源名称
  
  BankerState({
    required this.processCount,
    required this.resourceCount,
    required this.max,
    required this.allocation,
    required this.need,
    required this.available,
    List<String>? processNames,
    List<String>? resourceNames,
  }) : processNames = processNames ?? List.generate(processCount, (i) => 'P$i'),
       resourceNames = resourceNames ?? List.generate(resourceCount, (i) => 'R$i');
  
  /// 创建副本
  BankerState clone() {
    return BankerState(
      processCount: processCount,
      resourceCount: resourceCount,
      max: max.map((row) => List<int>.from(row)).toList(),
      allocation: allocation.map((row) => List<int>.from(row)).toList(),
      need: need.map((row) => List<int>.from(row)).toList(),
      available: List<int>.from(available),
      processNames: List<String>.from(processNames),
      resourceNames: List<String>.from(resourceNames),
    );
  }
  
  /// 根据Max和Allocation计算Need矩阵
  static List<List<int>> calculateNeed(List<List<int>> max, List<List<int>> allocation) {
    int n = max.length;
    int m = max[0].length;
    List<List<int>> need = List.generate(n, (_) => List.filled(m, 0));
    
    for (int i = 0; i < n; i++) {
      for (int j = 0; j < m; j++) {
        need[i][j] = max[i][j] - allocation[i][j];
      }
    }
    
    return need;
  }
  
  /// 计算总资源
  List<int> calculateTotalResources() {
    List<int> total = List.filled(resourceCount, 0);
    
    // 已分配的资源
    for (int i = 0; i < processCount; i++) {
      for (int j = 0; j < resourceCount; j++) {
        total[j] += allocation[i][j];
      }
    }
    
    // 加上可用资源
    for (int j = 0; j < resourceCount; j++) {
      total[j] += available[j];
    }
    
    return total;
  }
  
  /// 转换为JSON格式
  Map<String, dynamic> toJson() {
    return {
      'processCount': processCount,
      'resourceCount': resourceCount,
      'max': max,
      'allocation': allocation,
      'need': need,
      'available': available,
      'processNames': processNames,
      'resourceNames': resourceNames,
    };
  }
}

/// 资源请求
class ResourceRequest {
  final int processIndex;     // 请求进程的索引
  final List<int> request;     // 请求资源向量
  final DateTime timestamp;
  
  ResourceRequest({
    required this.processIndex,
    required this.request,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();
}

/// 安全性检查结果
class SafetyCheckResult {
  final bool isSafe;                    // 是否安全
  final List<int>? safeSequence;        // 安全序列
  final List<SafetyCheckStep> steps;    // 检查步骤
  final String message;                 // 结果消息
  
  SafetyCheckResult({
    required this.isSafe,
    this.safeSequence,
    required this.steps,
    required this.message,
  });
}

/// 安全性检查步骤
class SafetyCheckStep {
  final int stepNumber;              // 步骤编号
  final int? checkingProcess;        // 正在检查的进程
  final List<int> work;              // Work向量
  final List<bool> finish;           // Finish向量
  final List<int> safeSequence;      // 当前安全序列
  final String description;          // 步骤描述
  final StepType type;               // 步骤类型
  
  SafetyCheckStep({
    required this.stepNumber,
    this.checkingProcess,
    required this.work,
    required this.finish,
    required this.safeSequence,
    required this.description,
    this.type = StepType.check,
  });
}

/// 步骤类型
enum StepType {
  initialize('初始化', Colors.blue),
  check('检查', Colors.orange),
  allocate('分配', Colors.green),
  skip('跳过', Colors.grey),
  success('成功', Colors.green),
  fail('失败', Colors.red);
  
  final String label;
  final Color color;
  const StepType(this.label, this.color);
}

/// 资源请求结果
class ResourceRequestResult {
  final bool success;                   // 请求是否成功
  final BankerState? newState;         // 新状态（如果成功）
  final List<RequestCheckStep> steps;  // 检查步骤
  final String message;                 // 结果消息
  
  ResourceRequestResult({
    required this.success,
    this.newState,
    required this.steps,
    required this.message,
  });
}

/// 资源请求检查步骤
class RequestCheckStep {
  final String description;
  final CheckType type;
  final bool passed;
  
  RequestCheckStep({
    required this.description,
    required this.type,
    required this.passed,
  });
}

/// 检查类型
enum CheckType {
  needCheck('需求检查'),
  availableCheck('可用性检查'),
  safetyCheck('安全性检查');
  
  final String label;
  const CheckType(this.label);
}

/// 银行家算法示例数据
class BankerExample {
  final String name;
  final String description;
  final BankerState state;
  
  BankerExample({
    required this.name,
    required this.description,
    required this.state,
  });
  
  /// 获取预定义示例
  static List<BankerExample> getExamples() {
    return [
      BankerExample(
        name: '基础示例',
        description: '3个进程，3种资源的简单场景',
        state: BankerState(
          processCount: 3,
          resourceCount: 3,
          max: [
            [7, 5, 3],
            [3, 2, 2],
            [9, 0, 2],
          ],
          allocation: [
            [0, 1, 0],
            [2, 0, 0],
            [3, 0, 2],
          ],
          need: [
            [7, 4, 3],
            [1, 2, 2],
            [6, 0, 0],
          ],
          available: [3, 3, 2],
          processNames: ['P0', 'P1', 'P2'],
          resourceNames: ['A', 'B', 'C'],
        ),
      ),
      BankerExample(
        name: '教材示例',
        description: '5个进程，3种资源的经典示例',
        state: BankerState(
          processCount: 5,
          resourceCount: 3,
          max: [
            [7, 5, 3],
            [3, 2, 2],
            [9, 0, 2],
            [2, 2, 2],
            [4, 3, 3],
          ],
          allocation: [
            [0, 1, 0],
            [2, 0, 0],
            [3, 0, 2],
            [2, 1, 1],
            [0, 0, 2],
          ],
          need: [
            [7, 4, 3],
            [1, 2, 2],
            [6, 0, 0],
            [0, 1, 1],
            [4, 3, 1],
          ],
          available: [3, 3, 2],
          processNames: ['P0', 'P1', 'P2', 'P3', 'P4'],
          resourceNames: ['A', 'B', 'C'],
        ),
      ),
      BankerExample(
        name: '复杂示例',
        description: '4个进程，4种资源的复杂场景',
        state: BankerState(
          processCount: 4,
          resourceCount: 4,
          max: [
            [6, 4, 7, 3],
            [4, 2, 3, 2],
            [2, 5, 3, 3],
            [6, 3, 3, 2],
          ],
          allocation: [
            [1, 2, 2, 1],
            [1, 0, 3, 0],
            [1, 2, 1, 0],
            [3, 1, 2, 1],
          ],
          need: [
            [5, 2, 5, 2],
            [3, 2, 0, 2],
            [1, 3, 2, 3],
            [3, 2, 1, 1],
          ],
          available: [1, 2, 2, 0],
          processNames: ['P0', 'P1', 'P2', 'P3'],
          resourceNames: ['CPU', 'Memory', 'Disk', 'Printer'],
        ),
      ),
    ];
  }
}

/// 银行家算法统计信息
class BankerStatistics {
  final int totalResources;
  final int allocatedResources;
  final int availableResources;
  final double utilizationRate;
  final int maxPossibleRequests;
  
  BankerStatistics({
    required this.totalResources,
    required this.allocatedResources,
    required this.availableResources,
    required this.utilizationRate,
    required this.maxPossibleRequests,
  });
  
  factory BankerStatistics.fromState(BankerState state) {
    List<int> total = state.calculateTotalResources();
    int totalRes = total.reduce((a, b) => a + b);
    int availableRes = state.available.reduce((a, b) => a + b);
    int allocatedRes = totalRes - availableRes;
    
    // 计算最大可能的请求数
    int maxRequests = 0;
    for (int i = 0; i < state.processCount; i++) {
      for (int j = 0; j < state.resourceCount; j++) {
        if (state.need[i][j] > 0) {
          maxRequests++;
        }
      }
    }
    
    return BankerStatistics(
      totalResources: totalRes,
      allocatedResources: allocatedRes,
      availableResources: availableRes,
      utilizationRate: totalRes > 0 ? allocatedRes / totalRes : 0,
      maxPossibleRequests: maxRequests,
    );
  }
}
