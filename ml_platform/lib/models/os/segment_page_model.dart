// 段页式内存管理模型
import 'package:flutter/material.dart';

/// 段表项
class SegmentTableEntry {
  final int segmentNumber;
  int baseAddress;           // 页表基址
  int limit;                 // 段长度（页数）
  bool isValid;              // 有效位
  SegmentAccess access;      // 访问权限
  
  SegmentTableEntry({
    required this.segmentNumber,
    required this.baseAddress,
    required this.limit,
    this.isValid = true,
    this.access = SegmentAccess.readWrite,
  });
}

/// 页表项
class PageTableEntry {
  final int pageNumber;
  int frameNumber;           // 物理页框号
  bool isValid;              // 有效位
  bool isDirty;              // 修改位
  bool isReferenced;         // 访问位
  PageAccess access;         // 访问权限
  int loadTime;              // 装入时间
  int lastAccessTime;        // 最近访问时间
  
  PageTableEntry({
    required this.pageNumber,
    this.frameNumber = -1,
    this.isValid = false,
    this.isDirty = false,
    this.isReferenced = false,
    this.access = PageAccess.readWrite,
    this.loadTime = 0,
    this.lastAccessTime = 0,
  });
}

/// 段访问权限
enum SegmentAccess {
  read('只读', Colors.blue),
  write('只写', Colors.orange),
  readWrite('读写', Colors.green),
  execute('执行', Colors.purple);
  
  final String label;
  final Color color;
  const SegmentAccess(this.label, this.color);
}

/// 页访问权限
enum PageAccess {
  read('只读', Colors.blue),
  write('只写', Colors.orange),
  readWrite('读写', Colors.green),
  execute('执行', Colors.purple);
  
  final String label;
  final Color color;
  const PageAccess(this.label, this.color);
}

/// 逻辑地址
class LogicalAddress {
  final int segmentNumber;   // 段号
  final int pageNumber;      // 页号
  final int offset;          // 页内偏移
  
  LogicalAddress({
    required this.segmentNumber,
    required this.pageNumber,
    required this.offset,
  });
  
  @override
  String toString() {
    return '($segmentNumber, $pageNumber, $offset)';
  }
}

/// 物理地址
class PhysicalAddress {
  final int frameNumber;     // 页框号
  final int offset;          // 页内偏移
  final int absoluteAddress; // 绝对地址
  
  PhysicalAddress({
    required this.frameNumber,
    required this.offset,
    required this.absoluteAddress,
  });
  
  @override
  String toString() {
    return '物理地址: $absoluteAddress (页框$frameNumber + 偏移$offset)';
  }
}

/// 地址转换请求
class AddressTranslationRequest {
  final LogicalAddress logicalAddress;
  final AccessType accessType;
  final DateTime timestamp;
  
