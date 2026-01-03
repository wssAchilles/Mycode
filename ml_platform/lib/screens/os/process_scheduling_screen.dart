// 进程调度交互界面 - Academic Tech Dark 风格优化
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ml_platform/models/os/process_model.dart';
import 'package:ml_platform/services/os/scheduler_service.dart';
import 'package:ml_platform/utils/validators.dart';
import 'package:ml_platform/utils/error_handler.dart';
import 'package:ml_platform/widgets/os/gantt_chart_visualizer.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/widgets/common/glass_widgets.dart';

class ProcessSchedulingScreen extends StatefulWidget {
  const ProcessSchedulingScreen({Key? key}) : super(key: key);
  
  @override
  State<ProcessSchedulingScreen> createState() => _ProcessSchedulingScreenState();
}

class _ProcessSchedulingScreenState extends State<ProcessSchedulingScreen>
    with TickerProviderStateMixin {
  final SchedulerService _schedulerService = SchedulerService();
  late AnimationController _animationController;
  late AnimationController _stepAnimationController;
  
  // 进程列表
  List<Process> _processes = [];
  
  // 调度结果
  SchedulingResult? _result;
  
  // 当前选择的算法
  SchedulingAlgorithm _selectedAlgorithm = SchedulingAlgorithm.fcfs;
  
  // 配置参数
  int _timeQuantum = 2;
  bool _isPreemptive = false;
  
  // 动画相关
  int _currentTime = 0;
  bool _isPlaying = false;
  
  // 输入控制器
  final _arrivalTimeController = TextEditingController();
  final _burstTimeController = TextEditingController();
  final _priorityController = TextEditingController();
  
  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    )..repeat();
    
    _stepAnimationController = AnimationController(
      duration: const Duration(milliseconds: 300),
      vsync: this,
    );
    
    // 生成示例进程
    _generateSampleProcesses();
  }
  
  @override
  void dispose() {
    _animationController.dispose();
    _stepAnimationController.dispose();
    _arrivalTimeController.dispose();
    _burstTimeController.dispose();
    _priorityController.dispose();
    super.dispose();
  }
  
  void _generateSampleProcesses() {
    setState(() {
      _processes = _schedulerService.generateSampleProcesses(count: 5);
      _result = null;
      _currentTime = 0;
      _isPlaying = false;
    });
  }
  
  void _addProcess() {
    // 使用Validators进行验证
    final burstTimeError = Validators.validatePositiveInteger(
      _burstTimeController.text,
      fieldName: '服务时间',
      max: 100,
    );
    if (burstTimeError != null) {
      ErrorHandler.showWarning(context, burstTimeError);
      return;
    }
    
    final arrivalTimeError = Validators.validateNonNegativeInteger(
      _arrivalTimeController.text,
      fieldName: '到达时间',
      max: 50,
    );
    if (arrivalTimeError != null) {
      ErrorHandler.showWarning(context, arrivalTimeError);
      return;
    }
    
    final priorityError = Validators.validateNonNegativeInteger(
      _priorityController.text,
      fieldName: '优先级',
      max: 10,
    );
    if (priorityError != null) {
      ErrorHandler.showWarning(context, priorityError);
      return;
    }
    
    // 检查进程数限制
    if (_processes.length >= 20) {
      ErrorHandler.showWarning(context, '进程数不能超过20个，当前: ${_processes.length}');
      return;
    }
    
    final burstTime = int.parse(_burstTimeController.text);
    final arrivalTime = int.parse(_arrivalTimeController.text);
    final priority = int.parse(_priorityController.text);
    
    setState(() {
      final newPid = (_processes.isEmpty ? 0 : _processes.map((p) => p.pid).reduce((a, b) => a > b ? a : b)) + 1;
      _processes.add(Process(
        pid: newPid,
        arrivalTime: arrivalTime,
        burstTime: burstTime,
        priority: priority,
      ));
      _result = null;
    });
    
    // 清空输入框
    _arrivalTimeController.clear();
    _burstTimeController.clear();
    _priorityController.clear();
  }
  
  void _removeProcess(int pid) {
    setState(() {
      _processes.removeWhere((p) => p.pid == pid);
      _result = null;
    });
  }
  
  void _executeScheduling() {
    if (_processes.isEmpty) {
      ErrorHandler.showWarning(context, '请先添加进程后再执行调度算法');
      return;
    }
    
    setState(() {
      _result = _schedulerService.executeScheduling(
        processes: _processes,
        algorithm: _selectedAlgorithm,
        config: SchedulingConfig(
          timeQuantum: _timeQuantum,
          isPreemptive: _isPreemptive,
        ),
      );
      _currentTime = 0;
      _isPlaying = false;
    });
  }
  
  void _playAnimation() async {
    if (_result == null) return;
    
    setState(() => _isPlaying = true);
    
    for (int t = _currentTime; t <= _result!.totalTime; t++) {
      if (!mounted || !_isPlaying) break;
      
      setState(() => _currentTime = t);
      _stepAnimationController.forward(from: 0);
      
      await Future.delayed(const Duration(milliseconds: 500));
    }
    
    setState(() => _isPlaying = false);
  }
  
  void _pauseAnimation() {
    setState(() => _isPlaying = false);
  }
  
  void _resetAnimation() {
    setState(() {
      _currentTime = 0;
      _isPlaying = false;
    });
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Scaffold(
      backgroundColor: AppTheme.background,
      body: Container(
         decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0.0, -0.2),
            radius: 1.5,
            colors: [
              Color(0xFF1E293B), // Slate 800 - Lighter center
              Color(0xFF0F172A), // Slate 900 - Darker edges
            ],
          ),
        ),
        child: Column(
          children: [
            _buildAppBar(),
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final isDesktop = constraints.maxWidth > 1000;
                  
                  if (isDesktop) {
                    return Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(
                          width: 400,
                          child: SingleChildScrollView(
                            padding: const EdgeInsets.all(16),
                            child: _buildLeftPanel(theme),
                          ),
                        ),
                        Expanded(
                          child: SingleChildScrollView(
                            padding: const EdgeInsets.all(16),
                            child: _buildRightPanel(theme),
                          ),
                        ),
                      ],
                    );
                  } else {
                    return SingleChildScrollView(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: [
                           _buildLeftPanel(theme),
                           const SizedBox(height: 24),
                           _buildRightPanel(theme),
                        ],
                      ),
                    );
                  }
                },
              ),
            ),
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
                icon: const Icon(Icons.arrow_back, color: Colors.white),
                onPressed: () {
                  if (context.canPop()) {
                    context.pop();
                  } else {
                    context.go('/os'); // Assumed route
                  }
                },
              ),
              const SizedBox(width: 8),
              Text(
                '进程调度模拟',
                style: AppTheme.darkTheme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.2,
                ),
              ),
            ],
          ),
          IconButton(
            icon: Icon(Icons.help_outline, color: AppTheme.primary),
            onPressed: () => _showHelpDialog(context),
            tooltip: '帮助',
          ),
        ],
      ),
    );
  }
  
  Widget _buildLeftPanel(ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionTitle('配置区', Icons.settings),
        const SizedBox(height: 12),
        _buildProcessInputSection(theme),
        const SizedBox(height: 24),
        _buildSectionTitle('算法选择', Icons.analytics),
        const SizedBox(height: 12),
        _buildAlgorithmSelectionSection(theme),
        const SizedBox(height: 24),
        _buildControlButtons(theme),
        const SizedBox(height: 24),
        _buildProcessListSection(theme),
      ],
    );
  }
  
  Widget _buildRightPanel(ThemeData theme) {
     return Column(
       crossAxisAlignment: CrossAxisAlignment.start,
       children: [
         if (_result != null) ...[
            _buildSectionTitle('实时可视化', Icons.show_chart),
            const SizedBox(height: 12),
            GanttChartVisualizer(
              result: _result!,
              animationController: _animationController,
              currentTime: _currentTime,
              height: 300,
            ),
            const SizedBox(height: 16),
             GlassCard(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: _buildPlaybackControls(theme),
              ),
            ),
            const SizedBox(height: 24),
            _buildSectionTitle('数据统计', Icons.data_usage),
            const SizedBox(height: 12),
            _buildPerformanceMetrics(theme),
         ] else 
            Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const SizedBox(height: 100),
                  Icon(Icons.monitor_heart_outlined, size: 80, color: AppTheme.primary.withOpacity(0.3)),
                  const SizedBox(height: 16),
                  Text(
                    '请配置进程并开始调度',
                    style: TextStyle(color: AppTheme.textSecondary, fontSize: 16),
                  ),
                ],
              ),
            )
       ],
     );
  }

  Widget _buildSectionTitle(String title, IconData icon) {
    return Row(
      children: [
        Icon(icon, color: AppTheme.secondary, size: 20),
        const SizedBox(width: 8),
        Text(
          title,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.bold,
            color: Colors.white,
            letterSpacing: 0.5,
          ),
        ),
      ],
    );
  }
  
  Widget _buildProcessInputSection(ThemeData theme) {
    return GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _arrivalTimeController,
                  style: const TextStyle(color: Colors.white, fontFamily: AppTheme.codeFont),
                  decoration: const InputDecoration(
                    labelText: '到达时间',
                    prefixIcon: Icon(Icons.login),
                  ),
                  keyboardType: TextInputType.number,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _burstTimeController,
                  style: const TextStyle(color: Colors.white, fontFamily: AppTheme.codeFont),
                  decoration: const InputDecoration(
                    labelText: '服务时间',
                    prefixIcon: Icon(Icons.timer),
                  ),
                  keyboardType: TextInputType.number,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _priorityController,
            style: const TextStyle(color: Colors.white, fontFamily: AppTheme.codeFont),
            decoration: const InputDecoration(
              labelText: '优先级 (越小越高)',
              prefixIcon: Icon(Icons.priority_high),
            ),
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => _addProcess(),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: NeonButton(
                  onPressed: _addProcess,
                  text: '添加进程',
                  icon: Icons.add,
                  height: 44,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _generateSampleProcesses,
                  icon: const Icon(Icons.auto_awesome),
                  label: const Text('随机示例'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.accent,
                    side: const BorderSide(color: AppTheme.accent),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
  
  Widget _buildProcessListSection(ThemeData theme) {
    return GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '进程队列',
                style: AppTheme.darkTheme.textTheme.titleMedium,
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: AppTheme.primary.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '${_processes.length}',
                  style: TextStyle(color: AppTheme.primary, fontSize: 12),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          
          if (_processes.isEmpty)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(24.0),
                child: Text('暂无数据', style: TextStyle(color: AppTheme.textSecondary)),
              ),
            )
          else
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                headingRowHeight: 40,
                dataRowHeight: 48,
                columnSpacing: 20,
                
                columns: const [
                  DataColumn(label: Text('PID', style: TextStyle(color: AppTheme.textSecondary))),
                  DataColumn(label: Text('Arrival', style: TextStyle(color: AppTheme.textSecondary))),
                  DataColumn(label: Text('Burst', style: TextStyle(color: AppTheme.textSecondary))),
                  DataColumn(label: Text('Priority', style: TextStyle(color: AppTheme.textSecondary))),
                  DataColumn(label: Text('Action', style: TextStyle(color: AppTheme.textSecondary))),
                ],
                rows: _processes.map((process) {
                  return DataRow(
                    cells: [
                      DataCell(Text('P${process.pid}', style: const TextStyle(fontWeight: FontWeight.bold))),
                      DataCell(Text('${process.arrivalTime}', style: const TextStyle(fontFamily: AppTheme.codeFont))),
                      DataCell(Text('${process.burstTime}', style: const TextStyle(fontFamily: AppTheme.codeFont))),
                      DataCell(Text('${process.priority}', style: const TextStyle(fontFamily: AppTheme.codeFont))),
                      DataCell(
                        IconButton(
                          icon: Icon(Icons.delete_outline, size: 18, color: AppTheme.error.withOpacity(0.8)),
                          onPressed: () => _removeProcess(process.pid),
                          splashRadius: 20,
                        ),
                      ),
                    ],
                  );
                }).toList(),
              ),
            ),
        ],
      ),
    );
  }
  
  Widget _buildAlgorithmSelectionSection(ThemeData theme) {
    return GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 算法选择 Switcher
          Container(
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(
              color: AppTheme.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.glassBorder),
            ),
            child: Row(
               children: SchedulingAlgorithm.values.map((algo) {
                 final isSelected = _selectedOperation(algo);
                 return Expanded(
                   child: GestureDetector(
                     onTap: () {
                        setState(() {
                          _selectedAlgorithm = algo;
                          _result = null;
                        });
                     },
                     child: AnimatedContainer(
                       duration: const Duration(milliseconds: 200),
                       padding: const EdgeInsets.symmetric(vertical: 10),
                       decoration: BoxDecoration(
                         color: isSelected ? AppTheme.primary.withOpacity(0.2) : Colors.transparent,
                         borderRadius: BorderRadius.circular(8),
                         border: Border.all(
                           color: isSelected ? AppTheme.primary.withOpacity(0.5) : Colors.transparent,
                         ),
                       ),
                       child: Center(
                         child: Text(
                           algo.shortName, 
                           style: TextStyle(
                             color: isSelected ? AppTheme.primary : AppTheme.textSecondary,
                             fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                             fontSize: 12,
                           ),
                         ),
                       ),
                     ),
                   ),
                 );
               }).toList(),
            ),
          ),
          
          // 算法参数
          const SizedBox(height: 16),
          if (_selectedAlgorithm == SchedulingAlgorithm.rr) ...[
            Row(
              children: [
                const Text('时间片:', style: TextStyle(color: AppTheme.textSecondary)),
                Expanded(
                  child: SliderTheme(
                    data: SliderTheme.of(context).copyWith(
                      activeTrackColor: AppTheme.primary,
                      inactiveTrackColor: AppTheme.primary.withOpacity(0.2),
                      thumbColor: AppTheme.primary,
                      overlayColor: AppTheme.primary.withOpacity(0.1),
                    ),
                    child: Slider(
                      value: _timeQuantum.toDouble(),
                      min: 1,
                      max: 10,
                      divisions: 9,
                      label: '$_timeQuantum',
                      onChanged: (value) {
                        setState(() {
                          _timeQuantum = value.toInt();
                          _result = null;
                        });
                      },
                    ),
                  ),
                ),
                Container(
                  width: 50,
                  alignment: Alignment.center,
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  decoration: BoxDecoration(
                    border: Border.all(color: AppTheme.primary),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '$_timeQuantum ms',
                    style: TextStyle(color: AppTheme.primary, fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
          ],
          
          if (_selectedAlgorithm == SchedulingAlgorithm.sjf ||
              _selectedAlgorithm == SchedulingAlgorithm.priority) ...[
            Row(
              children: [
                Checkbox(
                  value: _isPreemptive,
                  activeColor: AppTheme.primary,
                  onChanged: (value) {
                    setState(() {
                      _isPreemptive = value ?? false;
                      _result = null;
                    });
                  },
                ),
                const Text('启用抢占 (Preemptive)'),
              ],
            ),
          ],
        ],
      ),
    );
  }
  
  bool _selectedOperation(SchedulingAlgorithm algo) => _selectedAlgorithm == algo;

  Widget _buildControlButtons(ThemeData theme) {
    return NeonButton(
      onPressed: _processes.isEmpty ? () {} : _executeScheduling,
      text: '开始模拟',
      icon: Icons.play_arrow,
      isPrimary: !_processes.isEmpty, // Disable glow when no processes
      isLoading: false,
      height: 56,
      width: double.infinity,
    );
  }
  
  Widget _buildPerformanceMetrics(ThemeData theme) {
    if (_result == null) return const SizedBox.shrink();
    
    return Column(
      children: [
        Row(
          children: [
            Expanded(child: _buildMetricCard('等待时间', '${_result!.averageWaitingTime.toStringAsFixed(2)} ms', Icons.timer, Colors.blue)),
            const SizedBox(width: 12),
            Expanded(child: _buildMetricCard('周转时间', '${_result!.averageTurnaroundTime.toStringAsFixed(2)} ms', Icons.rotate_right, Colors.green)),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(child: _buildMetricCard('CPU利用率', '${(_result!.cpuUtilization * 100).toStringAsFixed(1)}%', Icons.speed, Colors.orange)),
            const SizedBox(width: 12),
            Expanded(child: _buildMetricCard('上下文切换', '${_result!.contextSwitches} 次', Icons.swap_horiz, Colors.purple)),
          ],
        ),
      ],
    );
  }
  
  Widget _buildMetricCard(String label, String value, IconData icon, Color color) {
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: color.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(icon, color: color, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    label,
                    style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    value,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      fontFamily: AppTheme.codeFont,
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildPlaybackControls(ThemeData theme) {
    return Column(
      children: [
        Row(
           mainAxisAlignment: MainAxisAlignment.center,
           children: [
              IconButton(onPressed: _resetAnimation, icon: const Icon(Icons.skip_previous, color: Colors.white)),
              const SizedBox(width: 16),
              FloatingActionButton(
                onPressed: _isPlaying ? _pauseAnimation : _playAnimation,
                backgroundColor: AppTheme.primary,
                child: Icon(_isPlaying ? Icons.pause : Icons.play_arrow),
              ),
              const SizedBox(width: 16),
              // We could add play speed here
           ],
        ),
        const SizedBox(height: 16),
        Row(
          children: [
             Text('0', style: TextStyle(color: AppTheme.textSecondary, fontSize: 10)),
             Expanded(
               child: SliderTheme(
                 data: SliderTheme.of(context).copyWith(
                    activeTrackColor: AppTheme.accent,
                    thumbColor: AppTheme.accent,
                 ),
                 child: Slider(
                   value: _currentTime.toDouble(),
                   min: 0,
                   max: _result!.totalTime.toDouble(),
                   onChanged: !_isPlaying ? (value) {
                     setState(() => _currentTime = value.toInt());
                   } : null,
                 ),
               ),
             ),
             Text('${_result!.totalTime}', style: TextStyle(color: AppTheme.textSecondary, fontSize: 10)),
          ],
        )
      ],
    );
  }
  
  void _showHelpDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.surface,
        title: Text('进程调度算法说明', style: TextStyle(color: AppTheme.primary)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildHelpItem('FCFS', '先来先服务'),
            _buildHelpItem('SJF', '短作业优先 (Shortest Job First)'),
            _buildHelpItem('Priority', '优先级调度 (值越小优先级越高)'),
            _buildHelpItem('RR', '时间片轮转 (Round Robin)'),
            Divider(color: AppTheme.glassBorder, height: 24),
            Text('提示: 使用随机生成功能快速体验效果。', style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
          ],
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
  
  Widget _buildHelpItem(String title, String desc) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 60,
            child: Text(title, style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white)),
          ),
          Expanded(
            child: Text(desc, style: TextStyle(color: AppTheme.textSecondary)),
          ),
        ],
      ),
    );
  }
}
