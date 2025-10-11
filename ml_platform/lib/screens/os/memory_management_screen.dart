// 内存管理界面
import 'package:flutter/material.dart';
import 'package:ml_platform/models/os/memory_model.dart';
import 'package:ml_platform/services/os/memory_service.dart';
import 'package:ml_platform/widgets/os/memory_visualizer.dart';

class MemoryManagementScreen extends StatefulWidget {
  const MemoryManagementScreen({Key? key}) : super(key: key);
  
  @override
  State<MemoryManagementScreen> createState() => _MemoryManagementScreenState();
}

class _MemoryManagementScreenState extends State<MemoryManagementScreen>
    with TickerProviderStateMixin {
  final MemoryService _memoryService = MemoryService();
  late AnimationController _animationController;
  late TabController _tabController;
  
  // ========= 动态分区分配相关 =========
  List<MemoryPartition> _memoryPartitions = [];
  int _totalMemorySize = 1024; // KB
  MemoryAllocationAlgorithm _selectedAllocationAlgorithm = MemoryAllocationAlgorithm.firstFit;
  List<MemoryRequest> _pendingRequests = [];
  List<MemoryEvent> _allocationHistory = [];
  int? _highlightPartitionId;
  
  // 输入控制器
  final _processNameController = TextEditingController();
  final _requestSizeController = TextEditingController();
  
  // ========= 页面置换相关 =========
  List<PageRequest> _pageRequests = [];
  PageReplacementResult? _pageReplacementResult;
  PageReplacementAlgorithm _selectedPageAlgorithm = PageReplacementAlgorithm.fifo;
  int _frameCount = 3;
  int _currentStepIndex = 0;
  bool _isPlaying = false;
  
  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(seconds: 1),
      vsync: this,
    )..repeat();
    
    _tabController = TabController(length: 2, vsync: this);
    
    // 初始化内存
    _initializeMemory();
    
    // 生成示例页面请求序列
    _generateSamplePageRequests();
  }
  
  @override
  void dispose() {
    _animationController.dispose();
    _tabController.dispose();
    _processNameController.dispose();
    _requestSizeController.dispose();
    super.dispose();
  }
  
  void _initializeMemory() {
    setState(() {
      _memoryPartitions = _memoryService.initializeMemory(_totalMemorySize);
      _allocationHistory.clear();
      _pendingRequests.clear();
    });
  }
  
  void _addMemoryRequest() {
    final processName = _processNameController.text.trim();
    final size = int.tryParse(_requestSizeController.text) ?? 0;
    
    if (processName.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请输入进程名称')),
      );
      return;
    }
    
    if (size <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请输入有效的内存大小')),
      );
      return;
    }
    
    setState(() {
      final processId = _pendingRequests.isEmpty ? 1 : _pendingRequests.last.processId + 1;
      _pendingRequests.add(MemoryRequest(
        processId: processId,
        processName: processName,
        size: size,
        timestamp: DateTime.now().millisecondsSinceEpoch,
      ));
    });
    
    _processNameController.clear();
    _requestSizeController.clear();
  }
  
  void _allocateMemory(MemoryRequest request) {
    final result = _memoryService.allocateMemory(
      memory: _memoryPartitions,
      request: request,
      algorithm: _selectedAllocationAlgorithm,
    );
    
    setState(() {
      _memoryPartitions = result.memoryState;
      _highlightPartitionId = result.allocatedPartitionId;
      _pendingRequests.remove(request);
      
      _allocationHistory.add(MemoryEvent(
        timestamp: DateTime.now().millisecondsSinceEpoch,
        type: MemoryEventType.allocate,
        description: result.message,
        memoryState: result.memoryState.map((p) => p.clone()).toList(),
        highlightPartition: result.allocatedPartitionId,
      ));
    });
    
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(result.message),
        backgroundColor: result.success ? Colors.green : Colors.red,
      ),
    );
    
    // 清除高亮
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) {
        setState(() {
          _highlightPartitionId = null;
        });
      }
    });
  }
  
  void _releaseMemory(int processId) {
    final result = _memoryService.releaseMemory(
      memory: _memoryPartitions,
      processId: processId,
    );
    
    setState(() {
      _memoryPartitions = result.memoryState;
      
      _allocationHistory.add(MemoryEvent(
        timestamp: DateTime.now().millisecondsSinceEpoch,
        type: MemoryEventType.release,
        description: result.message,
        memoryState: result.memoryState.map((p) => p.clone()).toList(),
      ));
    });
    
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(result.message),
        backgroundColor: result.success ? Colors.green : Colors.red,
      ),
    );
  }
  
  void _generateSampleRequests() {
    setState(() {
      _pendingRequests = _memoryService.generateMemoryRequests(count: 5);
    });
  }
  
  void _generateSamplePageRequests() {
    setState(() {
      _pageRequests = _memoryService.generatePageRequestSequence(
        length: 20,
        pageRange: 8,
      );
      _pageReplacementResult = null;
      _currentStepIndex = 0;
      _isPlaying = false;
    });
  }
  
  void _executePageReplacement() {
    if (_pageRequests.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请先生成页面请求序列')),
      );
      return;
    }
    
    setState(() {
      _pageReplacementResult = _memoryService.executePageReplacement(
        requests: _pageRequests,
        frameCount: _frameCount,
        algorithm: _selectedPageAlgorithm,
      );
      _currentStepIndex = 0;
      _isPlaying = false;
    });
  }
  
  void _playPageReplacement() async {
    if (_pageReplacementResult == null) return;
    
    setState(() => _isPlaying = true);
    
    for (int i = _currentStepIndex; i < _pageReplacementResult!.steps.length; i++) {
      if (!mounted || !_isPlaying) break;
      
      setState(() => _currentStepIndex = i);
      
      await Future.delayed(const Duration(milliseconds: 800));
    }
    
    setState(() => _isPlaying = false);
  }
  
  void _pausePageReplacement() {
    setState(() => _isPlaying = false);
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Scaffold(
      appBar: AppBar(
        title: const Text('内存管理模拟器'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: '动态分区分配', icon: Icon(Icons.memory)),
            Tab(text: '页面置换', icon: Icon(Icons.swap_horiz)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.help_outline),
            onPressed: () => _showHelpDialog(context),
            tooltip: '帮助',
          ),
        ],
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildDynamicPartitionTab(),
          _buildPageReplacementTab(),
        ],
      ),
    );
  }
  
  Widget _buildDynamicPartitionTab() {
    return Row(
      children: [
        // 左侧控制面板
        Container(
          width: 380,
          padding: const EdgeInsets.all(16),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildMemoryRequestInput(),
                const SizedBox(height: 16),
                _buildPendingRequests(),
                const SizedBox(height: 16),
                _buildAlgorithmSelection(),
                const SizedBox(height: 16),
                _buildAllocatedProcesses(),
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
                Expanded(
                  flex: 3,
                  child: MemoryAllocationVisualizer(
                    partitions: _memoryPartitions,
                    totalSize: _totalMemorySize,
                    animationController: _animationController,
                    highlightPartitionId: _highlightPartitionId,
                  ),
                ),
                const SizedBox(height: 16),
                if (_allocationHistory.isNotEmpty)
                  Expanded(
                    flex: 1,
                    child: _buildAllocationHistory(),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
  
  Widget _buildPageReplacementTab() {
    final theme = Theme.of(context);
    
    return Row(
      children: [
        // 左侧控制面板
        Container(
          width: 380,
          padding: const EdgeInsets.all(16),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildPageRequestSequence(),
                const SizedBox(height: 16),
                _buildPageAlgorithmSelection(),
                const SizedBox(height: 16),
                _buildPageReplacementControls(),
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
                if (_pageReplacementResult != null && _currentStepIndex < _pageReplacementResult!.steps.length)
                  Expanded(
                    child: Column(
                      children: [
                        PageReplacementVisualizer(
                          step: _pageReplacementResult!.steps[_currentStepIndex],
                          frameCount: _frameCount,
                        ),
                        const SizedBox(height: 16),
                        _buildPageReplacementPlayback(),
                      ],
                    ),
                  )
                else
                  const Expanded(
                    child: Center(
                      child: Text('请执行页面置换算法'),
                    ),
                  ),
                
                if (_pageReplacementResult != null)
                  Container(
                    padding: const EdgeInsets.all(16),
                    child: _buildPageReplacementStatistics(),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
  
  Widget _buildMemoryRequestInput() {
    final theme = Theme.of(context);
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '添加内存请求',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _processNameController,
              decoration: const InputDecoration(
                labelText: '进程名称',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _requestSizeController,
              decoration: const InputDecoration(
                labelText: '请求大小 (KB)',
                border: OutlineInputBorder(),
                isDense: true,
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _addMemoryRequest,
                    icon: const Icon(Icons.add),
                    label: const Text('添加请求'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _generateSampleRequests,
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
  
  Widget _buildPendingRequests() {
    final theme = Theme.of(context);
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '待处理请求',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            if (_pendingRequests.isEmpty)
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Colors.grey.shade100,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Center(
                  child: Text('暂无待处理请求'),
                ),
              )
            else
              ...List.generate(_pendingRequests.length, (index) {
                final request = _pendingRequests[index];
                return ListTile(
                  dense: true,
                  title: Text(request.processName),
                  subtitle: Text('${request.size} KB'),
                  trailing: ElevatedButton(
                    onPressed: () => _allocateMemory(request),
                    child: const Text('分配'),
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }
  
  Widget _buildAlgorithmSelection() {
    final theme = Theme.of(context);
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '分配算法',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            ...MemoryAllocationAlgorithm.values.map((algo) {
              return RadioListTile<MemoryAllocationAlgorithm>(
                title: Text(algo.label),
                subtitle: Text(algo.englishName),
                value: algo,
                groupValue: _selectedAllocationAlgorithm,
                onChanged: (value) {
                  setState(() {
                    _selectedAllocationAlgorithm = value!;
                  });
                },
              );
            }),
          ],
        ),
      ),
    );
  }
  
  Widget _buildAllocatedProcesses() {
    final theme = Theme.of(context);
    final allocatedPartitions = _memoryPartitions.where((p) => !p.isFree).toList();
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '已分配进程',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            if (allocatedPartitions.isEmpty)
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Colors.grey.shade100,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Center(
                  child: Text('暂无已分配进程'),
                ),
              )
            else
              ...allocatedPartitions.map((partition) {
                return ListTile(
                  dense: true,
                  title: Text(partition.processName ?? '进程${partition.processId}'),
                  subtitle: Text('${partition.size} KB'),
                  trailing: IconButton(
                    icon: const Icon(Icons.delete, color: Colors.red),
                    onPressed: () => _releaseMemory(partition.processId!),
                  ),
                );
              }),
            const SizedBox(height: 12),
            ElevatedButton.icon(
              onPressed: _initializeMemory,
              icon: const Icon(Icons.refresh),
              label: const Text('重置内存'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.orange,
                foregroundColor: Colors.white,
              ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildAllocationHistory() {
    final theme = Theme.of(context);
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '操作历史',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: ListView.builder(
                itemCount: _allocationHistory.length,
                itemBuilder: (context, index) {
                  final event = _allocationHistory[_allocationHistory.length - 1 - index];
                  return ListTile(
                    dense: true,
                    leading: Icon(
                      event.type == MemoryEventType.allocate 
                          ? Icons.add_circle
                          : Icons.remove_circle,
                      color: event.type == MemoryEventType.allocate 
                          ? Colors.green
                          : Colors.red,
                    ),
                    title: Text(event.description),
                    subtitle: Text(
                      DateTime.fromMillisecondsSinceEpoch(event.timestamp)
                          .toString()
                          .substring(11, 19),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildPageRequestSequence() {
    final theme = Theme.of(context);
    
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
                  '页面请求序列',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                ElevatedButton.icon(
                  onPressed: _generateSamplePageRequests,
                  icon: const Icon(Icons.refresh),
                  label: const Text('生成'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.grey.shade100,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _pageRequests.map((req) {
                  final index = _pageRequests.indexOf(req);
                  final isCurrentStep = _pageReplacementResult != null && 
                      index < _currentStepIndex;
                  
                  return Chip(
                    label: Text(req.pageNumber.toString()),
                    backgroundColor: isCurrentStep 
                        ? Colors.green.shade100
                        : Colors.white,
                  );
                }).toList(),
              ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildPageAlgorithmSelection() {
    final theme = Theme.of(context);
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '页面置换算法',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            ...PageReplacementAlgorithm.values.map((algo) {
              return RadioListTile<PageReplacementAlgorithm>(
                title: Text(algo.label),
                subtitle: Text(algo.shortName),
                value: algo,
                groupValue: _selectedPageAlgorithm,
                onChanged: (value) {
                  setState(() {
                    _selectedPageAlgorithm = value!;
                    _pageReplacementResult = null;
                  });
                },
              );
            }),
            const Divider(),
            Row(
              children: [
                const Text('页框数量:'),
                const SizedBox(width: 16),
                Expanded(
                  child: Slider(
                    value: _frameCount.toDouble(),
                    min: 2,
                    max: 6,
                    divisions: 4,
                    label: '$_frameCount',
                    onChanged: (value) {
                      setState(() {
                        _frameCount = value.toInt();
                        _pageReplacementResult = null;
                      });
                    },
                  ),
                ),
                Chip(label: Text('$_frameCount')),
              ],
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildPageReplacementControls() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _executePageReplacement,
                icon: const Icon(Icons.play_arrow),
                label: const Text('执行算法'),
              ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildPageReplacementPlayback() {
    if (_pageReplacementResult == null) return const SizedBox.shrink();
    
    return Card(
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
                  onPressed: _isPlaying ? _pausePageReplacement : _playPageReplacement,
                ),
                IconButton(
                  icon: const Icon(Icons.navigate_next),
                  onPressed: _currentStepIndex < _pageReplacementResult!.steps.length - 1 ? () {
                    setState(() => _currentStepIndex++);
                  } : null,
                ),
                IconButton(
                  icon: const Icon(Icons.skip_next),
                  onPressed: () {
                    setState(() => _currentStepIndex = _pageReplacementResult!.steps.length - 1);
                  },
                ),
              ],
            ),
            const SizedBox(height: 8),
            LinearProgressIndicator(
              value: (_currentStepIndex + 1) / _pageReplacementResult!.steps.length,
            ),
            const SizedBox(height: 8),
            Text('步骤 ${_currentStepIndex + 1} / ${_pageReplacementResult!.steps.length}'),
          ],
        ),
      ),
    );
  }
  
  Widget _buildPageReplacementStatistics() {
    if (_pageReplacementResult == null) return const SizedBox.shrink();
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            _buildStatCard(
              '总缺页次数',
              '${_pageReplacementResult!.totalPageFaults}',
              Icons.error_outline,
              Colors.red,
            ),
            _buildStatCard(
              '缺页率',
              '${(_pageReplacementResult!.pageFaultRate * 100).toStringAsFixed(1)}%',
              Icons.percent,
              Colors.orange,
            ),
            _buildStatCard(
              '页框数',
              '${_pageReplacementResult!.frameCount}',
              Icons.memory,
              Colors.blue,
            ),
            _buildStatCard(
              '请求总数',
              '${_pageReplacementResult!.requests.length}',
              Icons.format_list_numbered,
              Colors.green,
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildStatCard(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        children: [
          Icon(icon, color: color, size: 24),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: color.shade800,
            ),
          ),
          Text(
            label,
            style: const TextStyle(fontSize: 12),
          ),
        ],
      ),
    );
  }
  
  void _showHelpDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('内存管理模拟器帮助'),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '动态分区分配：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 8),
              Text('• 首次适应：从头开始查找第一个满足的空闲分区'),
              Text('• 最佳适应：选择最小的能满足需求的空闲分区'),
              Text('• 最坏适应：选择最大的空闲分区'),
              SizedBox(height: 16),
              Text(
                '页面置换算法：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 8),
              Text('• FIFO：先进先出，置换最早进入的页面'),
              Text('• LRU：最近最少使用，置换最久未使用的页面'),
              Text('• OPT：最优置换，置换将来最长时间不用的页面'),
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
