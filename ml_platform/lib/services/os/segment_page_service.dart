// 段页式内存管理服务
import 'package:ml_platform/models/os/segment_page_model.dart';

/// 段页式内存管理服务
class SegmentPageService {
  static final SegmentPageService _instance = SegmentPageService._internal();
  factory SegmentPageService() => _instance;
  SegmentPageService._internal();
  
  /// 执行地址转换
  AddressTranslationResult translateAddress(
    SegmentPageMemorySystem system,
    AddressTranslationRequest request,
  ) {
    final steps = <TranslationStep>[];
    final logicalAddr = request.logicalAddress;
    
    steps.add(TranslationStep(
      description: '开始地址转换: ${logicalAddr}',
      type: StepType.segmentCheck,
      data: {'logical_address': logicalAddr.toString()},
    ));
    
    // 第一步：段表检查
    final segmentCheckResult = _checkSegmentTable(system, logicalAddr, steps);
    if (!segmentCheckResult.success) {
      return segmentCheckResult;
    }
    
    // 第二步：页表查找
    final pageTableResult = _lookupPageTable(system, logicalAddr, steps, request.accessType);
    if (!pageTableResult.success) {
      return pageTableResult;
    }
    
    // 第三步：计算物理地址
    return _calculatePhysicalAddress(system, logicalAddr, steps);
  }
  
  /// 检查段表
  AddressTranslationResult _checkSegmentTable(
    SegmentPageMemorySystem system,
    LogicalAddress logicalAddr,
    List<TranslationStep> steps,
  ) {
    steps.add(TranslationStep(
      description: '检查段表：段号 ${logicalAddr.segmentNumber}',
      type: StepType.segmentCheck,
    ));
    
    // 查找段表项
    SegmentTableEntry? segmentEntry;
    try {
      segmentEntry = system.segmentTable.firstWhere(
        (entry) => entry.segmentNumber == logicalAddr.segmentNumber,
      );
    } catch (e) {
      steps.add(TranslationStep(
        description: '段表检查失败：段号 ${logicalAddr.segmentNumber} 不存在',
        type: StepType.error,
      ));
      
      return AddressTranslationResult(
        success: false,
        steps: steps,
        errorMessage: '段错误：段号 ${logicalAddr.segmentNumber} 不存在',
        error: TranslationError.segmentFault,
      );
    }
    
    // 检查段有效性
    if (!segmentEntry.isValid) {
      steps.add(TranslationStep(
        description: '段表检查失败：段 ${logicalAddr.segmentNumber} 无效',
        type: StepType.error,
      ));
      
      return AddressTranslationResult(
        success: false,
        steps: steps,
        errorMessage: '段错误：段 ${logicalAddr.segmentNumber} 无效',
        error: TranslationError.segmentFault,
      );
    }
    
    // 检查页号是否超出段界限
    if (logicalAddr.pageNumber >= segmentEntry.limit) {
      steps.add(TranslationStep(
        description: '段表检查失败：页号 ${logicalAddr.pageNumber} 超出段界限 ${segmentEntry.limit}',
        type: StepType.error,
      ));
      
      return AddressTranslationResult(
        success: false,
        steps: steps,
        errorMessage: '段错误：页号超出段界限',
        error: TranslationError.segmentFault,
      );
    }
    
    steps.add(TranslationStep(
      description: '段表检查通过：段 ${logicalAddr.segmentNumber}，页表基址 ${segmentEntry.baseAddress}',
      type: StepType.segmentCheck,
      data: {
        'segment_number': logicalAddr.segmentNumber,
        'base_address': segmentEntry.baseAddress,
        'limit': segmentEntry.limit,
      },
    ));
    
    return AddressTranslationResult(
      success: true,
      steps: steps,
    );
  }
  
