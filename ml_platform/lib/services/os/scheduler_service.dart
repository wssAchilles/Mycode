// 进程调度算法服务
import 'dart:collection';
import 'dart:math' as math;
import 'package:ml_platform/models/os/process_model.dart';

/// 进程调度服务
class SchedulerService {
  static final SchedulerService _instance = SchedulerService._internal();
  factory SchedulerService() => _instance;
  SchedulerService._internal();
  
  /// 执行调度算法
  SchedulingResult executeScheduling({
    required List<Process> processes,
    required SchedulingAlgorithm algorithm,
    SchedulingConfig config = const SchedulingConfig(),
  }) {
    // 克隆进程列表，避免修改原始数据
    final processList = processes.map((p) => p.clone()).toList();
    
    switch (algorithm) {
      case SchedulingAlgorithm.fcfs:
        return _executeFCFS(processList);
      case SchedulingAlgorithm.sjf:
        return _executeSJF(processList, config.isPreemptive);
      case SchedulingAlgorithm.priority:
        return _executePriority(processList, config.isPreemptive);
      case SchedulingAlgorithm.rr:
        return _executeRR(processList, config.timeQuantum);
      case SchedulingAlgorithm.mlfq:
        return _executeMLFQ(processList, config.mlfqConfig ?? MLFQConfig());
    }
  }
  
  /// 先来先服务 (FCFS)
  SchedulingResult _executeFCFS(List<Process> processes) {
    // 按到达时间排序
    processes.sort((a, b) => a.arrivalTime.compareTo(b.arrivalTime));
    
    final ganttChart = <GanttItem>[];
    final events = <SchedulingEvent>[];
    final readyQueue = Queue<Process>();
    int currentTime = 0;
    int contextSwitches = 0;
    Process? currentProcess;
    
    // 记录初始事件
    events.add(SchedulingEvent(
      timestamp: 0,
      description: '调度开始 - FCFS算法',
      type: EventType.normal,
    ));
    
    while (processes.any((p) => p.state != ProcessState.terminated) ||
           readyQueue.isNotEmpty ||
           currentProcess != null) {
      
      // 检查新到达的进程
      for (var process in processes) {
        if (process.arrivalTime == currentTime && 
            process.state == ProcessState.ready &&
            !readyQueue.contains(process) &&
            process != currentProcess) {
          readyQueue.add(process);
          events.add(SchedulingEvent(
            timestamp: currentTime,
            description: '进程P${process.pid}到达',
            readyQueue: readyQueue.map((p) => p.pid).toList(),
            type: EventType.arrival,
          ));
        }
      }
      
      // 如果当前没有进程在执行，选择下一个进程
      if (currentProcess == null && readyQueue.isNotEmpty) {
        currentProcess = readyQueue.removeFirst();
        currentProcess.state = ProcessState.running;
        
        // 记录响应时间
        if (currentProcess.responseTime == -1) {
          currentProcess.responseTime = currentTime - currentProcess.arrivalTime;
        }
        
        events.add(SchedulingEvent(
          timestamp: currentTime,
          runningPid: currentProcess.pid,
          readyQueue: readyQueue.map((p) => p.pid).toList(),
          description: '进程P${currentProcess.pid}开始执行',
          type: EventType.start,
        ));
        
        if (ganttChart.isNotEmpty) {
          contextSwitches++;
        }
      }
      
      // 执行当前进程
      if (currentProcess != null) {
        currentProcess.remainingTime--;
        
        // 检查进程是否完成
        if (currentProcess.remainingTime == 0) {
          currentProcess.state = ProcessState.terminated;
          currentProcess.completionTime = currentTime + 1;
          currentProcess.turnaroundTime = 
              currentProcess.completionTime - currentProcess.arrivalTime;
          currentProcess.waitingTime = 
              currentProcess.turnaroundTime - currentProcess.burstTime;
          
          // 添加到甘特图
          if (ganttChart.isNotEmpty && ganttChart.last.pid == currentProcess.pid) {
            ganttChart.last = GanttItem(
              pid: currentProcess.pid,
              startTime: ganttChart.last.startTime,
              endTime: currentTime + 1,
            );
          } else {
            ganttChart.add(GanttItem(
              pid: currentProcess.pid,
              startTime: currentTime - (currentProcess.burstTime - currentProcess.remainingTime - 1),
              endTime: currentTime + 1,
            ));
          }
          
          events.add(SchedulingEvent(
            timestamp: currentTime + 1,
            readyQueue: readyQueue.map((p) => p.pid).toList(),
            description: '进程P${currentProcess.pid}完成执行',
            type: EventType.complete,
          ));
          
          currentProcess = null;
        }
      }
      
      currentTime++;
      
      // 防止无限循环
      if (currentTime > 1000) break;
    }
    
    return _calculateResult(
      algorithm: SchedulingAlgorithm.fcfs,
      processes: processes,
      ganttChart: ganttChart,
      events: events,
      contextSwitches: contextSwitches,
      totalTime: currentTime,
    );
  }
  
