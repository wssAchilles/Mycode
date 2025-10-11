# 🖥️ 操作系统模拟器 API

操作系统模拟器提供了进程调度、内存管理和死锁检测的完整 API。

## 📋 模块概述

- **进程管理** - PCB、进程状态、进程调度
- **内存管理** - 分页、分段、内存分配
- **文件系统** - 文件操作、目录管理
- **死锁处理** - 检测、预防、避免

## 🔄 进程调度 API

### Process

进程控制块 (PCB)。

```dart
class Process {
  final int pid;                    // 进程ID
  final String name;                // 进程名
  final int arrivalTime;            // 到达时间
  final int burstTime;              // 执行时间
  final int priority;               // 优先级
  ProcessState state;               // 进程状态
  int remainingTime;                // 剩余时间
  
  Process({
    required this.pid,
    required this.name,
    required this.arrivalTime,
    required this.burstTime,
    this.priority = 0,
    this.state = ProcessState.ready,
  }) : remainingTime = burstTime;
}
```

### ProcessState

进程状态枚举。

```dart
enum ProcessState {
  ready,      // 就绪
  running,    // 运行
  waiting,    // 等待
  terminated, // 终止
}
```

### Scheduler

进程调度器。

```dart
class Scheduler {
  /// 添加进程
  void addProcess(Process process);
  
  /// 移除进程
  void removeProcess(int pid);
  
  /// 开始调度
  Future<void> start();
  
  /// 暂停调度
  void pause();
  
  /// 恢复调度
  void resume();
  
  /// 停止调度
  void stop();
  
  /// 获取调度结果
  SchedulingResult getResult();
}
```

**示例 - FCFS 调度**:

```dart
final scheduler = FCFSScheduler();

scheduler.addProcess(Process(
  pid: 1,
  name: 'P1',
  arrivalTime: 0,
  burstTime: 5,
));

scheduler.addProcess(Process(
  pid: 2,
  name: 'P2',
  arrivalTime: 1,
  burstTime: 3,
));

await scheduler.start();
final result = scheduler.getResult();

print('Average waiting time: ${result.avgWaitingTime}');
print('Average turnaround time: ${result.avgTurnaroundTime}');
```

## 💾 内存管理 API

### MemoryManager

内存管理器基类。

```dart
abstract class MemoryManager {
  /// 总内存大小
  int get totalMemory;
  
  /// 已用内存
  int get usedMemory;
  
  /// 空闲内存
  int get freeMemory;
  
  /// 分配内存
  Future<MemoryBlock?> allocate({
    required int size,
    required int processId,
  });
  
  /// 释放内存
  Future<void> deallocate(int processId);
  
  /// 获取内存布局
  List<MemoryBlock> getLayout();
}
```

### PagingMemoryManager

分页内存管理。

```dart
class PagingMemoryManager extends MemoryManager {
  final int pageSize;
  final int numFrames;
  
  PagingMemoryManager({
    required int totalMemory,
    required this.pageSize,
  }) : numFrames = totalMemory ~/ pageSize;
  
  /// 获取页表
  Map<int, PageTableEntry> getPageTable(int processId);
  
  /// 地址转换
  PhysicalAddress translate(VirtualAddress va);
}
```

**示例 - 分页管理**:

```dart
final mm = PagingMemoryManager(
  totalMemory: 1024,  // 1KB
  pageSize: 256,       // 256B per page
);

// 分配内存
final block = await mm.allocate(
  size: 512,  // 2 pages
  processId: 1,
);

// 地址转换
final va = VirtualAddress(page: 0, offset: 100);
final pa = mm.translate(va);
print('Physical address: ${pa.frame}:${pa.offset}');
```

### SegmentationMemoryManager

分段内存管理。

```dart
class SegmentationMemoryManager extends MemoryManager {
  /// 创建段
  Future<Segment> createSegment({
    required int processId,
    required SegmentType type,
    required int size,
  });
  
  /// 获取段表
  List<Segment> getSegmentTable(int processId);
}
```

## 📁 文件系统 API

### FileSystem

文件系统接口。

