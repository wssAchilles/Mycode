// 死锁模拟界面（银行家算法）- Academic Tech Dark 风格优化
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'dart:async';
import 'package:ml_platform/models/os/banker_model.dart';
import 'package:ml_platform/services/os/banker_service.dart';
import 'package:ml_platform/widgets/os/banker_algorithm_visualizer.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/widgets/common/glass_widgets.dart';

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
          backgroundColor: AppTheme.error,
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
        backgroundColor: result.success ? AppTheme.accent : AppTheme.error,
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
          backgroundColor: AppTheme.accent,
        ),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('输入格式错误: $e'),
          backgroundColor: AppTheme.error,
        ),
      );
    }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      body: Container(
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0.0, -0.2),
            radius: 1.5,
            colors: [
              Color(0xFF1E293B),
              Color(0xFF0F172A),
            ],
          ),
        ),
        child: Column(
          children: [
             _buildAppBar(),
             Expanded(
               child: LayoutBuilder(
                  builder: (context, constraints) {
                    final isDesktop = constraints.maxWidth > 900;
                    
                    if (isDesktop) {
                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(
                            width: 380,
                            child: SingleChildScrollView(
                               padding: const EdgeInsets.all(16),
                               child: _buildLeftPanel(),
                            ),
                          ),
                          Expanded(
                            child: SingleChildScrollView(
                              padding: const EdgeInsets.all(16),
                              child: _buildRightPanel(),
                            ),
                          ),
                        ],
                      );
                    } else {
                      return SingleChildScrollView(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          children: [
                            _buildLeftPanel(),
                            const SizedBox(height: 16),
                            _buildRightPanel(),
                          ],
                        ),
                      );
                    }
                  },
                ),
             )
          ],
        ),
      ),
    );
  }

  Widget _buildAppBar() {
     return GlassContainer(
        height: 60,
        width: double.infinity,
        borderRadius: BorderRadius.zero,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
             Row(
                children: [
                   IconButton(
                      icon: const Icon(Icons.arrow_back, color: AppTheme.textPrimary),
                      onPressed: () {
                         if (context.canPop()) {
                            context.pop();
                         } else {
                            context.go('/os'); // fallback
                         }
                      },
                      tooltip: '返回',
                   ),
                   const SizedBox(width: 8),
                   Text(
                      '死锁模拟 - 银行家算法',
                      style: AppTheme.darkTheme.textTheme.titleLarge?.copyWith(
                         fontWeight: FontWeight.bold,
                         letterSpacing: 1.0,
                      )
                   ),
                ],
             ),
             Row(
                children: [
                   IconButton(
                      icon: Icon(_isEditMode ? Icons.save : Icons.edit_note, color: AppTheme.textPrimary),
                      onPressed: _toggleEditMode,
                      tooltip: _isEditMode ? '保存' : '编辑状态',
                   ),
                   IconButton(
                      icon: const Icon(Icons.help_outline, color: AppTheme.secondary),
                      onPressed: () => _showHelpDialog(context),
                      tooltip: '帮助',
                   ),
                ],
             )
          ],
        ),
     );
  }

  Widget _buildLeftPanel() {
    return Column(
       children: [
          _buildExampleSelector(),
          const SizedBox(height: 16),
          if (_currentState != null) ...[
            ResourceRequestInput(
              key: ValueKey(_currentState!.resourceCount), 
              state: _currentState!,
              onRequest: _handleResourceRequest,
            ),
            const SizedBox(height: 24),
            _buildControlButtons(),
            const SizedBox(height: 16),
            if (_requestHistory.isNotEmpty)
              _buildRequestHistory(),
          ],
       ],
    );
  }
  
  Widget _buildRightPanel() {
     return Column(
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
              const SizedBox(height: 24),
              
              // 统计信息
              _buildStatistics(),
              
              // 安全性检查结果
              if (_safetyResult != null) ...[
                const SizedBox(height: 24),
                _buildSafetyResult(),
                const SizedBox(height: 16),
                _buildStepVisualization(),
              ],
            ],
        ],
     );
  }
  
  Widget _buildExampleSelector() {
    final examples = BankerExample.getExamples();
    
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '加载示例场景',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppTheme.textPrimary),
            ),
            const SizedBox(height: AppSpacing.md),
            Container(
              decoration: BoxDecoration(
                 border: Border.all(color: AppTheme.glassBorder),
                 borderRadius: BorderRadius.circular(12),
                 color: AppTheme.textPrimary.withOpacity(0.05),
              ),
              child: Column(
                 children: List.generate(examples.length, (index) {
                    final example = examples[index];
                    final isSelected = examples.indexOf(
                      examples.firstWhere((e) => 
                        e.state.processCount == _currentState?.processCount &&
                        e.state.resourceCount == _currentState?.resourceCount &&
                        // Simple check to see if it might be this one based on counts
                        // Exact match is hard since we can modify state
                        true
                        ,
                        orElse: () => examples[0],
                      ),
                    ) == index;
                    
                    return Semantics(
                      button: true,
                      selected: isSelected,
                      label: '${example.name}，${example.description}',
                      child: Tooltip(
                        message: example.description,
                        child: InkWell(
                          onTap: () => _loadExampleState(index),
                          child: Container(
                             padding: const EdgeInsets.all(AppSpacing.md),
                             decoration: BoxDecoration(
                                border: index < examples.length - 1 ? Border(bottom: BorderSide(color: AppTheme.glassBorder)) : null,
                                color: isSelected ? AppTheme.primary.withOpacity(0.1) : Colors.transparent,
                             ),
                             child: Row(
                                children: [
                                   Radio<int>(
                                      value: index,
                                      groupValue: -1, // Don't show radio selection state, use highlight
                                      onChanged: (v) => _loadExampleState(v!),
                                      activeColor: AppTheme.primary,
                                   ),
                                   Expanded(
                                      child: Column(
                                         crossAxisAlignment: CrossAxisAlignment.start,
                                         children: [
                                            Text(example.name, style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                                            Text(example.description, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                                         ],
                                      ),
                                   )
                                ],
                             ),
                          ),
                        ),
                      ),
                    );
                 }),
              ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildControlButtons() {
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            NeonButton(
              onPressed: _checkSafety,
              text: '执行安全性检查',
              icon: Icons.security,
              isPrimary: true,
              height: 50,
              width: double.infinity,
            ),
            const SizedBox(height: 16),
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
                    icon: const Icon(Icons.check_circle, color: AppTheme.accent),
                    label: const Text('安全重置'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.accent,
                      side: const BorderSide(color: AppTheme.accent),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
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
                    icon: const Icon(Icons.warning, color: AppTheme.error),
                    label: const Text('死锁重置'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.error,
                      side: const BorderSide(color: AppTheme.error),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
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
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '请求历史',
              style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary, fontSize: 16),
            ),
            const SizedBox(height: 12),
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: _requestHistory.length > 5 ? 5 : _requestHistory.length,
              itemBuilder: (context, index) {
                final result = _requestHistory[_requestHistory.length - 1 - index];
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8.0),
                  child: Row(
                    children: [
                      Icon(
                        result.success ? Icons.check_circle : Icons.block,
                        color: result.success ? AppTheme.accent : AppTheme.error,
                        size: 16,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          result.message,
                          style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                        ),
                      ),
                    ],
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
    
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '编辑矩阵（Max | Allocation）',
              style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary, fontSize: 16),
            ),
            const SizedBox(height: 20),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Table(
                defaultColumnWidth: const FixedColumnWidth(60),
                children: [
                  // 表头
                  TableRow(
                    decoration: BoxDecoration(color: AppTheme.textPrimary.withOpacity(0.05)),
                    children: [
                      const Padding(padding: EdgeInsets.all(8), child: Text('Prog', style: TextStyle(color: AppTheme.textPrimary))),
                      ..._currentState!.resourceNames.map((name) => 
                        Padding(padding: const EdgeInsets.all(8), child: Text(name, textAlign: TextAlign.center, style: const TextStyle(color: AppTheme.primary, fontWeight: FontWeight.bold)))),
                      const Padding(padding: EdgeInsets.all(8), child: Text('|', textAlign: TextAlign.center, style: TextStyle(color: AppTheme.textSecondary))),
                      ..._currentState!.resourceNames.map((name) => 
                        Padding(padding: const EdgeInsets.all(8), child: Text(name, textAlign: TextAlign.center, style: const TextStyle(color: AppTheme.secondary, fontWeight: FontWeight.bold)))),
                    ],
                  ),
                  // 数据行
                  ...List.generate(_currentState!.processCount, (i) {
                    return TableRow(
                      children: [
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
                          child: Text(_currentState!.processNames[i], style: const TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.bold)),
                        ),
                        // Max矩阵
                        ...List.generate(_currentState!.resourceCount, (j) {
                          return Padding(
                            padding: const EdgeInsets.all(2),
                            child: TextField(
                              controller: _maxControllers[i][j],
                              textAlign: TextAlign.center,
                              keyboardType: TextInputType.number,
                              style: const TextStyle(color: AppTheme.textPrimary, fontFamily: AppTheme.codeFont),
                              decoration: InputDecoration(
                                isDense: true,
                                contentPadding: const EdgeInsets.all(8),
                                border: OutlineInputBorder(borderSide: BorderSide(color: AppTheme.glassBorder)),
                                enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: AppTheme.glassBorder)),
                                focusedBorder: const OutlineInputBorder(borderSide: BorderSide(color: AppTheme.primary)),
                                filled: true,
                                fillColor: AppTheme.textPrimary.withOpacity(0.05),
                              ),
                            ),
                          );
                        }),
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 12),
                          child: Text('|', textAlign: TextAlign.center, style: TextStyle(color: AppTheme.textSecondary)),
                        ),
                        // Allocation矩阵
                        ...List.generate(_currentState!.resourceCount, (j) {
                          return Padding(
                            padding: const EdgeInsets.all(2),
                            child: TextField(
                              controller: _allocationControllers[i][j],
                              textAlign: TextAlign.center,
                              keyboardType: TextInputType.number,
                              style: const TextStyle(color: AppTheme.textPrimary, fontFamily: AppTheme.codeFont),
                              decoration: InputDecoration(
                                isDense: true,
                                contentPadding: const EdgeInsets.all(8),
                                border: OutlineInputBorder(borderSide: BorderSide(color: AppTheme.glassBorder)),
                                enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: AppTheme.glassBorder)),
                                focusedBorder: const OutlineInputBorder(borderSide: BorderSide(color: AppTheme.secondary)),
                                filled: true,
                                fillColor: AppTheme.textPrimary.withOpacity(0.05),
                              ),
                            ),
                          );
                        }),
                      ],
                    );
                  }),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildEditableAvailable() {
    if (_currentState == null) return const SizedBox.shrink();
    
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '编辑Available向量',
              style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary, fontSize: 16),
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
                        labelStyle: const TextStyle(color: AppTheme.textSecondary),
                        border: const OutlineInputBorder(),
                        enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: AppTheme.glassBorder)),
                        focusedBorder: const OutlineInputBorder(borderSide: BorderSide(color: AppTheme.accent)),
                        filled: true,
                        fillColor: AppTheme.textPrimary.withOpacity(0.05),
                      ),
                      style: const TextStyle(color: AppTheme.textPrimary, fontFamily: AppTheme.codeFont, fontSize: 18),
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
    
    return Row(
      children: [
        Expanded(child: _buildStatItem('总资源', '${stats.totalResources}', Icons.inventory, AppTheme.primary)),
        const SizedBox(width: 8),
        Expanded(child: _buildStatItem('已分配', '${stats.allocatedResources}', Icons.lock, AppTheme.secondary)),
        const SizedBox(width: 8),
        Expanded(child: _buildStatItem('可用', '${stats.availableResources}', Icons.lock_open, AppTheme.accent)),
        const SizedBox(width: 8),
        Expanded(child: _buildStatItem('利用率', '${(stats.utilizationRate * 100).toStringAsFixed(1)}%', Icons.pie_chart, AppTheme.secondary)),
      ],
    );
  }
  
  Widget _buildStatItem(String label, String value, IconData icon, Color color) {
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
        child: Column(
          children: [
            Icon(icon, color: color, size: 24),
            const SizedBox(height: 8),
            Text(
              value,
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: AppTheme.textPrimary,
                fontFamily: AppTheme.codeFont,
              ),
            ),
            const SizedBox(height: 4),
            Text(label, style: TextStyle(fontSize: 12, color: color)),
          ],
        ),
      ),
    );
  }
  
  Widget _buildSafetyResult() {
    if (_safetyResult == null) return const SizedBox.shrink();
    
    final isSafe = _safetyResult!.isSafe;
    final color = isSafe ? AppTheme.accent : AppTheme.error;
    
    return GlassCard(
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          border: Border(left: BorderSide(color: color, width: 4)),
        ),
        child: Column(
          children: [
            Row(
              children: [
                Icon(
                  isSafe ? Icons.check_circle : Icons.warning,
                  color: color,
                  size: 32,
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Text(
                    _safetyResult!.message,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: color,
                    ),
                  ),
                ),
              ],
            ),
            if (isSafe && _safetyResult!.safeSequence != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    const Text(
                      '安全序列: ',
                      style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                    ),
                    Expanded(
                      child: Wrap(
                        spacing: 8,
                        children: [
                           ..._safetyResult!.safeSequence!.map((i) {
                            final index = _safetyResult!.safeSequence!.indexOf(i);
                            return Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  _currentState!.processNames[i],
                                  style: TextStyle(color: color, fontWeight: FontWeight.bold),
                                ),
                                if (index < _safetyResult!.safeSequence!.length - 1)
                                  Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 4),
                                    child: Icon(Icons.arrow_right_alt, size: 16, color: color.withOpacity(0.7)),
                                  ),
                              ],
                            );
                          }),
                        ],
                      ),
                    )
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
    
    final currentStep = _safetyResult!.steps[_currentStepIndex];
    
    return Column(
      children: [
        SafetyCheckStepVisualizer(
          step: currentStep, 
          state: _currentState!
        ),
        const SizedBox(height: 16),
        GlassCard(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.first_page, color: AppTheme.textPrimary),
                      onPressed: _currentStepIndex > 0 ? () {
                        setState(() => _currentStepIndex = 0);
                      } : null,
                      tooltip: '回到开始',
                    ),
                    IconButton(
                      icon: const Icon(Icons.navigate_before, color: AppTheme.textPrimary),
                      onPressed: _currentStepIndex > 0 ? () {
                        setState(() => _currentStepIndex--);
                      } : null,
                      tooltip: '上一步',
                    ),
                    FloatingActionButton.small(
                      backgroundColor: AppTheme.primary,
                      onPressed: _isPlaying ? _pauseSteps : _playSteps,
                      child: Icon(_isPlaying ? Icons.pause : Icons.play_arrow),
                    ),
                    IconButton(
                      icon: const Icon(Icons.navigate_next, color: AppTheme.textPrimary),
                      onPressed: _currentStepIndex < _safetyResult!.steps.length - 1 ? () {
                        setState(() => _currentStepIndex++);
                      } : null,
                      tooltip: '下一步',
                    ),
                    IconButton(
                      icon: const Icon(Icons.last_page, color: AppTheme.textPrimary),
                      onPressed: () {
                        setState(() => _currentStepIndex = _safetyResult!.steps.length - 1);
                      },
                      tooltip: '跳到末尾',
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                ClipRRect(
                  borderRadius: BorderRadius.circular(2),
                  child: LinearProgressIndicator(
                    value: (_currentStepIndex + 1) / _safetyResult!.steps.length,
                    backgroundColor: AppTheme.textPrimary.withOpacity(0.1),
                    valueColor: AlwaysStoppedAnimation<Color>(AppTheme.primary),
                    minHeight: 4,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '步骤 ${_currentStepIndex + 1} / ${_safetyResult!.steps.length}',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 10),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  void _showHelpDialog(BuildContext context) {
     showDialog(
        context: context,
        builder: (context) => AlertDialog(
           backgroundColor: AppTheme.surface,
           title: const Text('银行家算法说明', style: TextStyle(color: AppTheme.textPrimary)),
           content: const SingleChildScrollView(
              child: Text(
                 '银行家算法是一种避免死锁的算法。它在进程请求资源时，判断分配后系统是否处于安全状态。如果处于安全状态，则分配；否则推迟分配。\n\n'
                 '1. Max矩阵：进程需要的最大资源数\n'
                 '2. Allocation矩阵：进程当前已持有的资源数\n'
                 '3. Need矩阵：Max - Allocation，进程还需要的资源数\n'
                 '4. Available向量：系统中当前可用的资源数\n\n'
                 '安全状态：存在一个进程序列，使得每个进程都能获取所需资源并执行结束，释放资源供下一个进程使用。',
                 style: TextStyle(color: AppTheme.textSecondary),
              ),
           ),
           actions: [
              TextButton(onPressed: () => Navigator.pop(context), child: const Text('了解', style: TextStyle(color: AppTheme.primary))),
           ],
        ),
     );
  }
}