  /// 短作业优先 (SJF)
  SchedulingResult _executeSJF(List<Process> processes, bool isPreemptive) {
    final ganttChart = <GanttItem>[];
    final events = <SchedulingEvent>[];
    final readyQueue = <Process>[];
    int currentTime = 0;
    int contextSwitches = 0;
    Process? currentProcess;
    int? processStartTime;
    
    events.add(SchedulingEvent(
      timestamp: 0,
      description: '调度开始 - SJF算法${isPreemptive ? "(抢占式)" : "(非抢占式)"}',
      type: EventType.normal,
    ));
    
    while (processes.any((p) => p.state != ProcessState.terminated) ||
           readyQueue.isNotEmpty ||
           currentProcess != null) {
      
      // 检查新到达的进程
      for (var process in processes) {
        if (process.arrivalTime == currentTime && 
            process.state == ProcessState.ready &&
            !readyQueue.contains(process) &&
            process != currentProcess) {
          readyQueue.add(process);
          // 按剩余时间排序
          readyQueue.sort((a, b) => a.remainingTime.compareTo(b.remainingTime));
          
          events.add(SchedulingEvent(
            timestamp: currentTime,
            description: '进程P${process.pid}到达',
            readyQueue: readyQueue.map((p) => p.pid).toList(),
            type: EventType.arrival,
          ));
        }
      }
      
      // 抢占式SJF：检查是否需要抢占
      if (isPreemptive && currentProcess != null && readyQueue.isNotEmpty) {
        final shortestJob = readyQueue.first;
        if (shortestJob.remainingTime < currentProcess.remainingTime) {
          // 保存当前进程到甘特图
          ganttChart.add(GanttItem(
            pid: currentProcess.pid,
            startTime: processStartTime!,
            endTime: currentTime,
          ));
          
          // 抢占
          currentProcess.state = ProcessState.ready;
          readyQueue.add(currentProcess);
          readyQueue.sort((a, b) => a.remainingTime.compareTo(b.remainingTime));
          
          currentProcess = readyQueue.removeAt(0);
          currentProcess.state = ProcessState.running;
          processStartTime = currentTime;
          contextSwitches++;
          
          events.add(SchedulingEvent(
            timestamp: currentTime,
            runningPid: currentProcess.pid,
            readyQueue: readyQueue.map((p) => p.pid).toList(),
            description: '进程P${currentProcess.pid}抢占CPU',
            type: EventType.preempt,
          ));
        }
      }
      
      // 选择下一个进程
      if (currentProcess == null && readyQueue.isNotEmpty) {
        currentProcess = readyQueue.removeAt(0);
        currentProcess.state = ProcessState.running;
        processStartTime = currentTime;
        
        if (currentProcess.responseTime == -1) {
          currentProcess.responseTime = currentTime - currentProcess.arrivalTime;
        }
        
        events.add(SchedulingEvent(
          timestamp: currentTime,
          runningPid: currentProcess.pid,
          readyQueue: readyQueue.map((p) => p.pid).toList(),
          description: '进程P${currentProcess.pid}开始执行',
          type: EventType.start,
        ));
        
        if (ganttChart.isNotEmpty) {
          contextSwitches++;
        }
      }
      
      // 执行当前进程
      if (currentProcess != null) {
        currentProcess.remainingTime--;
        
        if (currentProcess.remainingTime == 0) {
          currentProcess.state = ProcessState.terminated;
          currentProcess.completionTime = currentTime + 1;
          currentProcess.turnaroundTime = 
              currentProcess.completionTime - currentProcess.arrivalTime;
          currentProcess.waitingTime = 
              currentProcess.turnaroundTime - currentProcess.burstTime;
          
          ganttChart.add(GanttItem(
            pid: currentProcess.pid,
            startTime: processStartTime!,
            endTime: currentTime + 1,
          ));
          
          events.add(SchedulingEvent(
            timestamp: currentTime + 1,
            readyQueue: readyQueue.map((p) => p.pid).toList(),
            description: '进程P${currentProcess.pid}完成执行',
            type: EventType.complete,
          ));
          
          currentProcess = null;
          processStartTime = null;
        }
      }
      
      currentTime++;
      if (currentTime > 1000) break;
    }
    
    return _calculateResult(
      algorithm: SchedulingAlgorithm.sjf,
      processes: processes,
      ganttChart: ganttChart,
      events: events,
      contextSwitches: contextSwitches,
      totalTime: currentTime,
    );
  }
  
