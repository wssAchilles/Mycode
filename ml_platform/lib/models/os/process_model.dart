// 进程调度模型
import 'package:flutter/material.dart';

/// 进程状态枚举
enum ProcessState {
  ready('就绪', Colors.blue),
  running('运行', Colors.green),
  waiting('等待', Colors.orange),
  terminated('终止', Colors.grey);

  final String label;
  final Color color;
  const ProcessState(this.label, this.color);
}

/// 进程模型
class Process {
  final int pid;            // 进程ID
  final int arrivalTime;     // 到达时间
  final int burstTime;       // 服务时间（CPU执行时间）
  final int priority;        // 优先级（数字越小优先级越高）
  
  // 动态属性
  ProcessState state;        // 当前状态
  int remainingTime;         // 剩余服务时间
  int waitingTime;           // 等待时间
  int turnaroundTime;        // 周转时间
  int responseTime;          // 响应时间
  int completionTime;        // 完成时间
  int lastExecutionTime;     // 上次执行时间（用于RR算法）
  int currentQueueLevel;     // 当前队列级别（用于MLFQ算法）
  int timeInCurrentQueue;    // 在当前队列的时间（用于MLFQ算法）
  
  Process({
    required this.pid,
    required this.arrivalTime,
    required this.burstTime,
    this.priority = 0,
    this.state = ProcessState.ready,
  }) : remainingTime = burstTime,
       waitingTime = 0,
       turnaroundTime = 0,
       responseTime = -1,
       completionTime = 0,
       lastExecutionTime = 0,
       currentQueueLevel = 0,
       timeInCurrentQueue = 0;
  
  /// 克隆进程（用于模拟）
  Process clone() {
    return Process(
      pid: pid,
      arrivalTime: arrivalTime,
      burstTime: burstTime,
      priority: priority,
      state: state,
    )..remainingTime = remainingTime
     ..waitingTime = waitingTime
     ..turnaroundTime = turnaroundTime
     ..responseTime = responseTime
     ..completionTime = completionTime
     ..lastExecutionTime = lastExecutionTime
     ..currentQueueLevel = currentQueueLevel
     ..timeInCurrentQueue = timeInCurrentQueue;
  }
  
  /// 计算带权周转时间
  double get weightedTurnaroundTime {
    return burstTime > 0 ? turnaroundTime / burstTime : 0;
  }
  
  @override
  String toString() {
    return 'P$pid(到达:$arrivalTime, 服务:$burstTime, 优先级:$priority)';
  }
}

/// 调度事件（用于记录调度过程）
class SchedulingEvent {
  final int timestamp;          // 时间戳
  final int? runningPid;        // 正在运行的进程ID
  final List<int> readyQueue;   // 就绪队列中的进程ID列表
  final List<int> waitingQueue; // 等待队列中的进程ID列表
  final String description;     // 事件描述
  final EventType type;         // 事件类型
  
  SchedulingEvent({
    required this.timestamp,
    this.runningPid,
    this.readyQueue = const [],
    this.waitingQueue = const [],
    required this.description,
    this.type = EventType.normal,
  });
}

/// 事件类型
enum EventType {
  arrival('进程到达'),
  start('开始执行'),
  preempt('抢占'),
  complete('完成'),
  contextSwitch('上下文切换'),
  normal('正常');
  
  final String label;
  const EventType(this.label);
}

/// 甘特图项
class GanttItem {
  final int pid;        // 进程ID
  final int startTime;  // 开始时间
  final int endTime;    // 结束时间
  
  GanttItem({
    required this.pid,
    required this.startTime,
    required this.endTime,
  });
  
  int get duration => endTime - startTime;
}

/// 调度算法类型
enum SchedulingAlgorithm {
  fcfs('先来先服务', 'FCFS'),
  sjf('短作业优先', 'SJF'),
  priority('优先级调度', 'Priority'),
  rr('时间片轮转', 'RR'),
  mlfq('多级反馈队列', 'MLFQ');
  
  final String label;
  final String shortName;
  const SchedulingAlgorithm(this.label, this.shortName);
}

/// 调度结果
class SchedulingResult {
  final SchedulingAlgorithm algorithm;
  final List<Process> processes;          // 所有进程（包含最终状态）
  final List<GanttItem> ganttChart;       // 甘特图数据
  final List<SchedulingEvent> events;     // 事件日志
  final double averageWaitingTime;        // 平均等待时间
  final double averageTurnaroundTime;     // 平均周转时间
  final double averageWeightedTurnaroundTime; // 平均带权周转时间
  final double averageResponseTime;       // 平均响应时间
  final double cpuUtilization;            // CPU利用率
  final double throughput;                // 吞吐量
  final int contextSwitches;              // 上下文切换次数
  final int totalTime;                    // 总时间
  
  SchedulingResult({
    required this.algorithm,
    required this.processes,
    required this.ganttChart,
    required this.events,
    required this.averageWaitingTime,
    required this.averageTurnaroundTime,
    required this.averageWeightedTurnaroundTime,
    required this.averageResponseTime,
    required this.cpuUtilization,
    required this.throughput,
    required this.contextSwitches,
    required this.totalTime,
  });
  
  /// 获取特定时间点的状态快照
  SchedulingSnapshot? getSnapshotAt(int time) {
    // 找到该时间点或之前最近的事件
    SchedulingEvent? event;
    for (var e in events) {
      if (e.timestamp <= time) {
        event = e;
      } else {
        break;
      }
    }
    
    if (event == null) return null;
    
    // 确定当前运行的进程
    int? currentPid;
    for (var item in ganttChart) {
      if (item.startTime <= time && time < item.endTime) {
        currentPid = item.pid;
        break;
      }
    }
    
    return SchedulingSnapshot(
      timestamp: time,
      runningPid: currentPid,
      readyQueue: event.readyQueue,
      waitingQueue: event.waitingQueue,
      completedPids: processes
          .where((p) => p.completionTime > 0 && p.completionTime <= time)
          .map((p) => p.pid)
          .toList(),
    );
  }
}

/// 调度快照（某一时间点的状态）
class SchedulingSnapshot {
  final int timestamp;
  final int? runningPid;
  final List<int> readyQueue;
  final List<int> waitingQueue;
  final List<int> completedPids;
  
  SchedulingSnapshot({
    required this.timestamp,
    this.runningPid,
    required this.readyQueue,
    required this.waitingQueue,
    required this.completedPids,
  });
}

/// 调度配置
class SchedulingConfig {
  final int timeQuantum;     // 时间片大小（用于RR算法）
  final bool isPreemptive;   // 是否抢占式
  final int contextSwitchTime; // 上下文切换时间
  final MLFQConfig? mlfqConfig; // 多级反馈队列配置
  
  const SchedulingConfig({
    this.timeQuantum = 2,
    this.isPreemptive = false,
    this.contextSwitchTime = 0,
    this.mlfqConfig,
  });
}

/// 多级反馈队列配置
class MLFQConfig {
  final int queueCount;              // 队列数量
  final List<int> timeQuantums;      // 各队列时间片
  final int aging;                   // 老化时间
  final int boostInterval;           // 提升间隔
  
  MLFQConfig({
    this.queueCount = 3,
    List<int>? timeQuantums,
    this.aging = 10,
    this.boostInterval = 50,
  }) : timeQuantums = timeQuantums ?? [1, 2, 4];
  
  int getTimeQuantum(int queueLevel) {
    if (queueLevel >= timeQuantums.length) {
      return timeQuantums.last;
    }
    return timeQuantums[queueLevel];
  }
}
