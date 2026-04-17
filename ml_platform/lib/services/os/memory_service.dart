// 内存管理算法服务
import 'dart:math' as math;
import 'package:ml_platform/models/os/memory_model.dart';

/// 内存管理服务
class MemoryService {
  static final MemoryService _instance = MemoryService._internal();
  factory MemoryService() => _instance;
  MemoryService._internal();
  
  // ============= 动态分区分配算法 =============
  
  /// 执行内存分配
  AllocationResult allocateMemory({
    required List<MemoryPartition> memory,
    required MemoryRequest request,
    required MemoryAllocationAlgorithm algorithm,
  }) {
    // 克隆内存状态
    final memoryState = memory.map((p) => p.clone()).toList();
    
    switch (algorithm) {
      case MemoryAllocationAlgorithm.firstFit:
        return _firstFit(memoryState, request);
      case MemoryAllocationAlgorithm.bestFit:
        return _bestFit(memoryState, request);
      case MemoryAllocationAlgorithm.worstFit:
        return _worstFit(memoryState, request);
    }
  }
  
  /// 首次适应算法
  AllocationResult _firstFit(List<MemoryPartition> memory, MemoryRequest request) {
    // 从头开始查找第一个能满足需求的空闲分区
    for (var partition in memory) {
      if (partition.isFree && partition.size >= request.size) {
        // 找到合适的分区，进行分配
        return _performAllocation(memory, partition, request);
      }
    }
    
    // 没有找到合适的分区
    return AllocationResult(
      success: false,
      message: '没有足够大的空闲分区（首次适应）',
      memoryState: memory,
      externalFragmentation: _calculateExternalFragmentation(memory),
    );
  }
  
  /// 最佳适应算法
  AllocationResult _bestFit(List<MemoryPartition> memory, MemoryRequest request) {
    MemoryPartition? bestPartition;
    int minWaste = 999999;
    
    // 查找最小的能满足需求的空闲分区
    for (var partition in memory) {
      if (partition.isFree && partition.size >= request.size) {
        int waste = partition.size - request.size;
        if (waste < minWaste) {
          minWaste = waste;
          bestPartition = partition;
        }
      }
    }
    
    if (bestPartition != null) {
      return _performAllocation(memory, bestPartition, request);
    }
    
    return AllocationResult(
      success: false,
      message: '没有足够大的空闲分区（最佳适应）',
      memoryState: memory,
      externalFragmentation: _calculateExternalFragmentation(memory),
    );
  }
  
  /// 最坏适应算法
  AllocationResult _worstFit(List<MemoryPartition> memory, MemoryRequest request) {
    MemoryPartition? worstPartition;
    int maxSize = 0;
    
    // 查找最大的空闲分区
    for (var partition in memory) {
      if (partition.isFree && partition.size >= request.size) {
        if (partition.size > maxSize) {
          maxSize = partition.size;
          worstPartition = partition;
        }
      }
    }
    
    if (worstPartition != null) {
      return _performAllocation(memory, worstPartition, request);
    }
    
    return AllocationResult(
      success: false,
      message: '没有足够大的空闲分区（最坏适应）',
      memoryState: memory,
      externalFragmentation: _calculateExternalFragmentation(memory),
    );
  }
  
  /// 执行实际的内存分配
  AllocationResult _performAllocation(
    List<MemoryPartition> memory,
    MemoryPartition partition,
    MemoryRequest request,
  ) {
    int remainingSize = partition.size - request.size;
    
    if (remainingSize > 32) { // 如果剩余空间大于最小分区大小
      // 分割分区
      partition.size = request.size;
      partition.isFree = false;
      partition.processId = request.processId;
      partition.processName = request.processName;
      
      // 创建新的空闲分区
      final newPartition = MemoryPartition(
        id: _generatePartitionId(memory),
        startAddress: partition.startAddress + request.size,
        size: remainingSize,
        isFree: true,
      );
      
      // 插入新分区
      int index = memory.indexOf(partition);
      memory.insert(index + 1, newPartition);
    } else {
      // 整个分区都分配给进程（内部碎片）
      partition.isFree = false;
      partition.processId = request.processId;
      partition.processName = request.processName;
    }
    
    return AllocationResult(
      success: true,
      allocatedPartitionId: partition.id,
      allocatedAddress: partition.startAddress,
      allocatedSize: partition.size,
      message: '成功分配 ${request.size} KB 给进程 ${request.processName}',
      memoryState: memory,
      externalFragmentation: _calculateExternalFragmentation(memory),
      internalFragmentation: remainingSize <= 32 ? remainingSize : 0,
    );
  }
  