  /// 优先级调度 (Priority)
  SchedulingResult _executePriority(List<Process> processes, bool isPreemptive) {
    final ganttChart = <GanttItem>[];
    final events = <SchedulingEvent>[];
    final readyQueue = <Process>[];
    int currentTime = 0;
    int contextSwitches = 0;
    Process? currentProcess;
    int? processStartTime;
    
    events.add(SchedulingEvent(
      timestamp: 0,
      description: '调度开始 - Priority算法${isPreemptive ? "(抢占式)" : "(非抢占式)"}',
      type: EventType.normal,
    ));
    
    while (processes.any((p) => p.state != ProcessState.terminated) ||
           readyQueue.isNotEmpty ||
           currentProcess != null) {
      
      // 检查新到达的进程
      for (var process in processes) {
        if (process.arrivalTime == currentTime && 
            process.state == ProcessState.ready &&
            !readyQueue.contains(process) &&
            process != currentProcess) {
          readyQueue.add(process);
          // 按优先级排序（数字越小优先级越高）
          readyQueue.sort((a, b) => a.priority.compareTo(b.priority));
          
          events.add(SchedulingEvent(
            timestamp: currentTime,
            description: '进程P${process.pid}到达（优先级:${process.priority}）',
            readyQueue: readyQueue.map((p) => p.pid).toList(),
            type: EventType.arrival,
          ));
        }
      }
      
      // 抢占式优先级：检查是否需要抢占
      if (isPreemptive && currentProcess != null && readyQueue.isNotEmpty) {
        final highestPriority = readyQueue.first;
        if (highestPriority.priority < currentProcess.priority) {
          // 保存当前进程到甘特图
          ganttChart.add(GanttItem(
            pid: currentProcess.pid,
            startTime: processStartTime!,
            endTime: currentTime,
          ));
          
          // 抢占
          currentProcess.state = ProcessState.ready;
          readyQueue.add(currentProcess);
          readyQueue.sort((a, b) => a.priority.compareTo(b.priority));
          
          currentProcess = readyQueue.removeAt(0);
          currentProcess.state = ProcessState.running;
          processStartTime = currentTime;
          contextSwitches++;
          
          events.add(SchedulingEvent(
            timestamp: currentTime,
            runningPid: currentProcess.pid,
            readyQueue: readyQueue.map((p) => p.pid).toList(),
            description: '进程P${currentProcess.pid}抢占CPU（优先级:${currentProcess.priority}）',
            type: EventType.preempt,
          ));
        }
      }
      
      // 选择下一个进程
      if (currentProcess == null && readyQueue.isNotEmpty) {
        currentProcess = readyQueue.removeAt(0);
        currentProcess.state = ProcessState.running;
        processStartTime = currentTime;
        
        if (currentProcess.responseTime == -1) {
          currentProcess.responseTime = currentTime - currentProcess.arrivalTime;
        }
        
        events.add(SchedulingEvent(
          timestamp: currentTime,
          runningPid: currentProcess.pid,
          readyQueue: readyQueue.map((p) => p.pid).toList(),
          description: '进程P${currentProcess.pid}开始执行',
          type: EventType.start,
        ));
        
        if (ganttChart.isNotEmpty) {
          contextSwitches++;
        }
      }
      
      // 执行当前进程
      if (currentProcess != null) {
        currentProcess.remainingTime--;
        
        if (currentProcess.remainingTime == 0) {
          currentProcess.state = ProcessState.terminated;
          currentProcess.completionTime = currentTime + 1;
          currentProcess.turnaroundTime = 
              currentProcess.completionTime - currentProcess.arrivalTime;
          currentProcess.waitingTime = 
              currentProcess.turnaroundTime - currentProcess.burstTime;
          
          ganttChart.add(GanttItem(
            pid: currentProcess.pid,
            startTime: processStartTime!,
            endTime: currentTime + 1,
          ));
          
          events.add(SchedulingEvent(
            timestamp: currentTime + 1,
            readyQueue: readyQueue.map((p) => p.pid).toList(),
            description: '进程P${currentProcess.pid}完成执行',
            type: EventType.complete,
          ));
          
          currentProcess = null;
          processStartTime = null;
        }
      }
      
      currentTime++;
      if (currentTime > 1000) break;
    }
    
    return _calculateResult(
      algorithm: SchedulingAlgorithm.priority,
      processes: processes,
      ganttChart: ganttChart,
      events: events,
      contextSwitches: contextSwitches,
      totalTime: currentTime,
    );
  }
  
