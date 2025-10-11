// 进程调度交互界面
import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:ml_platform/models/os/process_model.dart';
import 'package:ml_platform/services/os/scheduler_service.dart';
import 'package:ml_platform/widgets/os/gantt_chart_visualizer.dart';

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
    final arrivalTime = int.tryParse(_arrivalTimeController.text) ?? 0;
    final burstTime = int.tryParse(_burstTimeController.text) ?? 1;
    final priority = int.tryParse(_priorityController.text) ?? 0;
    
    if (burstTime <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('服务时间必须大于0')),
      );
      return;
    }
    
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
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请先添加进程')),
      );
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
      appBar: AppBar(
        title: const Text('进程调度模拟器'),
        actions: [
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
            width: 380,
            padding: const EdgeInsets.all(16),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildProcessInputSection(theme),
                  const SizedBox(height: 16),
                  _buildProcessListSection(theme),
                  const SizedBox(height: 16),
                  _buildAlgorithmSelectionSection(theme),
                  const SizedBox(height: 16),
                  _buildControlButtons(theme),
                ],
              ),
            ),
          ),
          
          // 右侧可视化区域
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  // 甘特图
                  if (_result != null)
                    Expanded(
                      flex: 2,
                      child: GanttChartVisualizer(
                        result: _result!,
                        animationController: _animationController,
                        currentTime: _currentTime,
                        height: 250,
                      ),
                    ),
                  
                  const SizedBox(height: 16),
                  
                  // 性能指标
                  if (_result != null)
                    Expanded(
                      flex: 1,
                      child: _buildPerformanceMetrics(theme),
                    ),
                  
                  // 播放控制
                  if (_result != null)
                    Container(
                      padding: const EdgeInsets.all(16),
                      child: _buildPlaybackControls(theme),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildProcessInputSection(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '添加进程',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _arrivalTimeController,
                    decoration: const InputDecoration(
                      labelText: '到达时间',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                    keyboardType: TextInputType.number,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _burstTimeController,
                    decoration: const InputDecoration(
                      labelText: '服务时间',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                    keyboardType: TextInputType.number,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _priorityController,
                    decoration: const InputDecoration(
                      labelText: '优先级',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                    keyboardType: TextInputType.number,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _addProcess,
                    icon: const Icon(Icons.add),
                    label: const Text('添加进程'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _generateSampleProcesses,
                    icon: const Icon(Icons.auto_awesome),
                    label: const Text('生成示例'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildProcessListSection(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '进程列表',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  '${_processes.length} 个进程',
                  style: theme.textTheme.bodySmall,
                ),
              ],
            ),
            const SizedBox(height: 12),
            
            if (_processes.isEmpty)
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Colors.grey.shade100,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Center(
                  child: Text('暂无进程'),
                ),
              )
            else
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: DataTable(
                  columns: const [
                    DataColumn(label: Text('PID')),
                    DataColumn(label: Text('到达')),
                    DataColumn(label: Text('服务')),
                    DataColumn(label: Text('优先级')),
                    DataColumn(label: Text('操作')),
                  ],
                  rows: _processes.map((process) {
                    return DataRow(
                      cells: [
                        DataCell(Text('P${process.pid}')),
                        DataCell(Text('${process.arrivalTime}')),
                        DataCell(Text('${process.burstTime}')),
                        DataCell(Text('${process.priority}')),
                        DataCell(
                          IconButton(
                            icon: const Icon(Icons.delete, size: 20),
                            onPressed: () => _removeProcess(process.pid),
                          ),
                        ),
                      ],
                    );
                  }).toList(),
                ),
              ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildAlgorithmSelectionSection(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '调度算法',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            
            // 算法选择
            SegmentedButton<SchedulingAlgorithm>(
              segments: SchedulingAlgorithm.values.map((algo) {
                return ButtonSegment(
                  value: algo,
                  label: Text(algo.shortName),
                  tooltip: algo.label,
                );
              }).toList(),
              selected: {_selectedAlgorithm},
              onSelectionChanged: (selected) {
                setState(() {
                  _selectedAlgorithm = selected.first;
                  _result = null;
                });
              },
            ),
            
            // 算法参数
            if (_selectedAlgorithm == SchedulingAlgorithm.rr) ...[
              const SizedBox(height: 16),
              Row(
                children: [
                  const Text('时间片大小:'),
                  const SizedBox(width: 16),
                  Expanded(
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
                  Chip(label: Text('$_timeQuantum ms')),
                ],
              ),
            ],
            
            if (_selectedAlgorithm == SchedulingAlgorithm.sjf ||
                _selectedAlgorithm == SchedulingAlgorithm.priority) ...[
              const SizedBox(height: 16),
              CheckboxListTile(
                title: const Text('抢占式'),
                value: _isPreemptive,
                onChanged: (value) {
                  setState(() {
                    _isPreemptive = value ?? false;
                    _result = null;
                  });
                },
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding: EdgeInsets.zero,
              ),
            ],
          ],
        ),
      ),
    );
  }
  
  Widget _buildControlButtons(ThemeData theme) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: _processes.isEmpty ? null : _executeScheduling,
        icon: const Icon(Icons.play_arrow),
        label: const Text('执行调度'),
        style: ElevatedButton.styleFrom(
          padding: const EdgeInsets.all(16),
        ),
      ),
    );
  }
  
  Widget _buildPerformanceMetrics(ThemeData theme) {
    if (_result == null) return const SizedBox.shrink();
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            // 左侧：性能指标
            Expanded(
              flex: 2,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '性能指标',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Expanded(
                    child: GridView.count(
                      crossAxisCount: 2,
                      childAspectRatio: 2.5,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                      children: [
                        _buildMetricCard(
                          '平均等待时间',
                          '${_result!.averageWaitingTime.toStringAsFixed(2)} ms',
                          Icons.timer,
                          Colors.blue,
                        ),
                        _buildMetricCard(
                          '平均周转时间',
                          '${_result!.averageTurnaroundTime.toStringAsFixed(2)} ms',
                          Icons.rotate_right,
                          Colors.green,
                        ),
                        _buildMetricCard(
                          'CPU利用率',
                          '${(_result!.cpuUtilization * 100).toStringAsFixed(1)}%',
                          Icons.speed,
                          Colors.orange,
                        ),
                        _buildMetricCard(
                          '上下文切换',
                          '${_result!.contextSwitches} 次',
                          Icons.swap_horiz,
                          Colors.purple,
                        ),
                        _buildMetricCard(
                          '平均响应时间',
                          '${_result!.averageResponseTime.toStringAsFixed(2)} ms',
                          Icons.access_time,
                          Colors.teal,
                        ),
                        _buildMetricCard(
                          '吞吐量',
                          '${(_result!.throughput * 1000).toStringAsFixed(2)} /s',
                          Icons.trending_up,
                          Colors.red,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            
            const VerticalDivider(),
            
            // 右侧：进程详细信息
            Expanded(
              flex: 1,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '进程详情',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Expanded(
                    child: SingleChildScrollView(
                      child: DataTable(
                        columns: const [
                          DataColumn(label: Text('进程')),
                          DataColumn(label: Text('等待')),
                          DataColumn(label: Text('周转')),
                        ],
                        rows: _result!.processes
                            .where((p) => p.state == ProcessState.terminated)
                            .map((p) {
                          return DataRow(
                            cells: [
                              DataCell(Text('P${p.pid}')),
                              DataCell(Text('${p.waitingTime}')),
                              DataCell(Text('${p.turnaroundTime}')),
                            ],
                          );
                        }).toList(),
                      ),
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
  
  Widget _buildMetricCard(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  label,
                  style: const TextStyle(fontSize: 11),
                ),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildPlaybackControls(ThemeData theme) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        IconButton(
          icon: const Icon(Icons.replay),
          onPressed: _resetAnimation,
          tooltip: '重置',
        ),
        const SizedBox(width: 8),
        IconButton(
          icon: Icon(_isPlaying ? Icons.pause : Icons.play_arrow),
          onPressed: _isPlaying ? _pauseAnimation : _playAnimation,
          tooltip: _isPlaying ? '暂停' : '播放',
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Slider(
            value: _currentTime.toDouble(),
            min: 0,
            max: _result!.totalTime.toDouble(),
            onChanged: !_isPlaying ? (value) {
              setState(() => _currentTime = value.toInt());
            } : null,
          ),
        ),
        const SizedBox(width: 16),
        Chip(
          label: Text('时间: $_currentTime / ${_result!.totalTime}'),
        ),
      ],
    );
  }
  
  void _showHelpDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('进程调度模拟器帮助'),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '支持的调度算法：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 8),
              Text('• FCFS：先来先服务，按到达顺序调度'),
              Text('• SJF：短作业优先，优先调度服务时间短的进程'),
              Text('• Priority：优先级调度，按优先级高低调度'),
              Text('• RR：时间片轮转，每个进程轮流执行固定时间'),
              SizedBox(height: 16),
              Text(
                '使用说明：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 8),
              Text('1. 添加进程或生成示例进程'),
              Text('2. 选择调度算法和参数'),
              Text('3. 点击"执行调度"查看结果'),
              Text('4. 使用播放控件查看动画过程'),
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