  /// 释放内存
  AllocationResult releaseMemory({
    required List<MemoryPartition> memory,
    required int processId,
  }) {
    final memoryState = memory.map((p) => p.clone()).toList();
    bool found = false;
    
    for (int i = 0; i < memoryState.length; i++) {
      var partition = memoryState[i];
      if (!partition.isFree && partition.processId == processId) {
        partition.isFree = true;
        partition.processId = null;
        partition.processName = null;
        found = true;
        
        // 合并相邻的空闲分区
        _mergeAdjacentFreePartitions(memoryState, i);
        break;
      }
    }
    
    if (!found) {
      return AllocationResult(
        success: false,
        message: '未找到进程 $processId 的内存分配',
        memoryState: memoryState,
      );
    }
    
    return AllocationResult(
      success: true,
      message: '成功释放进程 $processId 的内存',
      memoryState: memoryState,
      externalFragmentation: _calculateExternalFragmentation(memoryState),
    );
  }
  
  /// 合并相邻的空闲分区
  void _mergeAdjacentFreePartitions(List<MemoryPartition> memory, int index) {
    var current = memory[index];
    
    // 向后合并
    while (index + 1 < memory.length && memory[index + 1].isFree) {
      var next = memory[index + 1];
      current.size += next.size;
      memory.removeAt(index + 1);
    }
    
    // 向前合并
    while (index > 0 && memory[index - 1].isFree) {
      var prev = memory[index - 1];
      prev.size += current.size;
      memory.removeAt(index);
      index--;
      current = prev;
    }
  }
  
  /// 生成分区ID
  int _generatePartitionId(List<MemoryPartition> memory) {
    if (memory.isEmpty) return 1;
    return memory.map((p) => p.id).reduce((a, b) => a > b ? a : b) + 1;
  }
  
  /// 计算外部碎片
  int _calculateExternalFragmentation(List<MemoryPartition> memory) {
    int fragmentation = 0;
    for (var partition in memory) {
      if (partition.isFree && partition.size < 32) {
        fragmentation += partition.size;
      }
    }
    return fragmentation;
  }
  
  /// 初始化内存
  List<MemoryPartition> initializeMemory(int totalSize) {
    return [
      MemoryPartition(
        id: 1,
        startAddress: 0,
        size: totalSize,
        isFree: true,
      ),
    ];
  }
  
  // ============= 页面置换算法 =============
  
  /// 执行页面置换算法
  PageReplacementResult executePageReplacement({
    required List<PageRequest> requests,
    required int frameCount,
    required PageReplacementAlgorithm algorithm,
  }) {
    switch (algorithm) {
      case PageReplacementAlgorithm.fifo:
        return _executeFIFO(requests, frameCount);
      case PageReplacementAlgorithm.lru:
        return _executeLRU(requests, frameCount);
      case PageReplacementAlgorithm.opt:
        return _executeOPT(requests, frameCount);
    }
  }
  
  /// FIFO页面置换算法
  PageReplacementResult _executeFIFO(List<PageRequest> requests, int frameCount) {
    final frames = List.generate(frameCount, (i) => PageFrame(frameNumber: i));
    final steps = <PageReplacementStep>[];
    int pageFaults = 0;
    int timestamp = 0;
    int nextFrameToReplace = 0; // FIFO队列指针
    
    for (var request in requests) {
      timestamp++;
      
      // 检查页面是否已在内存中
      bool pageHit = false;
      for (var frame in frames) {
        if (frame.pageNumber == request.pageNumber) {
          pageHit = true;
          break;
        }
      }
      
      if (pageHit) {
        // 页面命中
        steps.add(PageReplacementStep(
          timestamp: timestamp,
          requestedPage: request.pageNumber,
          isPageFault: false,
          frames: frames.map((f) => f.clone()).toList(),
          description: '页面 ${request.pageNumber} 命中',
          pageFaults: pageFaults,
          pageFaultRate: pageFaults / timestamp,
        ));
      } else {
        // 页面缺失
        pageFaults++;
        int? replacedPage;
        
        // 查找空闲页框
        bool foundEmpty = false;
        for (var frame in frames) {
          if (frame.pageNumber == null) {
            frame.pageNumber = request.pageNumber;
            frame.loadTime = timestamp;
            foundEmpty = true;
            break;
          }
        }
        
        if (!foundEmpty) {
          // 需要置换页面（FIFO）
          replacedPage = frames[nextFrameToReplace].pageNumber;
          frames[nextFrameToReplace].pageNumber = request.pageNumber;
          frames[nextFrameToReplace].loadTime = timestamp;
          nextFrameToReplace = (nextFrameToReplace + 1) % frameCount;
        }
        
        steps.add(PageReplacementStep(
          timestamp: timestamp,
          requestedPage: request.pageNumber,
          isPageFault: true,
          replacedPage: replacedPage,
          frames: frames.map((f) => f.clone()).toList(),
          description: replacedPage != null 
              ? '页面 ${request.pageNumber} 缺失，置换页面 $replacedPage'
              : '页面 ${request.pageNumber} 缺失，装入空闲页框',
          pageFaults: pageFaults,
          pageFaultRate: pageFaults / timestamp,
        ));
      }
    }
    
    return PageReplacementResult(
      algorithm: PageReplacementAlgorithm.fifo,
      steps: steps,
      requests: requests,
      totalPageFaults: pageFaults,
      pageFaultRate: pageFaults / requests.length,
      frameCount: frameCount,
    );
  }
  