  /// 时间片轮转 (RR)
  SchedulingResult _executeRR(List<Process> processes, int timeQuantum) {
    final ganttChart = <GanttItem>[];
    final events = <SchedulingEvent>[];
    final readyQueue = Queue<Process>();
    int currentTime = 0;
    int contextSwitches = 0;
    Process? currentProcess;
    int currentQuantum = 0;
    int? processStartTime;
    
    events.add(SchedulingEvent(
      timestamp: 0,
      description: '调度开始 - RR算法（时间片:$timeQuantum）',
      type: EventType.normal,
    ));
    
    // 按到达时间排序
    processes.sort((a, b) => a.arrivalTime.compareTo(b.arrivalTime));
    
    while (processes.any((p) => p.state != ProcessState.terminated) ||
           readyQueue.isNotEmpty ||
           currentProcess != null) {
      
      // 检查新到达的进程
      for (var process in processes) {
        if (process.arrivalTime == currentTime && 
            process.state == ProcessState.ready &&
            !readyQueue.contains(process) &&
            process != currentProcess) {
          readyQueue.add(process);
          
          events.add(SchedulingEvent(
            timestamp: currentTime,
            description: '进程P${process.pid}到达并加入就绪队列',
            readyQueue: readyQueue.map((p) => p.pid).toList(),
            type: EventType.arrival,
          ));
        }
      }
      
      // 检查时间片是否用完
      if (currentProcess != null && currentQuantum >= timeQuantum) {
        if (currentProcess.remainingTime > 0) {
          // 进程未完成，重新加入就绪队列
          currentProcess.state = ProcessState.ready;
          readyQueue.add(currentProcess);
          
          // 保存到甘特图
          ganttChart.add(GanttItem(
            pid: currentProcess.pid,
            startTime: processStartTime!,
            endTime: currentTime,
          ));
          
          events.add(SchedulingEvent(
            timestamp: currentTime,
            readyQueue: readyQueue.map((p) => p.pid).toList(),
            description: '进程P${currentProcess.pid}时间片用完，重新加入就绪队列',
            type: EventType.contextSwitch,
          ));
          
          currentProcess = null;
          currentQuantum = 0;
          processStartTime = null;
        }
      }
      
      // 选择下一个进程
      if (currentProcess == null && readyQueue.isNotEmpty) {
        currentProcess = readyQueue.removeFirst();
        currentProcess.state = ProcessState.running;
        currentQuantum = 0;
        processStartTime = currentTime;
        
        if (currentProcess.responseTime == -1) {
          currentProcess.responseTime = currentTime - currentProcess.arrivalTime;
        }
        
        events.add(SchedulingEvent(
          timestamp: currentTime,
          runningPid: currentProcess.pid,
          readyQueue: readyQueue.map((p) => p.pid).toList(),
          description: '进程P${currentProcess.pid}获得CPU',
          type: EventType.start,
        ));
        
        if (ganttChart.isNotEmpty) {
          contextSwitches++;
        }
      }
      
      // 执行当前进程
      if (currentProcess != null) {
        currentProcess.remainingTime--;
        currentQuantum++;
        
        if (currentProcess.remainingTime == 0) {
          currentProcess.state = ProcessState.terminated;
          currentProcess.completionTime = currentTime + 1;
          currentProcess.turnaroundTime = 
              currentProcess.completionTime - currentProcess.arrivalTime;
          currentProcess.waitingTime = 
              currentProcess.turnaroundTime - currentProcess.burstTime;
          
          ganttChart.add(GanttItem(
            pid: currentProcess.pid,
            startTime: processStartTime!,
            endTime: currentTime + 1,
          ));
          
          events.add(SchedulingEvent(
            timestamp: currentTime + 1,
            readyQueue: readyQueue.map((p) => p.pid).toList(),
            description: '进程P${currentProcess.pid}完成执行',
            type: EventType.complete,
          ));
          
          currentProcess = null;
          currentQuantum = 0;
          processStartTime = null;
        }
      }
      
      currentTime++;
      if (currentTime > 1000) break;
    }
    
    return _calculateResult(
      algorithm: SchedulingAlgorithm.rr,
      processes: processes,
      ganttChart: ganttChart,
      events: events,
      contextSwitches: contextSwitches,
      totalTime: currentTime,
    );
  }
  
