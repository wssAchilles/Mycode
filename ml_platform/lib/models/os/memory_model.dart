// 内存管理模型
import 'package:flutter/material.dart';

/// 内存分区
class MemoryPartition {
  final int id;
  final int startAddress;
  int size;
  bool isFree;
  int? processId;
  String? processName;
  
  MemoryPartition({
    required this.id,
    required this.startAddress,
    required this.size,
    this.isFree = true,
    this.processId,
    this.processName,
  });
  
  int get endAddress => startAddress + size - 1;
  
  MemoryPartition clone() {
    return MemoryPartition(
      id: id,
      startAddress: startAddress,
      size: size,
      isFree: isFree,
      processId: processId,
      processName: processName,
    );
  }
}

/// 内存分配请求
class MemoryRequest {
  final int processId;
  final String processName;
  final int size;
  final int timestamp;
  
  MemoryRequest({
    required this.processId,
    required this.processName,
    required this.size,
    required this.timestamp,
  });
}

/// 内存分配算法类型
enum MemoryAllocationAlgorithm {
  firstFit('首次适应', 'First Fit'),
  bestFit('最佳适应', 'Best Fit'),
  worstFit('最坏适应', 'Worst Fit');
  
  final String label;
  final String englishName;
  const MemoryAllocationAlgorithm(this.label, this.englishName);
}

/// 内存分配结果
class AllocationResult {
  final bool success;
  final int? allocatedPartitionId;
  final int? allocatedAddress;
  final int? allocatedSize;
  final String message;
  final List<MemoryPartition> memoryState;
  final int externalFragmentation;
  final int internalFragmentation;
  
  AllocationResult({
    required this.success,
    this.allocatedPartitionId,
    this.allocatedAddress,
    this.allocatedSize,
    required this.message,
    required this.memoryState,
    this.externalFragmentation = 0,
    this.internalFragmentation = 0,
  });
}

/// 内存操作事件
class MemoryEvent {
  final int timestamp;
  final MemoryEventType type;
  final String description;
  final List<MemoryPartition> memoryState;
  final int? highlightPartition;
  
  MemoryEvent({
    required this.timestamp,
    required this.type,
    required this.description,
    required this.memoryState,
    this.highlightPartition,
  });
}

enum MemoryEventType {
  allocate('分配'),
  release('释放'),
  compact('紧缩'),
  search('查找');
  
  final String label;
  const MemoryEventType(this.label);
}

// ============= 页面置换相关 =============

/// 页框
class PageFrame {
  final int frameNumber;
  int? pageNumber;
  bool isModified;
  int lastUsedTime;
  int loadTime;
  
  PageFrame({
    required this.frameNumber,
    this.pageNumber,
    this.isModified = false,
    this.lastUsedTime = 0,
    this.loadTime = 0,
  });
  
  PageFrame clone() {
    return PageFrame(
      frameNumber: frameNumber,
      pageNumber: pageNumber,
      isModified: isModified,
      lastUsedTime: lastUsedTime,
      loadTime: loadTime,
    );
  }
}

/// 页面请求
class PageRequest {
  final int pageNumber;
  final bool isWrite;
  
  PageRequest({
    required this.pageNumber,
    this.isWrite = false,
  });
}

/// 页面置换算法类型
enum PageReplacementAlgorithm {
  fifo('先进先出', 'FIFO'),
  lru('最近最少使用', 'LRU'),
  opt('最优置换', 'OPT');
  
  final String label;
  final String shortName;
  const PageReplacementAlgorithm(this.label, this.shortName);
}

/// 页面置换步骤
class PageReplacementStep {
  final int timestamp;
  final int requestedPage;
  final bool isPageFault;
  final int? replacedPage;
  final List<PageFrame> frames;
  final String description;
  final int pageFaults;
  final double pageFaultRate;
  
  PageReplacementStep({
    required this.timestamp,
    required this.requestedPage,
    required this.isPageFault,
    this.replacedPage,
    required this.frames,
    required this.description,
    required this.pageFaults,
    required this.pageFaultRate,
  });
}

/// 页面置换结果
class PageReplacementResult {
  final PageReplacementAlgorithm algorithm;
  final List<PageReplacementStep> steps;
  final List<PageRequest> requests;
  final int totalPageFaults;
  final double pageFaultRate;
  final int frameCount;
  
  PageReplacementResult({
    required this.algorithm,
    required this.steps,
    required this.requests,
    required this.totalPageFaults,
    required this.pageFaultRate,
    required this.frameCount,
  });
}

/// 内存可视化配置
class MemoryVisualizationConfig {
  final int totalMemorySize;
  final int minPartitionSize;
  final bool showAddresses;
  final bool showFragmentation;
  final bool enableAnimation;
  
  const MemoryVisualizationConfig({
    this.totalMemorySize = 1024,
    this.minPartitionSize = 32,
    this.showAddresses = true,
    this.showFragmentation = true,
    this.enableAnimation = true,
  });
}

/// 内存统计信息
class MemoryStatistics {
  final int totalMemory;
  final int usedMemory;
  final int freeMemory;
  final int partitionCount;
  final int freePartitionCount;
  final int largestFreePartition;
  final double utilizationRate;
  final int externalFragmentation;
  final int internalFragmentation;
  
  MemoryStatistics({
    required this.totalMemory,
    required this.usedMemory,
    required this.freeMemory,
    required this.partitionCount,
    required this.freePartitionCount,
    required this.largestFreePartition,
    required this.utilizationRate,
    required this.externalFragmentation,
    required this.internalFragmentation,
  });
  
  factory MemoryStatistics.fromPartitions(List<MemoryPartition> partitions, int totalSize) {
    int usedMemory = 0;
    int freeMemory = 0;
    int freePartitionCount = 0;
    int largestFree = 0;
    int externalFrag = 0;
    int internalFrag = 0;
    
    for (var partition in partitions) {
      if (partition.isFree) {
        freeMemory += partition.size;
        freePartitionCount++;
        if (partition.size > largestFree) {
          largestFree = partition.size;
        }
        // 外部碎片：小于最小分区大小的空闲分区
        if (partition.size < 32) { // 假设最小进程大小为32
          externalFrag += partition.size;
        }
      } else {
        usedMemory += partition.size;
      }
    }
    
    return MemoryStatistics(
      totalMemory: totalSize,
      usedMemory: usedMemory,
      freeMemory: freeMemory,
      partitionCount: partitions.length,
      freePartitionCount: freePartitionCount,
      largestFreePartition: largestFree,
      utilizationRate: totalSize > 0 ? usedMemory / totalSize : 0,
      externalFragmentation: externalFrag,
      internalFragmentation: internalFrag,
    );
  }
}