  /// LRU页面置换算法
  PageReplacementResult _executeLRU(List<PageRequest> requests, int frameCount) {
    final frames = List.generate(frameCount, (i) => PageFrame(frameNumber: i));
    final steps = <PageReplacementStep>[];
    int pageFaults = 0;
    int timestamp = 0;
    
    for (var request in requests) {
      timestamp++;
      
      // 检查页面是否已在内存中
      PageFrame? hitFrame;
      for (var frame in frames) {
        if (frame.pageNumber == request.pageNumber) {
          hitFrame = frame;
          break;
        }
      }
      
      if (hitFrame != null) {
        // 页面命中，更新最近使用时间
        hitFrame.lastUsedTime = timestamp;
        
        steps.add(PageReplacementStep(
          timestamp: timestamp,
          requestedPage: request.pageNumber,
          isPageFault: false,
          frames: frames.map((f) => f.clone()).toList(),
          description: '页面 ${request.pageNumber} 命中',
          pageFaults: pageFaults,
          pageFaultRate: pageFaults / timestamp,
        ));
      } else {
        // 页面缺失
        pageFaults++;
        int? replacedPage;
        
        // 查找空闲页框
        PageFrame? emptyFrame;
        for (var frame in frames) {
          if (frame.pageNumber == null) {
            emptyFrame = frame;
            break;
          }
        }
        
        if (emptyFrame != null) {
          // 使用空闲页框
          emptyFrame.pageNumber = request.pageNumber;
          emptyFrame.lastUsedTime = timestamp;
          emptyFrame.loadTime = timestamp;
        } else {
          // 需要置换页面（LRU）
          // 找到最近最少使用的页面
          PageFrame lruFrame = frames[0];
          for (var frame in frames) {
            if (frame.lastUsedTime < lruFrame.lastUsedTime) {
              lruFrame = frame;
            }
          }
          
          replacedPage = lruFrame.pageNumber;
          lruFrame.pageNumber = request.pageNumber;
          lruFrame.lastUsedTime = timestamp;
          lruFrame.loadTime = timestamp;
        }
        
        steps.add(PageReplacementStep(
          timestamp: timestamp,
          requestedPage: request.pageNumber,
          isPageFault: true,
          replacedPage: replacedPage,
          frames: frames.map((f) => f.clone()).toList(),
          description: replacedPage != null 
              ? '页面 ${request.pageNumber} 缺失，置换页面 $replacedPage（LRU）'
              : '页面 ${request.pageNumber} 缺失，装入空闲页框',
          pageFaults: pageFaults,
          pageFaultRate: pageFaults / timestamp,
        ));
      }
    }
    
    return PageReplacementResult(
      algorithm: PageReplacementAlgorithm.lru,
      steps: steps,
      requests: requests,
      totalPageFaults: pageFaults,
      pageFaultRate: pageFaults / requests.length,
      frameCount: frameCount,
    );
  }
  