  /// 多级反馈队列 (MLFQ)
  SchedulingResult _executeMLFQ(List<Process> processes, MLFQConfig config) {
    final ganttChart = <GanttItem>[];
    final events = <SchedulingEvent>[];
    int currentTime = 0;
    int contextSwitches = 0;
    Process? currentProcess;
    int currentQuantum = 0;
    int? processStartTime;
    int boostTimer = 0;
    
    // 多级队列
    final queues = List.generate(config.queueCount, (_) => <Process>[]);
    
    // 按到达时间排序
    processes.sort((a, b) => a.arrivalTime.compareTo(b.arrivalTime));
    
    events.add(SchedulingEvent(
      timestamp: 0,
      description: '调度开始 - MLFQ算法（${config.queueCount}级队列）',
      type: EventType.normal,
    ));
    
    while (processes.any((p) => p.state != ProcessState.terminated) ||
           queues.any((q) => q.isNotEmpty) ||
           currentProcess != null) {
      
      boostTimer++;
      
      // 周期性提升所有进程到最高优先级队列
      if (boostTimer >= config.boostInterval && queues.any((q) => q.isNotEmpty)) {
        _boostAllProcesses(queues, events, currentTime);
        boostTimer = 0;
      }
      
      // 检查新到达的进程
      for (var process in processes) {
        if (process.arrivalTime == currentTime && 
            process.state == ProcessState.ready &&
            !queues.any((q) => q.contains(process)) &&
            process != currentProcess) {
          process.currentQueueLevel = 0;
          process.timeInCurrentQueue = 0;
          queues[0].add(process);
          
          events.add(SchedulingEvent(
            timestamp: currentTime,
            description: '进程P${process.pid}到达，加入队列0',
            readyQueue: _getAllReadyProcesses(queues),
            type: EventType.arrival,
          ));
        }
      }
      
      // 检查当前进程是否用完时间片或需要降级
      if (currentProcess != null) {
        final timeQuantum = config.getTimeQuantum(currentProcess.currentQueueLevel);
        
        if (currentQuantum >= timeQuantum && currentProcess.remainingTime > 0) {
          // 时间片用完，降级到下一队列
          ganttChart.add(GanttItem(
            pid: currentProcess.pid,
            startTime: processStartTime!,
            endTime: currentTime,
          ));
          
          // 降级
          if (currentProcess.currentQueueLevel < config.queueCount - 1) {
            currentProcess.currentQueueLevel++;
          }
          currentProcess.timeInCurrentQueue = 0;
          currentProcess.state = ProcessState.ready;
          queues[currentProcess.currentQueueLevel].add(currentProcess);
          
          events.add(SchedulingEvent(
            timestamp: currentTime,
            readyQueue: _getAllReadyProcesses(queues),
            description: '进程P${currentProcess.pid}时间片用完，降级到队列${currentProcess.currentQueueLevel}',
            type: EventType.contextSwitch,
          ));
          
          currentProcess = null;
          currentQuantum = 0;
          processStartTime = null;
          contextSwitches++;
        }
      }
      
      // 选择下一个进程（从最高优先级队列开始）
      if (currentProcess == null) {
        for (int level = 0; level < config.queueCount; level++) {
          if (queues[level].isNotEmpty) {
            currentProcess = queues[level].removeAt(0);
            currentProcess.state = ProcessState.running;
            currentQuantum = 0;
            processStartTime = currentTime;
            
            if (currentProcess.responseTime == -1) {
              currentProcess.responseTime = currentTime - currentProcess.arrivalTime;
            }
            
            events.add(SchedulingEvent(
              timestamp: currentTime,
              runningPid: currentProcess.pid,
              readyQueue: _getAllReadyProcesses(queues),
              description: '进程P${currentProcess.pid}从队列$level获得CPU',
              type: EventType.start,
            ));
            
            if (ganttChart.isNotEmpty) {
              contextSwitches++;
            }
            break;
          }
        }
      }
      
      // 执行当前进程
      if (currentProcess != null) {
        currentProcess.remainingTime--;
        currentQuantum++;
        currentProcess.timeInCurrentQueue++;
        
        // 老化处理：在队列中等待太久的进程提升优先级
        for (int level = 1; level < config.queueCount; level++) {
          for (var process in queues[level]) {
            if (process.timeInCurrentQueue >= config.aging) {
              queues[level].remove(process);
              process.currentQueueLevel = math.max(0, process.currentQueueLevel - 1);
              process.timeInCurrentQueue = 0;
              queues[process.currentQueueLevel].add(process);
              
              events.add(SchedulingEvent(
                timestamp: currentTime,
                description: '进程P${process.pid}老化提升到队列${process.currentQueueLevel}',
                type: EventType.contextSwitch,
              ));
            }
          }
        }
        
        if (currentProcess.remainingTime == 0) {
          currentProcess.state = ProcessState.terminated;
          currentProcess.completionTime = currentTime + 1;
          currentProcess.turnaroundTime = 
              currentProcess.completionTime - currentProcess.arrivalTime;
          currentProcess.waitingTime = 
              currentProcess.turnaroundTime - currentProcess.burstTime;
          
          ganttChart.add(GanttItem(
            pid: currentProcess.pid,
            startTime: processStartTime!,
            endTime: currentTime + 1,
          ));
          
          events.add(SchedulingEvent(
            timestamp: currentTime + 1,
            readyQueue: _getAllReadyProcesses(queues),
            description: '进程P${currentProcess.pid}完成执行',
            type: EventType.complete,
          ));
          
          currentProcess = null;
          currentQuantum = 0;
          processStartTime = null;
        }
      }
      
      currentTime++;
      if (currentTime > 1000) break;
    }
    
    return _calculateResult(
      algorithm: SchedulingAlgorithm.mlfq,
      processes: processes,
      ganttChart: ganttChart,
      events: events,
      contextSwitches: contextSwitches,
      totalTime: currentTime,
    );
  }
  
