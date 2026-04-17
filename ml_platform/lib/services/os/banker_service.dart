// 银行家算法核心服务
import 'package:ml_platform/models/os/banker_model.dart';

/// 银行家算法服务
class BankerService {
  static final BankerService _instance = BankerService._internal();
  factory BankerService() => _instance;
  BankerService._internal();
  
  /// 执行安全性检查
  SafetyCheckResult checkSafety(BankerState state) {
    // 验证状态合法性
    assert(validateState(state) == null, '执行安全性检查前的状态不合法: ${validateState(state)}');
    
    List<SafetyCheckStep> steps = [];
    int stepNumber = 0;
    
    // 初始化Work和Finish向量
    List<int> work = List<int>.from(state.available);
    List<bool> finish = List.filled(state.processCount, false);
    List<int> safeSequence = [];
    
    steps.add(SafetyCheckStep(
      stepNumber: ++stepNumber,
      work: List.from(work),
      finish: List.from(finish),
      safeSequence: List.from(safeSequence),
      description: '初始化: Work = Available = [${work.join(', ')}], Finish = [${finish.map((f) => f ? 'T' : 'F').join(', ')}]',
      type: StepType.initialize,
    ));
    
    // 查找安全序列
    int count = 0;
    while (count < state.processCount) {
      bool found = false;
      
      for (int i = 0; i < state.processCount; i++) {
        if (finish[i]) continue;
        
        steps.add(SafetyCheckStep(
          stepNumber: ++stepNumber,
          checkingProcess: i,
          work: List.from(work),
          finish: List.from(finish),
          safeSequence: List.from(safeSequence),
          description: '检查进程 ${state.processNames[i]}: Need = [${state.need[i].join(', ')}], Work = [${work.join(', ')}]',
          type: StepType.check,
        ));
        
        // 检查Need[i] <= Work
        bool canAllocate = true;
        for (int j = 0; j < state.resourceCount; j++) {
          if (state.need[i][j] > work[j]) {
            canAllocate = false;
            break;
          }
        }
        
        if (canAllocate) {
          // 可以分配资源给进程i
          for (int j = 0; j < state.resourceCount; j++) {
            work[j] += state.allocation[i][j];
          }
          finish[i] = true;
          safeSequence.add(i);
          found = true;
          count++;
          
          steps.add(SafetyCheckStep(
            stepNumber: ++stepNumber,
            checkingProcess: i,
            work: List.from(work),
            finish: List.from(finish),
            safeSequence: List.from(safeSequence),
            description: '进程 ${state.processNames[i]} 可以完成，释放资源后 Work = [${work.join(', ')}]',
            type: StepType.allocate,
          ));
          
          break;
        } else {
          steps.add(SafetyCheckStep(
            stepNumber: ++stepNumber,
            checkingProcess: i,
            work: List.from(work),
            finish: List.from(finish),
            safeSequence: List.from(safeSequence),
            description: '进程 ${state.processNames[i]} 不满足条件，Need > Work，跳过',
            type: StepType.skip,
          ));
        }
      }
      
      if (!found) {
        // 无法找到可以执行的进程
        steps.add(SafetyCheckStep(
          stepNumber: ++stepNumber,
          work: List.from(work),
          finish: List.from(finish),
          safeSequence: List.from(safeSequence),
          description: '无法找到可以安全执行的进程，系统不安全！',
          type: StepType.fail,
        ));
        
        return SafetyCheckResult(
          isSafe: false,
          steps: steps,
          message: '系统处于不安全状态，无法找到安全序列',
        );
      }
    }
    
    // 所有进程都可以安全完成
    List<String> safeSequenceNames = safeSequence
        .map((i) => state.processNames[i])
        .toList();
    
    steps.add(SafetyCheckStep(
      stepNumber: ++stepNumber,
      work: List.from(work),
      finish: List.from(finish),
      safeSequence: List.from(safeSequence),
      description: '找到安全序列: ${safeSequenceNames.join(' → ')}',
      type: StepType.success,
    ));
    
    return SafetyCheckResult(
      isSafe: true,
      safeSequence: safeSequence,
      steps: steps,
      message: '系统处于安全状态，安全序列: ${safeSequenceNames.join(' → ')}',
    );
  }
  