```dart
class FileSystem {
  /// 创建文件
  Future<File> createFile({
    required String path,
    required String content,
  });
  
  /// 读取文件
  Future<String> readFile(String path);
  
  /// 写入文件
  Future<void> writeFile({
    required String path,
    required String content,
  });
  
  /// 删除文件
  Future<void> deleteFile(String path);
  
  /// 创建目录
  Future<Directory> createDirectory(String path);
  
  /// 列出目录内容
  Future<List<FileSystemEntity>> listDirectory(String path);
  
  /// 获取文件信息
  Future<FileStat> stat(String path);
}
```

**示例 - 文件操作**:

```dart
final fs = FileSystem();

// 创建文件
await fs.createFile(
  path: '/home/user/test.txt',
  content: 'Hello, World!',
);

// 读取文件
final content = await fs.readFile('/home/user/test.txt');
print(content);

// 列出目录
final entries = await fs.listDirectory('/home/user');
for (final entry in entries) {
  print('${entry.name} (${entry.type})');
}
```

## 🔒 死锁处理 API

### DeadlockDetector

死锁检测器。

```dart
class DeadlockDetector {
  /// 添加资源
  void addResource(Resource resource);
  
  /// 添加进程
  void addProcess(Process process);
  
  /// 请求资源
  Future<bool> requestResource({
    required int processId,
    required int resourceId,
  });
  
  /// 释放资源
  Future<void> releaseResource({
    required int processId,
    required int resourceId,
  });
  
  /// 检测死锁
  Future<DeadlockInfo?> detectDeadlock();
  
  /// 解决死锁
  Future<void> resolveDeadlock(DeadlockInfo info);
}
```

**示例 - 死锁检测**:

```dart
final detector = DeadlockDetector();

// 添加资源
detector.addResource(Resource(id: 1, name: 'Printer'));
detector.addResource(Resource(id: 2, name: 'Scanner'));

// 添加进程
detector.addProcess(Process(pid: 1, name: 'P1'));
detector.addProcess(Process(pid: 2, name: 'P2'));

// 请求资源
await detector.requestResource(processId: 1, resourceId: 1);
await detector.requestResource(processId: 2, resourceId: 2);
await detector.requestResource(processId: 1, resourceId: 2);
await detector.requestResource(processId: 2, resourceId: 1);

// 检测死锁
final deadlock = await detector.detectDeadlock();
if (deadlock != null) {
  print('Deadlock detected!');
  print('Processes: ${deadlock.processes}');
  print('Resources: ${deadlock.resources}');
  
  // 解决死锁
  await detector.resolveDeadlock(deadlock);
}
```

### BankersAlgorithm

银行家算法(死锁避免)。

```dart
class BankersAlgorithm {
  /// 请求资源
  Future<bool> requestResources({
    required int processId,
    required List<int> request,
  });
  
  /// 检查安全状态
  bool isSafeState();
  
  /// 获取安全序列
  List<int>? getSafeSequence();
}
```

## 📊 数据模型

### SchedulingResult

调度结果。

```dart
class SchedulingResult {
  final List<Process> processes;
  final List<GanttChartEntry> ganttChart;
  final double avgWaitingTime;
  final double avgTurnaroundTime;
  final double cpuUtilization;
  
  SchedulingResult({
    required this.processes,
    required this.ganttChart,
    required this.avgWaitingTime,
    required this.avgTurnaroundTime,
    required this.cpuUtilization,
  });
}
```

### MemoryBlock

内存块。

```dart
class MemoryBlock {
  final int startAddress;
  final int size;
  final int? processId;
  final bool isFree;
  
  MemoryBlock({
    required this.startAddress,
    required this.size,
    this.processId,
    this.isFree = true,
  });
}
```

## 🎯 调度算法

### FCFS - 先来先服务

```dart
class FCFSScheduler extends Scheduler {
  // 按到达时间排序,先到先服务
}
```

### SJF - 最短作业优先

```dart
class SJFScheduler extends Scheduler {
  final bool preemptive;
  
  SJFScheduler({this.preemptive = false});
}
```

### Priority - 优先级调度

```dart
class PriorityScheduler extends Scheduler {
  final bool preemptive;
  
  PriorityScheduler({this.preemptive = false});
}
```

### RoundRobin - 时间片轮转

```dart
class RoundRobinScheduler extends Scheduler {
  final int timeQuantum;
  
  RoundRobinScheduler({this.timeQuantum = 2});
}
```

## 📚 相关文档

- [API 概述](./index.md)
- [算法 API](./algorithms.md)
- [ML 服务 API](./ml-service.md)

---

*文档持续更新中*