  AddressTranslationRequest({
    required this.logicalAddress,
    required this.accessType,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();
}

/// 访问类型
enum AccessType {
  read('读取', Icons.visibility, Colors.blue),
  write('写入', Icons.edit, Colors.orange),
  execute('执行', Icons.play_arrow, Colors.green);
  
  final String label;
  final IconData icon;
  final Color color;
  const AccessType(this.label, this.icon, this.color);
}

/// 地址转换结果
class AddressTranslationResult {
  final bool success;
  final PhysicalAddress? physicalAddress;
  final List<TranslationStep> steps;
  final String errorMessage;
  final TranslationError? error;
  
  AddressTranslationResult({
    required this.success,
    this.physicalAddress,
    required this.steps,
    this.errorMessage = '',
    this.error,
  });
}

/// 地址转换步骤
class TranslationStep {
  final String description;
  final StepType type;
  final Map<String, dynamic> data;
  
  TranslationStep({
    required this.description,
    required this.type,
    this.data = const {},
  });
}

/// 步骤类型
enum StepType {
  segmentCheck('段表检查', Colors.blue),
  pageTableLookup('页表查找', Colors.green),
  frameAllocation('页框分配', Colors.orange),
  addressCalculation('地址计算', Colors.purple),
  error('错误', Colors.red),
  success('成功', Colors.green);
  
  final String label;
  final Color color;
  const StepType(this.label, this.color);
}

/// 转换错误类型
enum TranslationError {
  segmentFault('段错误'),
  pageFault('缺页'),
  permissionDenied('权限拒绝'),
  invalidAddress('无效地址');
  
  final String message;
  const TranslationError(this.message);
}

/// 段页式内存管理系统
class SegmentPageMemorySystem {
  final int pageSize;                    // 页面大小
  final int frameCount;                  // 页框总数
  final List<SegmentTableEntry> segmentTable; // 段表
  final Map<int, List<PageTableEntry>> pageTables; // 页表集合
  final List<bool> frameTable;          // 页框使用表
  final List<int> frameAllocationOrder; // 页框分配顺序
  
  SegmentPageMemorySystem({
    this.pageSize = 1024,
    this.frameCount = 32,
    List<SegmentTableEntry>? segmentTable,
    Map<int, List<PageTableEntry>>? pageTables,
  }) : segmentTable = segmentTable ?? [],
       pageTables = pageTables ?? {},
       frameTable = List.filled(frameCount, false),
       frameAllocationOrder = [];
  
  /// 添加段
  void addSegment(int segmentNumber, int pageCount, SegmentAccess access) {
    // 创建段表项
    segmentTable.add(SegmentTableEntry(
      segmentNumber: segmentNumber,
      baseAddress: segmentNumber * 1000, // 简化的基址计算
      limit: pageCount,
      access: access,
    ));
    
    // 创建对应的页表
    pageTables[segmentNumber] = List.generate(
      pageCount,
      (index) => PageTableEntry(pageNumber: index),
    );
  }
  
  /// 分配页框
  int? allocateFrame() {
    for (int i = 0; i < frameCount; i++) {
      if (!frameTable[i]) {
        frameTable[i] = true;
        frameAllocationOrder.add(i);
        return i;
      }
    }
    return null; // 没有空闲页框
  }
  
  /// 释放页框
  void deallocateFrame(int frameNumber) {
    if (frameNumber >= 0 && frameNumber < frameCount) {
      frameTable[frameNumber] = false;
      frameAllocationOrder.remove(frameNumber);
    }
  }
  
  /// 获取统计信息
  MemorySystemStatistics getStatistics() {
    int usedFrames = frameTable.where((used) => used).length;
    int totalPages = pageTables.values
        .expand((pages) => pages)
        .where((page) => page.isValid)
        .length;
    
    return MemorySystemStatistics(
      totalFrames: frameCount,
      usedFrames: usedFrames,
      freeFrames: frameCount - usedFrames,
      totalSegments: segmentTable.length,
      totalPages: totalPages,
      memoryUtilization: frameCount > 0 ? usedFrames / frameCount : 0,
    );
  }
}

/// 内存系统统计信息
class MemorySystemStatistics {
  final int totalFrames;
  final int usedFrames;
  final int freeFrames;
  final int totalSegments;
  final int totalPages;
  final double memoryUtilization;
  
  MemorySystemStatistics({
    required this.totalFrames,
    required this.usedFrames,
    required this.freeFrames,
    required this.totalSegments,
    required this.totalPages,
    required this.memoryUtilization,
  });
}

/// 段页式内存配置
class SegmentPageConfig {
  final int pageSize;
  final int frameCount;
  final bool enableVirtualMemory;
  final PageReplacementPolicy replacementPolicy;
  
  const SegmentPageConfig({
    this.pageSize = 1024,
    this.frameCount = 32,
    this.enableVirtualMemory = true,
    this.replacementPolicy = PageReplacementPolicy.lru,
  });
}

/// 页面置换策略
enum PageReplacementPolicy {
  fifo('FIFO'),
  lru('LRU'),
  clock('Clock'),
  optimal('Optimal');
  
  final String name;
  const PageReplacementPolicy(this.name);
}