  /// 处理资源请求
  ResourceRequestResult handleResourceRequest(
    BankerState state,
    ResourceRequest request,
  ) {
    // 验证状态合法性
    assert(validateState(state) == null, '处理资源请求前的状态不合法: ${validateState(state)}');
    int processIndex = request.processIndex;
    assert(processIndex >= 0 && processIndex < state.processCount, '进程索引不合法');
    assert(request.request.length == state.resourceCount, '请求向量维度与资源数不匹配');
    List<RequestCheckStep> steps = [];
    String processName = state.processNames[processIndex];
    
    // 步骤1：检查Request <= Need
    bool needCheckPassed = true;
    for (int j = 0; j < state.resourceCount; j++) {
      if (request.request[j] > state.need[processIndex][j]) {
        needCheckPassed = false;
        break;
      }
    }
    
    steps.add(RequestCheckStep(
      description: '检查 Request[${processName}] = [${request.request.join(', ')}] <= Need[${processName}] = [${state.need[processIndex].join(', ')}]',
      type: CheckType.needCheck,
      passed: needCheckPassed,
    ));
    
    if (!needCheckPassed) {
      return ResourceRequestResult(
        success: false,
        steps: steps,
        message: '请求失败：请求的资源超过进程 $processName 的最大需求',
      );
    }
    
    // 步骤2：检查Request <= Available
    bool availableCheckPassed = true;
    for (int j = 0; j < state.resourceCount; j++) {
      if (request.request[j] > state.available[j]) {
        availableCheckPassed = false;
        break;
      }
    }
    
    steps.add(RequestCheckStep(
      description: '检查 Request[${processName}] = [${request.request.join(', ')}] <= Available = [${state.available.join(', ')}]',
      type: CheckType.availableCheck,
      passed: availableCheckPassed,
    ));
    
    if (!availableCheckPassed) {
      return ResourceRequestResult(
        success: false,
        steps: steps,
        message: '请求失败：当前可用资源不足，进程 $processName 需要等待',
      );
    }
    
    // 步骤3：尝试分配资源
    BankerState tentativeState = state.clone();
    
    for (int j = 0; j < state.resourceCount; j++) {
      tentativeState.available[j] -= request.request[j];
      tentativeState.allocation[processIndex][j] += request.request[j];
      tentativeState.need[processIndex][j] -= request.request[j];
    }
    
    steps.add(RequestCheckStep(
      description: '尝试分配资源给进程 $processName...',
      type: CheckType.safetyCheck,
      passed: true,
    ));
    
    // 步骤4：执行安全性检查
    SafetyCheckResult safetyResult = checkSafety(tentativeState);
    
    steps.add(RequestCheckStep(
      description: safetyResult.message,
      type: CheckType.safetyCheck,
      passed: safetyResult.isSafe,
    ));
    
    if (safetyResult.isSafe) {
      return ResourceRequestResult(
        success: true,
        newState: tentativeState,
        steps: steps,
        message: '请求成功：资源已分配给进程 $processName，系统保持安全状态',
      );
    } else {
      return ResourceRequestResult(
        success: false,
        steps: steps,
        message: '请求失败：分配资源会导致系统进入不安全状态，进程 $processName 需要等待',
      );
    }
  }
  