  /// 提升所有进程到最高优先级队列
  void _boostAllProcesses(List<List<Process>> queues, List<SchedulingEvent> events, int currentTime) {
    int boostedCount = 0;
    
    for (int level = 1; level < queues.length; level++) {
      final processesToBoost = List<Process>.from(queues[level]);
      queues[level].clear();
      
      for (var process in processesToBoost) {
        process.currentQueueLevel = 0;
        process.timeInCurrentQueue = 0;
        queues[0].add(process);
        boostedCount++;
      }
    }
    
    if (boostedCount > 0) {
      events.add(SchedulingEvent(
        timestamp: currentTime,
        description: '优先级提升：$boostedCount 个进程提升到队列0',
        type: EventType.contextSwitch,
      ));
    }
  }
  
  /// 获取所有就绪进程的PID列表
  List<int> _getAllReadyProcesses(List<List<Process>> queues) {
    List<int> readyPids = [];
    for (var queue in queues) {
      readyPids.addAll(queue.map((p) => p.pid));
    }
    return readyPids;
  }
  
  /// 计算调度结果的统计信息
  SchedulingResult _calculateResult({
    required SchedulingAlgorithm algorithm,
    required List<Process> processes,
    required List<GanttItem> ganttChart,
    required List<SchedulingEvent> events,
    required int contextSwitches,
    required int totalTime,
  }) {
    // 计算平均等待时间
    double totalWaitingTime = 0;
    double totalTurnaroundTime = 0;
    double totalWeightedTurnaroundTime = 0;
    double totalResponseTime = 0;
    int validProcessCount = 0;
    
    for (var process in processes) {
      if (process.state == ProcessState.terminated) {
        totalWaitingTime += process.waitingTime;
        totalTurnaroundTime += process.turnaroundTime;
        totalWeightedTurnaroundTime += process.weightedTurnaroundTime;
        if (process.responseTime >= 0) {
          totalResponseTime += process.responseTime;
        }
        validProcessCount++;
      }
    }
    
    final averageWaitingTime = 
        validProcessCount > 0 ? (totalWaitingTime / validProcessCount).toDouble() : 0.0;
    final averageTurnaroundTime = 
        validProcessCount > 0 ? (totalTurnaroundTime / validProcessCount).toDouble() : 0.0;
    final averageWeightedTurnaroundTime = 
        validProcessCount > 0 ? (totalWeightedTurnaroundTime / validProcessCount).toDouble() : 0.0;
    final averageResponseTime = 
        validProcessCount > 0 ? (totalResponseTime / validProcessCount).toDouble() : 0.0;
    
    // 计算CPU利用率
    int busyTime = 0;
    for (var item in ganttChart) {
      busyTime += item.duration;
    }
    final cpuUtilization = totalTime > 0 ? (busyTime / totalTime).toDouble() : 0.0;
    
    // 计算吞吐量
    final throughput = totalTime > 0 ? (validProcessCount / totalTime).toDouble() : 0.0;
    
    return SchedulingResult(
      algorithm: algorithm,
      processes: processes,
      ganttChart: ganttChart,
      events: events,
      averageWaitingTime: averageWaitingTime,
      averageTurnaroundTime: averageTurnaroundTime,
      averageWeightedTurnaroundTime: averageWeightedTurnaroundTime,
      averageResponseTime: averageResponseTime,
      cpuUtilization: cpuUtilization,
      throughput: throughput,
      contextSwitches: contextSwitches,
      totalTime: totalTime,
    );
  }
  
  /// 生成示例进程列表
  List<Process> generateSampleProcesses({int count = 5}) {
    final random = math.Random();
    final processes = <Process>[];
    
    for (int i = 1; i <= count; i++) {
      processes.add(Process(
        pid: i,
        arrivalTime: random.nextInt(10),
        burstTime: random.nextInt(8) + 2,
        priority: random.nextInt(5),
      ));
    }
    
    return processes;
  }
}