  /// OPT最优页面置换算法
  PageReplacementResult _executeOPT(List<PageRequest> requests, int frameCount) {
    final frames = List.generate(frameCount, (i) => PageFrame(frameNumber: i));
    final steps = <PageReplacementStep>[];
    int pageFaults = 0;
    
    for (int i = 0; i < requests.length; i++) {
      var request = requests[i];
      
      // 检查页面是否已在内存中
      bool pageHit = false;
      for (var frame in frames) {
        if (frame.pageNumber == request.pageNumber) {
          pageHit = true;
          frame.lastUsedTime = i;
          break;
        }
      }
      
      if (pageHit) {
        // 页面命中
        steps.add(PageReplacementStep(
          timestamp: i + 1,
          requestedPage: request.pageNumber,
          isPageFault: false,
          frames: frames.map((f) => f.clone()).toList(),
          description: '页面 ${request.pageNumber} 命中',
          pageFaults: pageFaults,
          pageFaultRate: pageFaults / (i + 1),
        ));
      } else {
        // 页面缺失
        pageFaults++;
        int? replacedPage;
        
        // 查找空闲页框
        PageFrame? emptyFrame;
        for (var frame in frames) {
          if (frame.pageNumber == null) {
            emptyFrame = frame;
            break;
          }
        }
        
        if (emptyFrame != null) {
          // 使用空闲页框
          emptyFrame.pageNumber = request.pageNumber;
          emptyFrame.lastUsedTime = i;
          emptyFrame.loadTime = i;
        } else {
          // 需要置换页面（OPT）
          // 找到将来最长时间不会被使用的页面
          PageFrame? optFrame;
          int maxFutureDistance = -1;
          
          for (var frame in frames) {
            // 查找该页面下次使用的位置
            int nextUse = _findNextUse(requests, i + 1, frame.pageNumber!);
            
            if (nextUse == -1) {
              // 该页面将来不会被使用，优先置换
              optFrame = frame;
              break;
            } else if (nextUse > maxFutureDistance) {
              maxFutureDistance = nextUse;
              optFrame = frame;
            }
          }
          
          if (optFrame != null) {
            replacedPage = optFrame.pageNumber;
            optFrame.pageNumber = request.pageNumber;
            optFrame.lastUsedTime = i;
            optFrame.loadTime = i;
          }
        }
        
        steps.add(PageReplacementStep(
          timestamp: i + 1,
          requestedPage: request.pageNumber,
          isPageFault: true,
          replacedPage: replacedPage,
          frames: frames.map((f) => f.clone()).toList(),
          description: replacedPage != null 
              ? '页面 ${request.pageNumber} 缺失，置换页面 $replacedPage（OPT）'
              : '页面 ${request.pageNumber} 缺失，装入空闲页框',
          pageFaults: pageFaults,
          pageFaultRate: pageFaults / (i + 1),
        ));
      }
    }
    
    return PageReplacementResult(
      algorithm: PageReplacementAlgorithm.opt,
      steps: steps,
      requests: requests,
      totalPageFaults: pageFaults,
      pageFaultRate: pageFaults / requests.length,
      frameCount: frameCount,
    );
  }
  
  /// 查找页面下次使用的位置
  int _findNextUse(List<PageRequest> requests, int startIndex, int pageNumber) {
    for (int i = startIndex; i < requests.length; i++) {
      if (requests[i].pageNumber == pageNumber) {
        return i;
      }
    }
    return -1; // 将来不会被使用
  }
  
  /// 生成示例页面请求序列
  List<PageRequest> generatePageRequestSequence({int length = 20, int pageRange = 10}) {
    final random = math.Random();
    final requests = <PageRequest>[];
    
    // 生成局部性较好的页面访问序列
    for (int i = 0; i < length; i++) {
      if (i > 0 && random.nextDouble() < 0.3) {
        // 30%概率重复访问最近的页面（时间局部性）
        requests.add(PageRequest(
          pageNumber: requests[i - 1].pageNumber,
        ));
      } else if (i > 0 && random.nextDouble() < 0.5) {
        // 50%概率访问相邻页面（空间局部性）
        int prevPage = requests[i - 1].pageNumber;
        int newPage = prevPage + (random.nextBool() ? 1 : -1);
        newPage = newPage.clamp(0, pageRange - 1);
        requests.add(PageRequest(pageNumber: newPage));
      } else {
        // 其他情况随机访问
        requests.add(PageRequest(
          pageNumber: random.nextInt(pageRange),
        ));
      }
    }
    
    return requests;
  }
  
  /// 生成示例内存分配请求
  List<MemoryRequest> generateMemoryRequests({int count = 5}) {
    final random = math.Random();
    final requests = <MemoryRequest>[];
    final sizes = [64, 128, 256, 512, 96, 192, 384];
    final names = ['进程A', '进程B', '进程C', '进程D', '进程E', '进程F', '进程G'];
    
    for (int i = 0; i < count; i++) {
      requests.add(MemoryRequest(
        processId: i + 1,
        processName: names[i % names.length],
        size: sizes[random.nextInt(sizes.length)],
        timestamp: i,
      ));
    }
    
    return requests;
  }
}