  /// 验证银行家算法状态的合法性
  String? validateState(BankerState state) {
    // 检查矩阵维度
    if (state.max.length != state.processCount) {
      return 'Max矩阵行数与进程数不匹配';
    }
    if (state.allocation.length != state.processCount) {
      return 'Allocation矩阵行数与进程数不匹配';
    }
    if (state.need.length != state.processCount) {
      return 'Need矩阵行数与进程数不匹配';
    }
    
    for (int i = 0; i < state.processCount; i++) {
      if (state.max[i].length != state.resourceCount) {
        return 'Max矩阵第${i}行列数与资源种类数不匹配';
      }
      if (state.allocation[i].length != state.resourceCount) {
        return 'Allocation矩阵第${i}行列数与资源种类数不匹配';
      }
      if (state.need[i].length != state.resourceCount) {
        return 'Need矩阵第${i}行列数与资源种类数不匹配';
      }
    }
    
    if (state.available.length != state.resourceCount) {
      return 'Available向量长度与资源种类数不匹配';
    }
    
    // 检查Need = Max - Allocation
    for (int i = 0; i < state.processCount; i++) {
      for (int j = 0; j < state.resourceCount; j++) {
        if (state.need[i][j] != state.max[i][j] - state.allocation[i][j]) {
          return 'Need矩阵计算错误：Need[$i][$j] ≠ Max[$i][$j] - Allocation[$i][$j]';
        }
      }
    }
    
    // 检查Allocation <= Max
    for (int i = 0; i < state.processCount; i++) {
      for (int j = 0; j < state.resourceCount; j++) {
        if (state.allocation[i][j] > state.max[i][j]) {
          return '数据错误：进程${state.processNames[i]}的Allocation[$j] > Max[$j]';
        }
      }
    }
    
    // 检查非负数
    for (int i = 0; i < state.processCount; i++) {
      for (int j = 0; j < state.resourceCount; j++) {
        if (state.max[i][j] < 0 || state.allocation[i][j] < 0 || state.need[i][j] < 0) {
          return '数据错误：矩阵中存在负数';
        }
      }
    }
    
    for (int j = 0; j < state.resourceCount; j++) {
      if (state.available[j] < 0) {
        return '数据错误：Available向量中存在负数';
      }
    }
    
    return null; // 验证通过
  }
  
  /// 生成随机的银行家算法状态（用于测试）
  BankerState generateRandomState({
    int processCount = 4,
    int resourceCount = 3,
    int maxResourcePerType = 10,
  }) {
    List<List<int>> max = [];
    List<List<int>> allocation = [];
    
    // 生成Max矩阵
    for (int i = 0; i < processCount; i++) {
      List<int> row = [];
      for (int j = 0; j < resourceCount; j++) {
        row.add((maxResourcePerType * 0.3 + 
                (maxResourcePerType * 0.7) * (i + j) / (processCount + resourceCount)).toInt());
      }
      max.add(row);
    }
    
    // 生成Allocation矩阵（确保不超过Max）
    for (int i = 0; i < processCount; i++) {
      List<int> row = [];
      for (int j = 0; j < resourceCount; j++) {
        row.add((max[i][j] * 0.3 * (1 - i / processCount)).toInt());
      }
      allocation.add(row);
    }
    
    // 计算Need矩阵
    List<List<int>> need = BankerState.calculateNeed(max, allocation);
    
    // 计算Available向量
    List<int> totalResources = List.filled(resourceCount, 0);
    for (int j = 0; j < resourceCount; j++) {
      int allocated = 0;
      for (int i = 0; i < processCount; i++) {
        allocated += allocation[i][j];
      }
      totalResources[j] = allocated + (maxResourcePerType * 0.3).toInt();
    }
    
    List<int> available = [];
    for (int j = 0; j < resourceCount; j++) {
      int allocated = 0;
      for (int i = 0; i < processCount; i++) {
        allocated += allocation[i][j];
      }
      available.add(totalResources[j] - allocated);
    }
    
    return BankerState(
      processCount: processCount,
      resourceCount: resourceCount,
      max: max,
      allocation: allocation,
      need: need,
      available: available,
    );
  }
  
  /// 创建一个保证安全的示例状态
  BankerState createSafeExampleState() {
    return BankerState(
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
    );
  }
  
  /// 创建一个不安全的示例状态
  BankerState createUnsafeExampleState() {
    return BankerState(
      processCount: 3,
      resourceCount: 3,
      max: [
        [8, 5, 3],
        [3, 2, 2],
        [9, 0, 2],
      ],
      allocation: [
        [0, 1, 0],
        [2, 0, 0],
        [3, 0, 2],
      ],
      need: [
        [8, 4, 3],
        [1, 2, 2],
        [6, 0, 0],
      ],
      available: [2, 1, 0],
      processNames: ['P0', 'P1', 'P2'],
      resourceNames: ['A', 'B', 'C'],
    );
  }
}
