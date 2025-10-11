// 段页式内存管理界面
import 'package:flutter/material.dart';
import 'package:ml_platform/models/os/segment_page_model.dart';
import 'package:ml_platform/services/os/segment_page_service.dart';
import 'package:ml_platform/widgets/os/segment_page_visualizer.dart';

class SegmentPageScreen extends StatefulWidget {
  const SegmentPageScreen({Key? key}) : super(key: key);
  
  @override
  State<SegmentPageScreen> createState() => _SegmentPageScreenState();
}

class _SegmentPageScreenState extends State<SegmentPageScreen>
    with TickerProviderStateMixin {
  final SegmentPageService _service = SegmentPageService();
  late AnimationController _animationController;
  late TabController _tabController;
  
  // 内存系统
  late SegmentPageMemorySystem _memorySystem;
  
  // 地址转换
  AddressTranslationResult? _translationResult;
  int _currentStepIndex = 0;
  bool _isPlaying = false;
  
  // 地址访问历史
  List<AddressTranslationResult> _translationHistory = [];
  
  // 输入控制器
  final _segmentController = TextEditingController();
  final _pageController = TextEditingController();
  final _offsetController = TextEditingController();
  AccessType _selectedAccessType = AccessType.read;
  
  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(seconds: 1),
      vsync: this,
    );
    
    _tabController = TabController(length: 3, vsync: this);
    
    // 初始化内存系统
    _memorySystem = _service.createExampleSystem();
  }
  
  @override
  void dispose() {
    _animationController.dispose();
    _tabController.dispose();
    _segmentController.dispose();
    _pageController.dispose();
    _offsetController.dispose();
    super.dispose();
  }
  
  void _executeAddressTranslation() {
    final segment = int.tryParse(_segmentController.text) ?? 0;
    final page = int.tryParse(_pageController.text) ?? 0;
    final offset = int.tryParse(_offsetController.text) ?? 0;
    
    final request = AddressTranslationRequest(
      logicalAddress: LogicalAddress(
        segmentNumber: segment,
        pageNumber: page,
        offset: offset,
      ),
      accessType: _selectedAccessType,
    );
    
    setState(() {
      _translationResult = _service.translateAddress(_memorySystem, request);
      _translationHistory.add(_translationResult!);
      _currentStepIndex = 0;
      _isPlaying = false;
    });
  }
  
  void _playSteps() async {
    if (_translationResult == null) return;
    
    setState(() => _isPlaying = true);
    
    for (int i = 0; i < _translationResult!.steps.length; i++) {
      if (!mounted || !_isPlaying) break;
      
      setState(() => _currentStepIndex = i);
      
      await Future.delayed(const Duration(milliseconds: 1000));
    }
    
    setState(() => _isPlaying = false);
  }
  
  void _pauseSteps() {
    setState(() => _isPlaying = false);
  }
  
  void _generateRandomAddress() {
    final random = DateTime.now().millisecondsSinceEpoch % 1000;
    _segmentController.text = '${random % 3}';
    _pageController.text = '${(random ~/ 3) % 4}';
    _offsetController.text = '${(random * 17) % 1024}';
  }
  
  void _resetSystem() {
    setState(() {
      _memorySystem = _service.createExampleSystem();
      _translationResult = null;
      _translationHistory.clear();
      _currentStepIndex = 0;
    });
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Scaffold(
      appBar: AppBar(
        title: const Text('段页式内存管理'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: '地址转换', icon: Icon(Icons.transform)),
            Tab(text: '内存视图', icon: Icon(Icons.memory)),
            Tab(text: '系统统计', icon: Icon(Icons.analytics)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _resetSystem,
            tooltip: '重置系统',
          ),
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
          _buildAddressTranslationTab(),
          _buildMemoryViewTab(),
          _buildStatisticsTab(),
        ],
      ),
    );
  }
  
  Widget _buildAddressTranslationTab() {
    return Row(
      children: [
        // 左侧控制面板
        Container(
          width: 400,
          padding: const EdgeInsets.all(16),
          child: SingleChildScrollView(
            child: Column(
              children: [
                _buildAddressInput(),
                const SizedBox(height: 16),
                _buildControlButtons(),
                const SizedBox(height: 16),
                if (_translationHistory.isNotEmpty)
                  _buildTranslationHistory(),
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
                if (_translationResult != null)
                  Expanded(
                    child: Column(
                      children: [
                        Expanded(
                          child: AddressTranslationVisualizer(
                            result: _translationResult!,
                            currentStepIndex: _currentStepIndex,
                          ),
                        ),
                        const SizedBox(height: 16),
                        _buildPlaybackControls(),
                      ],
                    ),
                  )
                else
                  const Expanded(
                    child: Center(
                      child: Text('请输入逻辑地址并执行地址转换'),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
  
  Widget _buildMemoryViewTab() {
    return Row(
      children: [
        // 左侧：段表和页表
        Expanded(
          flex: 2,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                // 段表
                Expanded(
                  child: SegmentTableVisualizer(
                    segmentTable: _memorySystem.segmentTable,
                    highlightSegment: _translationResult?.success == true
                        ? _getLogicalAddressFromResult()?.segmentNumber
                        : null,
                  ),
                ),
                const SizedBox(height: 16),
                // 当前段的页表
                if (_memorySystem.segmentTable.isNotEmpty)
                  Expanded(
                    child: PageTableVisualizer(
                      segmentNumber: _getSelectedSegmentNumber(),
                      pageTable: _memorySystem.pageTables[_getSelectedSegmentNumber()] ?? [],
                      highlightPage: _translationResult?.success == true
                          ? _getLogicalAddressFromResult()?.pageNumber
                          : null,
                    ),
                  ),
              ],
            ),
          ),
        ),
        
        // 右侧：物理内存
        Expanded(
          flex: 1,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: PhysicalMemoryVisualizer(
              system: _memorySystem,
              highlightFrame: _translationResult?.success == true
                  ? _translationResult?.physicalAddress?.frameNumber
                  : null,
            ),
          ),
        ),
      ],
    );
  }
  
  Widget _buildStatisticsTab() {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          MemorySystemStatsVisualizer(
            stats: _memorySystem.getStatistics(),
          ),
          const SizedBox(height: 16),
          
          // 地址转换统计
          if (_translationHistory.isNotEmpty) ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      '地址转换统计',
                      style: TextStyle(fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 16),
                    
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        _buildTranslationStat(
                          '总请求',
                          '${_translationHistory.length}',
                          Icons.request_page,
                          Colors.blue,
                        ),
                        _buildTranslationStat(
                          '成功',
                          '${_translationHistory.where((r) => r.success).length}',
                          Icons.check_circle,
                          Colors.green,
                        ),
                        _buildTranslationStat(
                          '失败',
                          '${_translationHistory.where((r) => !r.success).length}',
                          Icons.error,
                          Colors.red,
                        ),
                        _buildTranslationStat(
                          '成功率',
                          '${(_translationHistory.where((r) => r.success).length / _translationHistory.length * 100).toStringAsFixed(1)}%',
                          Icons.percent,
                          Colors.purple,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            
            const SizedBox(height: 16),
            
            // 错误类型统计
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      '错误类型统计',
                      style: TextStyle(fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 16),
                    
                    ...TranslationError.values.map((error) {
                      final count = _translationHistory
                          .where((r) => r.error == error)
                          .length;
                      
                      return ListTile(
                        leading: Icon(Icons.error_outline, color: Colors.red),
                        title: Text(error.message),
                        trailing: Chip(
                          label: Text('$count'),
                          backgroundColor: Colors.red.shade100,
                        ),
                      );
                    }),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
  
  Widget _buildAddressInput() {
    final theme = Theme.of(context);
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '逻辑地址输入',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _segmentController,
                    decoration: const InputDecoration(
                      labelText: '段号',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                    keyboardType: TextInputType.number,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _pageController,
                    decoration: const InputDecoration(
                      labelText: '页号',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                    keyboardType: TextInputType.number,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _offsetController,
                    decoration: const InputDecoration(
                      labelText: '偏移',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                    keyboardType: TextInputType.number,
                  ),
                ),
              ],
            ),
            
            const SizedBox(height: 12),
            
            // 访问类型选择
            const Text('访问类型:'),
            const SizedBox(height: 8),
            SegmentedButton<AccessType>(
              segments: AccessType.values.map((type) {
                return ButtonSegment(
                  value: type,
                  label: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(type.icon, size: 16),
                      const SizedBox(width: 4),
                      Text(type.label),
                    ],
                  ),
                );
              }).toList(),
              selected: {_selectedAccessType},
              onSelectionChanged: (selected) {
                setState(() {
                  _selectedAccessType = selected.first;
                });
              },
            ),
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
                onPressed: _executeAddressTranslation,
                icon: const Icon(Icons.transform),
                label: const Text('执行地址转换'),
              ),
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _generateRandomAddress,
                icon: const Icon(Icons.shuffle),
                label: const Text('随机地址'),
              ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildTranslationHistory() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '转换历史',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            
            ...List.generate(
              _translationHistory.length > 5 ? 5 : _translationHistory.length,
              (index) {
                final result = _translationHistory[_translationHistory.length - 1 - index];
                return ListTile(
                  dense: true,
                  leading: Icon(
                    result.success ? Icons.check_circle : Icons.error,
                    color: result.success ? Colors.green : Colors.red,
                    size: 20,
                  ),
                  title: Text(
                    result.success 
                        ? result.physicalAddress.toString()
                        : result.errorMessage,
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
  
  Widget _buildPlaybackControls() {
    if (_translationResult == null) return const SizedBox.shrink();
    
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
                  onPressed: _isPlaying ? _pauseSteps : _playSteps,
                ),
                IconButton(
                  icon: const Icon(Icons.navigate_next),
                  onPressed: _currentStepIndex < _translationResult!.steps.length - 1 ? () {
                    setState(() => _currentStepIndex++);
                  } : null,
                ),
                IconButton(
                  icon: const Icon(Icons.skip_next),
                  onPressed: () {
                    setState(() => _currentStepIndex = _translationResult!.steps.length - 1);
                  },
                ),
              ],
            ),
            const SizedBox(height: 8),
            LinearProgressIndicator(
              value: (_currentStepIndex + 1) / _translationResult!.steps.length,
            ),
            const SizedBox(height: 8),
            Text('步骤 ${_currentStepIndex + 1} / ${_translationResult!.steps.length}'),
          ],
        ),
      ),
    );
  }
  
  Widget _buildTranslationStat(String label, String value, IconData icon, Color color) {
    return Column(
      children: [
        Icon(icon, color: color, size: 24),
        const SizedBox(height: 4),
        Text(
          value,
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: color,
          ),
        ),
        Text(
          label,
          style: const TextStyle(fontSize: 12),
        ),
      ],
    );
  }
  
  LogicalAddress? _getLogicalAddressFromResult() {
    if (_translationResult == null) return null;
    // 从转换步骤中提取逻辑地址信息
    return LogicalAddress(
      segmentNumber: int.tryParse(_segmentController.text) ?? 0,
      pageNumber: int.tryParse(_pageController.text) ?? 0,
      offset: int.tryParse(_offsetController.text) ?? 0,
    );
  }
  
  int _getSelectedSegmentNumber() {
    return int.tryParse(_segmentController.text) ?? 0;
  }
  
  void _showHelpDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('段页式内存管理帮助'),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '段页式内存管理：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 8),
              Text('段页式内存管理结合了段式和页式管理的优点，将程序按逻辑分段，每段又分成固定大小的页面。'),
              SizedBox(height: 16),
              Text(
                '地址转换过程：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 8),
              Text('1. 根据段号查找段表，获取页表基址'),
              Text('2. 根据页号查找页表，获取页框号'),
              Text('3. 计算物理地址 = 页框号 × 页面大小 + 页内偏移'),
              SizedBox(height: 16),
              Text(
                '使用说明：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 8),
              Text('• 在地址转换页面输入逻辑地址（段号、页号、偏移）'),
              Text('• 选择访问类型（读、写、执行）'),
              Text('• 点击"执行地址转换"查看转换过程'),
              Text('• 在内存视图页面查看段表、页表和物理内存状态'),
              Text('• 在统计页面查看系统使用情况和错误统计'),
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