  /// 查找页表
  AddressTranslationResult _lookupPageTable(
    SegmentPageMemorySystem system,
    LogicalAddress logicalAddr,
    List<TranslationStep> steps,
    AccessType accessType,
  ) {
    steps.add(TranslationStep(
      description: '查找页表：段 ${logicalAddr.segmentNumber}，页 ${logicalAddr.pageNumber}',
      type: StepType.pageTableLookup,
    ));
    
    // 获取页表
    final pageTable = system.pageTables[logicalAddr.segmentNumber];
    if (pageTable == null) {
      steps.add(TranslationStep(
        description: '页表查找失败：段 ${logicalAddr.segmentNumber} 的页表不存在',
        type: StepType.error,
      ));
      
      return AddressTranslationResult(
        success: false,
        steps: steps,
        errorMessage: '页表不存在',
        error: TranslationError.pageFault,
      );
    }
    
    // 检查页号是否有效
    if (logicalAddr.pageNumber >= pageTable.length) {
      steps.add(TranslationStep(
        description: '页表查找失败：页号 ${logicalAddr.pageNumber} 超出页表范围',
        type: StepType.error,
      ));
      
      return AddressTranslationResult(
        success: false,
        steps: steps,
        errorMessage: '页号无效',
        error: TranslationError.invalidAddress,
      );
    }
    
    final pageEntry = pageTable[logicalAddr.pageNumber];
    
    // 检查页面是否在内存中
    if (!pageEntry.isValid) {
      // 缺页中断，需要分配页框
      steps.add(TranslationStep(
        description: '缺页中断：页面 ${logicalAddr.pageNumber} 不在内存中',
        type: StepType.error,
      ));
      
      // 尝试分配页框
      final frameNumber = system.allocateFrame();
      if (frameNumber == null) {
        steps.add(TranslationStep(
          description: '页框分配失败：没有空闲页框',
          type: StepType.error,
        ));
        
        return AddressTranslationResult(
          success: false,
          steps: steps,
          errorMessage: '内存不足：没有空闲页框',
          error: TranslationError.pageFault,
        );
      }
      
      // 分配页框成功
      pageEntry.frameNumber = frameNumber;
      pageEntry.isValid = true;
      pageEntry.loadTime = DateTime.now().millisecondsSinceEpoch;
      pageEntry.lastAccessTime = DateTime.now().millisecondsSinceEpoch;
      
      steps.add(TranslationStep(
        description: '页框分配成功：为页面 ${logicalAddr.pageNumber} 分配页框 $frameNumber',
        type: StepType.frameAllocation,
        data: {
          'page_number': logicalAddr.pageNumber,
          'frame_number': frameNumber,
        },
      ));
    }
    
    // 检查访问权限
    final accessAllowed = _checkAccess(pageEntry.access, accessType);
    if (!accessAllowed) {
      steps.add(TranslationStep(
        description: '访问权限检查失败：页面不允许 ${accessType.label} 访问',
        type: StepType.error,
      ));
      
      return AddressTranslationResult(
        success: false,
        steps: steps,
        errorMessage: '权限拒绝：页面不允许 ${accessType.label} 访问',
        error: TranslationError.permissionDenied,
      );
    }
    
    // 更新访问信息
    pageEntry.isReferenced = true;
    pageEntry.lastAccessTime = DateTime.now().millisecondsSinceEpoch;
    if (accessType == AccessType.write) {
      pageEntry.isDirty = true;
    }
    
    steps.add(TranslationStep(
      description: '页表查找成功：页面 ${logicalAddr.pageNumber} 映射到页框 ${pageEntry.frameNumber}',
      type: StepType.pageTableLookup,
      data: {
        'page_number': logicalAddr.pageNumber,
        'frame_number': pageEntry.frameNumber,
        'access_type': accessType.label,
      },
    ));
    
    return AddressTranslationResult(
      success: true,
      steps: steps,
    );
  }
  
  /// 计算物理地址
  AddressTranslationResult _calculatePhysicalAddress(
    SegmentPageMemorySystem system,
    LogicalAddress logicalAddr,
    List<TranslationStep> steps,
  ) {
    final pageTable = system.pageTables[logicalAddr.segmentNumber]!;
    final pageEntry = pageTable[logicalAddr.pageNumber];
    
    // 计算物理地址
    final physicalAddress = PhysicalAddress(
      frameNumber: pageEntry.frameNumber,
      offset: logicalAddr.offset,
      absoluteAddress: pageEntry.frameNumber * system.pageSize + logicalAddr.offset,
    );
    
    steps.add(TranslationStep(
      description: '地址转换成功：${physicalAddress}',
      type: StepType.success,
      data: {
        'frame_number': pageEntry.frameNumber,
        'offset': logicalAddr.offset,
        'absolute_address': physicalAddress.absoluteAddress,
      },
    ));
    
    return AddressTranslationResult(
      success: true,
      physicalAddress: physicalAddress,
      steps: steps,
    );
  }
  
  /// 检查访问权限
  bool _checkAccess(PageAccess pageAccess, AccessType accessType) {
    switch (pageAccess) {
      case PageAccess.read:
        return accessType == AccessType.read;
      case PageAccess.write:
        return accessType == AccessType.write;
      case PageAccess.readWrite:
        return accessType == AccessType.read || accessType == AccessType.write;
      case PageAccess.execute:
        return accessType == AccessType.execute;
    }
  }
  
  /// 创建示例内存系统
  SegmentPageMemorySystem createExampleSystem() {
    final system = SegmentPageMemorySystem(
      pageSize: 1024,
      frameCount: 16,
    );
    
    // 添加代码段
    system.addSegment(0, 4, SegmentAccess.execute);
    
    // 添加数据段
    system.addSegment(1, 6, SegmentAccess.readWrite);
    
    // 添加堆栈段
    system.addSegment(2, 2, SegmentAccess.readWrite);
    
    // 预分配一些页面
    _allocatePage(system, 0, 0); // 代码段第一页
    _allocatePage(system, 1, 0); // 数据段第一页
    _allocatePage(system, 1, 1); // 数据段第二页
    
    return system;
  }
  
  /// 分配页面到页框
  void _allocatePage(SegmentPageMemorySystem system, int segmentNumber, int pageNumber) {
    final frameNumber = system.allocateFrame();
    if (frameNumber != null) {
      final pageTable = system.pageTables[segmentNumber];
      if (pageTable != null && pageNumber < pageTable.length) {
        final pageEntry = pageTable[pageNumber];
        pageEntry.frameNumber = frameNumber;
        pageEntry.isValid = true;
        pageEntry.loadTime = DateTime.now().millisecondsSinceEpoch;
      }
    }
  }
  
  /// 生成示例地址访问序列
  List<AddressTranslationRequest> generateAddressSequence({int count = 10}) {
    final requests = <AddressTranslationRequest>[];
    final accessTypes = [AccessType.read, AccessType.write, AccessType.execute];
    
    for (int i = 0; i < count; i++) {
      final segmentNumber = i % 3; // 在3个段之间循环
      final pageNumber = (i ~/ 3) % 4; // 在页面之间循环
      final offset = (i * 100) % 1024; // 页内偏移
      
      requests.add(AddressTranslationRequest(
        logicalAddress: LogicalAddress(
          segmentNumber: segmentNumber,
          pageNumber: pageNumber,
          offset: offset,
        ),
        accessType: accessTypes[i % accessTypes.length],
      ));
    }
    
    return requests;
  }
}
