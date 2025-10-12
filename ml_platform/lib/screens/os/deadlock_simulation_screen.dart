// 死锁模拟界面（银行家算法）
import 'package:flutter/material.dart';
import 'package:ml_platform/models/os/banker_model.dart';
import 'package:ml_platform/services/os/banker_service.dart';
import 'package:ml_platform/widgets/os/banker_algorithm_visualizer.dart';

class DeadlockSimulationScreen extends StatefulWidget {
  const DeadlockSimulationScreen({Key? key}) : super(key: key);
  
  @override
  State<DeadlockSimulationScreen> createState() => _DeadlockSimulationScreenState();
}

class _DeadlockSimulationScreenState extends State<DeadlockSimulationScreen>
    with TickerProviderStateMixin {
  final BankerService _bankerService = BankerService();
  late AnimationController _animationController;
  
  // 银行家算法状态
  BankerState? _currentState;
  
  // 安全性检查结果
  SafetyCheckResult? _safetyResult;
  int _currentStepIndex = 0;
  bool _isPlaying = false;
  
  // 资源请求历史
  List<ResourceRequestResult> _requestHistory = [];
  
  // 编辑模式
  bool _isEditMode = false;
  final List<List<TextEditingController>> _maxControllers = [];
  final List<List<TextEditingController>> _allocationControllers = [];
  final List<TextEditingController> _availableControllers = [];
  
  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(seconds: 1),
      vsync: this,
    )..repeat();
    
    // 加载示例状态
    _loadExampleState(0);
  }
  
  @override
  void dispose() {
    _animationController.dispose();
    _disposeControllers();
    super.dispose();
  }
  
  void _disposeControllers() {
    for (var row in _maxControllers) {
      for (var controller in row) {
        controller.dispose();
      }
    }
    for (var row in _allocationControllers) {
      for (var controller in row) {
        controller.dispose();
      }
    }
    for (var controller in _availableControllers) {
      controller.dispose();
    }
    _maxControllers.clear();
    _allocationControllers.clear();
    _availableControllers.clear();
  }
  
  void _loadExampleState(int exampleIndex) {
    final examples = BankerExample.getExamples();
    if (exampleIndex < examples.length) {
      setState(() {
        _currentState = examples[exampleIndex].state.clone();
        _safetyResult = null;
        _currentStepIndex = 0;
        _requestHistory.clear();
        _isEditMode = false;
      });
    }
  }
  
  void _checkSafety() {
    if (_currentState == null) return;
    
    // 验证状态
    String? error = _bankerService.validateState(_currentState!);
    if (error != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }
    
    setState(() {
      _safetyResult = _bankerService.checkSafety(_currentState!);
      _currentStepIndex = 0;
      _isPlaying = false;
    });
  }
  
  void _handleResourceRequest(ResourceRequest request) {
    if (_currentState == null) return;
    
    final result = _bankerService.handleResourceRequest(_currentState!, request);
    
    setState(() {
      _requestHistory.add(result);
      if (result.success && result.newState != null) {
        _currentState = result.newState;
        _safetyResult = null;
      }
    });
    
    // 显示结果
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(result.message),
        backgroundColor: result.success ? Colors.green : Colors.orange,
        duration: const Duration(seconds: 3),
      ),
    );
  }
  
  void _playSteps() async {
    if (_safetyResult == null) return;
    
    setState(() => _isPlaying = true);
    
    for (int i = _currentStepIndex; i < _safetyResult!.steps.length; i++) {
      if (!mounted || !_isPlaying) break;
      
      setState(() => _currentStepIndex = i);
      
      await Future.delayed(const Duration(milliseconds: 1500));
    }
    
    setState(() => _isPlaying = false);
  }
  
  void _pauseSteps() {
    setState(() => _isPlaying = false);
  }
  
  void _toggleEditMode() {
    if (!_isEditMode && _currentState != null) {
      // 进入编辑模式，初始化控制器
      _initializeControllers();
    } else if (_isEditMode) {
      // 退出编辑模式，保存更改
      _saveEditedState();
    }
    
    setState(() {
      _isEditMode = !_isEditMode;
    });
  }
  
  void _initializeControllers() {
    if (_currentState == null) return;
    
    _disposeControllers();
    
    // 初始化Max控制器
    for (int i = 0; i < _currentState!.processCount; i++) {
      List<TextEditingController> row = [];
      for (int j = 0; j < _currentState!.resourceCount; j++) {
        row.add(TextEditingController(text: _currentState!.max[i][j].toString()));
      }
      _maxControllers.add(row);
    }
    
    // 初始化Allocation控制器
    for (int i = 0; i < _currentState!.processCount; i++) {
      List<TextEditingController> row = [];
      for (int j = 0; j < _currentState!.resourceCount; j++) {
        row.add(TextEditingController(text: _currentState!.allocation[i][j].toString()));
      }
      _allocationControllers.add(row);
    }
    
    // 初始化Available控制器
    for (int j = 0; j < _currentState!.resourceCount; j++) {
      _availableControllers.add(
        TextEditingController(text: _currentState!.available[j].toString()),
      );
    }
  }
  
  void _saveEditedState() {
    if (_currentState == null) return;
    
    try {
      // 读取Max矩阵
      List<List<int>> newMax = [];
      for (int i = 0; i < _currentState!.processCount; i++) {
        List<int> row = [];
        for (int j = 0; j < _currentState!.resourceCount; j++) {
          row.add(int.parse(_maxControllers[i][j].text));
        }
        newMax.add(row);
      }
      
      // 读取Allocation矩阵
      List<List<int>> newAllocation = [];
      for (int i = 0; i < _currentState!.processCount; i++) {
        List<int> row = [];
        for (int j = 0; j < _currentState!.resourceCount; j++) {
          row.add(int.parse(_allocationControllers[i][j].text));
        }
        newAllocation.add(row);
      }
      
      // 读取Available向量
      List<int> newAvailable = [];
      for (int j = 0; j < _currentState!.resourceCount; j++) {
        newAvailable.add(int.parse(_availableControllers[j].text));
      }
      
      // 计算Need矩阵
      List<List<int>> newNeed = BankerState.calculateNeed(newMax, newAllocation);
      
      setState(() {
        _currentState = BankerState(
          processCount: _currentState!.processCount,
          resourceCount: _currentState!.resourceCount,
          max: newMax,
          allocation: newAllocation,
          need: newNeed,
          available: newAvailable,
          processNames: _currentState!.processNames,
          resourceNames: _currentState!.resourceNames,
        );
        _safetyResult = null;
      });
      
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('状态已更新'),
          backgroundColor: Colors.green,
        ),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('输入格式错误: $e'),
          backgroundColor: Colors.red,
        ),
      );
    }
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
          tooltip: '返回',
        ),
        title: const Text('银行家算法与死锁避免'),
        actions: [
          IconButton(
            icon: Icon(_isEditMode ? Icons.save : Icons.edit),
            onPressed: _toggleEditMode,
            tooltip: _isEditMode ? '保存' : '编辑',
          ),
          IconButton(
            icon: const Icon(Icons.help_outline),
            onPressed: () => _showHelpDialog(context),
            tooltip: '帮助',
          ),
        ],
      ),
      body: Row(
        children: [
          // 左侧控制面板
          Container(
            width: 400,
            padding: const EdgeInsets.all(16),
            child: SingleChildScrollView(
              child: Column(
                children: [
                  _buildExampleSelector(),
                  const SizedBox(height: 16),
                  if (_currentState != null) ...[
                    ResourceRequestInput(
                      state: _currentState!,
                      onRequest: _handleResourceRequest,
                    ),
                    const SizedBox(height: 16),
                    _buildControlButtons(),
                    const SizedBox(height: 16),
                    if (_requestHistory.isNotEmpty)
                      _buildRequestHistory(),
                  ],
                ],
              ),
            ),
          ),
          
          // 右侧可视化区域
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(16),
              child: SingleChildScrollView(
                child: Column(
                  children: [
                    if (_currentState != null) ...[
                      // 矩阵展示
                      if (_isEditMode)
                        _buildEditableMatrices()
                      else
                        BankerMatrixVisualizer(
                          state: _currentState!,
                          showNeedCalculation: true,
                        ),
                      const SizedBox(height: 16),
                      
                      // Available向量
                      if (_isEditMode)
                        _buildEditableAvailable()
                      else
                        AvailableVectorVisualizer(state: _currentState!),
                      const SizedBox(height: 16),
                      
                      // 统计信息
                      _buildStatistics(),
                      
                      // 安全性检查结果
                      if (_safetyResult != null) ...[
                        const SizedBox(height: 16),
                        _buildSafetyResult(),
                        const SizedBox(height: 16),
                        _buildStepVisualization(),
                      ],
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildExampleSelector() {
    final examples = BankerExample.getExamples();
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '选择示例',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            ...List.generate(examples.length, (index) {
              final example = examples[index];
              return ListTile(
                title: Text(example.name),
                subtitle: Text(example.description),
                leading: Radio<int>(
                  value: index,
                  groupValue: examples.indexOf(
                    examples.firstWhere((e) => 
                      e.state.processCount == _currentState?.processCount &&
                      e.state.resourceCount == _currentState?.resourceCount,
                      orElse: () => examples[0],
                    ),
                  ),
                  onChanged: (value) => _loadExampleState(value!),
                ),
                onTap: () => _loadExampleState(index),
              );
            }),
          ],
        ),
      ),
    );
  }
  
  Widget _buildControlButtons() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _checkSafety,
                icon: const Icon(Icons.security),
                label: const Text('执行安全性检查'),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.all(16),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () {
                      setState(() {
                        _currentState = _bankerService.createSafeExampleState();
                        _safetyResult = null;
                      });
                    },
                    icon: const Icon(Icons.check_circle, color: Colors.green),
                    label: const Text('安全示例'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () {
                      setState(() {
                        _currentState = _bankerService.createUnsafeExampleState();
                        _safetyResult = null;
                      });
                    },
                    icon: const Icon(Icons.warning, color: Colors.orange),
                    label: const Text('不安全示例'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildRequestHistory() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '请求历史',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            ...List.generate(
              _requestHistory.length > 5 ? 5 : _requestHistory.length,
              (index) {
                final result = _requestHistory[_requestHistory.length - 1 - index];
                return ListTile(
                  dense: true,
                  leading: Icon(
                    result.success ? Icons.check_circle : Icons.block,
                    color: result.success ? Colors.green : Colors.red,
                    size: 20,
                  ),
                  title: Text(
                    result.message,
                    style: const TextStyle(fontSize: 12),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildEditableMatrices() {
    if (_currentState == null) return const SizedBox.shrink();
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '编辑矩阵（Max | Allocation）',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            Table(
              defaultColumnWidth: const IntrinsicColumnWidth(),
              children: [
                // 表头
                TableRow(
                  children: [
                    const Padding(padding: EdgeInsets.all(8), child: Text('进程')),
                    ..._currentState!.resourceNames.map((name) => 
                      Padding(padding: const EdgeInsets.all(8), child: Text(name, textAlign: TextAlign.center))),
                    const Padding(padding: EdgeInsets.all(8), child: Text('|', textAlign: TextAlign.center)),
                    ..._currentState!.resourceNames.map((name) => 
                      Padding(padding: const EdgeInsets.all(8), child: Text(name, textAlign: TextAlign.center))),
                  ],
                ),
                // 数据行
                ...List.generate(_currentState!.processCount, (i) {
                  return TableRow(
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(8),
                        child: Text(_currentState!.processNames[i]),
                      ),
                      // Max矩阵
                      ...List.generate(_currentState!.resourceCount, (j) {
                        return Padding(
                          padding: const EdgeInsets.all(4),
                          child: TextField(
                            controller: _maxControllers[i][j],
                            textAlign: TextAlign.center,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                              isDense: true,
                              contentPadding: EdgeInsets.all(8),
                              border: OutlineInputBorder(),
                            ),
                          ),
                        );
                      }),
                      const Padding(
                        padding: EdgeInsets.all(8),
                        child: Text('|', textAlign: TextAlign.center),
                      ),
                      // Allocation矩阵
                      ...List.generate(_currentState!.resourceCount, (j) {
                        return Padding(
                          padding: const EdgeInsets.all(4),
                          child: TextField(
                            controller: _allocationControllers[i][j],
                            textAlign: TextAlign.center,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                              isDense: true,
                              contentPadding: EdgeInsets.all(8),
                              border: OutlineInputBorder(),
                            ),
                          ),
                        );
                      }),
                    ],
                  );
                }),
              ],
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildEditableAvailable() {
    if (_currentState == null) return const SizedBox.shrink();
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '编辑Available向量',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            Row(
              children: List.generate(_currentState!.resourceCount, (j) {
                return Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: TextField(
                      controller: _availableControllers[j],
                      decoration: InputDecoration(
                        labelText: _currentState!.resourceNames[j],
                        border: const OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.number,
                      textAlign: TextAlign.center,
                    ),
                  ),
                );
              }),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildStatistics() {
    if (_currentState == null) return const SizedBox.shrink();
    
    final stats = BankerStatistics.fromState(_currentState!);
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            _buildStatItem('总资源', '${stats.totalResources}', Icons.inventory, Colors.blue),
            _buildStatItem('已分配', '${stats.allocatedResources}', Icons.lock, Colors.orange),
            _buildStatItem('可用', '${stats.availableResources}', Icons.lock_open, Colors.green),
            _buildStatItem('利用率', '${(stats.utilizationRate * 100).toStringAsFixed(1)}%', Icons.pie_chart, Colors.purple),
          ],
        ),
      ),
    );
  }
  
  Widget _buildStatItem(String label, String value, IconData icon, Color color) {
    return Column(
      children: [
        Icon(icon, color: color, size: 24),
        const SizedBox(height: 8),
        Text(
          value,
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: color,
          ),
        ),
        Text(label, style: const TextStyle(fontSize: 12)),
      ],
    );
  }
  
  Widget _buildSafetyResult() {
    if (_safetyResult == null) return const SizedBox.shrink();
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Icon(
                  _safetyResult!.isSafe ? Icons.check_circle : Icons.warning,
                  color: _safetyResult!.isSafe ? Colors.green : Colors.red,
                  size: 32,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    _safetyResult!.message,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: _safetyResult!.isSafe ? Colors.green : Colors.red,
                    ),
                  ),
                ),
              ],
            ),
            if (_safetyResult!.isSafe && _safetyResult!.safeSequence != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.green.shade50,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    const Text(
                      '安全序列: ',
                      style: TextStyle(fontWeight: FontWeight.bold),
                    ),
                    ..._safetyResult!.safeSequence!.map((i) {
                      final index = _safetyResult!.safeSequence!.indexOf(i);
                      return Row(
                        children: [
                          Chip(
                            label: Text(
                              _currentState!.processNames[i],
                              style: const TextStyle(color: Colors.white),
                            ),
                            backgroundColor: Colors.green,
                          ),
                          if (index < _safetyResult!.safeSequence!.length - 1)
                            const Padding(
                              padding: EdgeInsets.symmetric(horizontal: 4),
                              child: Icon(Icons.arrow_forward, size: 16),
                            ),
                        ],
                      );
                    }),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
  
  Widget _buildStepVisualization() {
    if (_safetyResult == null || _currentState == null) return const SizedBox.shrink();
    
    return Column(
      children: [
        // 播放控制
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.skip_previous),
                      onPressed: _currentStepIndex > 0 ? () {
                        setState(() => _currentStepIndex = 0);
                      } : null,
                    ),
                    IconButton(
                      icon: const Icon(Icons.navigate_before),
                      onPressed: _currentStepIndex > 0 ? () {
                        setState(() => _currentStepIndex--);
                      } : null,
                    ),
                    IconButton(
                      icon: Icon(_isPlaying ? Icons.pause : Icons.play_arrow),
                      onPressed: _isPlaying ? _pauseSteps : _playSteps,
                    ),
                    IconButton(
                      icon: const Icon(Icons.navigate_next),
                      onPressed: _currentStepIndex < _safetyResult!.steps.length - 1 ? () {
                        setState(() => _currentStepIndex++);
                      } : null,
                    ),
                    IconButton(
                      icon: const Icon(Icons.skip_next),
                      onPressed: () {
                        setState(() => _currentStepIndex = _safetyResult!.steps.length - 1);
                      },
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                LinearProgressIndicator(
                  value: (_currentStepIndex + 1) / _safetyResult!.steps.length,
                ),
                const SizedBox(height: 8),
                Text('步骤 ${_currentStepIndex + 1} / ${_safetyResult!.steps.length}'),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        
        // 当前步骤详情
        if (_currentStepIndex < _safetyResult!.steps.length)
          SafetyCheckStepVisualizer(
            step: _safetyResult!.steps[_currentStepIndex],
            state: _currentState!,
          ),
      ],
    );
  }
  
  void _showHelpDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('银行家算法帮助'),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '银行家算法：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 8),
              Text('银行家算法是一种避免死锁的算法，通过预先判断资源分配是否会导致系统进入不安全状态来决定是否分配资源。'),
              SizedBox(height: 16),
              Text(
                '核心概念：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 8),
              Text('• Max：每个进程的最大资源需求'),
              Text('• Allocation：当前已分配给进程的资源'),
              Text('• Need：进程还需要的资源（Need = Max - Allocation）'),
              Text('• Available：系统当前可用的资源'),
              SizedBox(height: 16),
              Text(
                '安全性检查：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 8),
              Text('1. 找出Need <= Work的进程'),
              Text('2. 假设该进程执行完毕，释放资源'),
              Text('3. 更新Work = Work + Allocation'),
              Text('4. 重复直到找到安全序列或确认不安全'),
              SizedBox(height: 16),
              Text(
                '资源请求处理：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 8),
              Text('1. 检查Request <= Need'),
              Text('2. 检查Request <= Available'),
              Text('3. 试探性分配资源'),
              Text('4. 执行安全性检查'),
              Text('5. 如果安全则真正分配，否则等待'),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('关闭'),
          ),
        ],
      ),
    );
  }
}
