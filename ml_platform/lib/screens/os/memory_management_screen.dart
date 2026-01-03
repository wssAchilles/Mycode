// 内存管理界面 - Academic Tech Dark 风格优化
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ml_platform/models/os/memory_model.dart';
import 'package:ml_platform/services/os/memory_service.dart';
import 'package:ml_platform/widgets/os/memory_visualizer.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/widgets/common/glass_widgets.dart';

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
        const SnackBar(content: Text('请输入进程名称'), backgroundColor: AppTheme.error),
      );
      return;
    }
    
    if (size <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请输入有效的内存大小'), backgroundColor: AppTheme.error),
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
        backgroundColor: result.success ? AppTheme.success : AppTheme.error,
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
        backgroundColor: result.success ? AppTheme.success : AppTheme.error,
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
        const SnackBar(content: Text('请先生成页面请求序列'), backgroundColor: AppTheme.error),
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
              child: TabBarView(
                controller: _tabController,
                physics: const NeverScrollableScrollPhysics(), // Disable swipe
                children: [
                  _buildDynamicPartitionTab(),
                  _buildPageReplacementTab(),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAppBar() {
    return GlassContainer(
      height: 106, // Height for AppBar content + TabBar
      width: double.infinity,
      borderRadius: BorderRadius.zero,
      padding: const EdgeInsets.only(top: 10, left: 16, right: 16),
      child: Column(
         children: [
            Row(
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
                                 context.go('/os');
                              }
                           },
                        ),
                        const SizedBox(width: 8),
                        Text(
                           '内存管理算法模拟',
                           style: AppTheme.darkTheme.textTheme.titleLarge?.copyWith(
                              fontWeight: FontWeight.bold,
                              letterSpacing: 1.0,
                           )
                        ),
                     ],
                  ),
                  IconButton(
                     icon: const Icon(Icons.help_outline, color: AppTheme.secondary),
                     onPressed: () => _showHelpDialog(context),
                     tooltip: '帮助',
                  ),
               ],
            ),
            TabBar(
               controller: _tabController,
               labelColor: AppTheme.primary,
               unselectedLabelColor: AppTheme.textSecondary,
               indicatorColor: AppTheme.primary,
               dividerColor: Colors.transparent,
               tabs: const [
                  Tab(text: '动态分区分配', icon: Icon(Icons.memory)),
                  Tab(text: '页面置换', icon: Icon(Icons.swap_horiz)),
               ],
            ),
         ],
      ),
    );
  }
  
  Widget _buildDynamicPartitionTab() {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isDesktop = constraints.maxWidth > 900;
        
        Widget buildLeftPanel() {
          return Padding(
            padding: const EdgeInsets.all(16),
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
          );
        }
        
        Widget buildRightPanel() {
          return Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                SizedBox(
                  height: 500, // Explicit height
                  child: MemoryAllocationVisualizer(
                    partitions: _memoryPartitions,
                    totalSize: _totalMemorySize,
                    animationController: _animationController,
                    highlightPartitionId: _highlightPartitionId,
                  ),
                ),
                const SizedBox(height: 16),
                if (_allocationHistory.isNotEmpty)
                  SizedBox(
                    height: 250,
                    child: _buildAllocationHistory(),
                  ),
              ],
            ),
          );
        }
        
        if (isDesktop) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(width: 400, child: SingleChildScrollView(child: buildLeftPanel())),
              Expanded(
                child: SingleChildScrollView(
                  child: buildRightPanel(),
                ),
              ),
            ],
          );
        } else {
          return SingleChildScrollView(
            child: Column(
              children: [
                buildLeftPanel(),
                buildRightPanel(),
              ],
            ),
          );
        }
      },
    );
  }
  
  Widget _buildPageReplacementTab() {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isDesktop = constraints.maxWidth > 900;
        
        Widget buildLeftPanel() {
          return Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildPageRequestSequence(),
                const SizedBox(height: 16),
                _buildPageAlgorithmSelection(),
                const SizedBox(height: 24),
                _buildPageReplacementControls(),
              ],
            ),
          );
        }
        
        Widget buildRightPanel() {
          return Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                if (_pageReplacementResult != null && _currentStepIndex < _pageReplacementResult!.steps.length)
                  Column(
                    children: [
                      PageReplacementVisualizer(
                        step: _pageReplacementResult!.steps[_currentStepIndex],
                        frameCount: _frameCount,
                      ),
                      const SizedBox(height: 16),
                      _buildPageReplacementPlayback(),
                    ],
                  )
                else
                  GlassCard(
                    child: Container(
                      height: 200,
                      alignment: Alignment.center,
                      child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                              Icon(Icons.touch_app, size: 48, color: AppTheme.textSecondary.withOpacity(0.5)),
                              const SizedBox(height: 12),
                              const Text('请设置参数并点击"开始模拟"', style: TextStyle(color: AppTheme.textSecondary)),
                          ],
                      ),
                    ),
                  ),
                
                if (_pageReplacementResult != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: _buildPageReplacementStatistics(),
                  ),
              ],
            ),
          );
        }
        
        if (isDesktop) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(width: 400, child: SingleChildScrollView(child: buildLeftPanel())),
              Expanded(
                child: SingleChildScrollView(
                  child: buildRightPanel(),
                ),
              ),
            ],
          );
        } else {
          return SingleChildScrollView(
            child: Column(
              children: [
                buildLeftPanel(),
                buildRightPanel(),
              ],
            ),
          );
        }
      },
    );
  }
  
  Widget _buildMemoryRequestInput() {
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '添加内存请求',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _processNameController,
              style: const TextStyle(color: Colors.white, fontFamily: AppTheme.codeFont),
              decoration: InputDecoration(
                labelText: '进程名称',
                labelStyle: const TextStyle(color: AppTheme.textSecondary),
                border: const OutlineInputBorder(),
                enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: AppTheme.glassBorder)),
                focusedBorder: const OutlineInputBorder(borderSide: BorderSide(color: AppTheme.primary)),
                filled: true,
                fillColor: Colors.white.withOpacity(0.05),
                isDense: true,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _requestSizeController,
              style: const TextStyle(color: Colors.white, fontFamily: AppTheme.codeFont),
              decoration: InputDecoration(
                labelText: '请求大小 (KB)',
                labelStyle: const TextStyle(color: AppTheme.textSecondary),
                border: const OutlineInputBorder(),
                 enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: AppTheme.glassBorder)),
                focusedBorder: const OutlineInputBorder(borderSide: BorderSide(color: AppTheme.primary)),
                filled: true,
                fillColor: Colors.white.withOpacity(0.05),
                isDense: true,
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 16),
            Column(
              children: [
                NeonButton(
                  onPressed: _addMemoryRequest,
                  text: '添加请求',
                  icon: Icons.add,
                  isPrimary: true,
                  width: double.infinity,
                  height: 48,
                ),
                const SizedBox(height: 8),
                SizedBox(
                   width: double.infinity,
                   child: OutlinedButton.icon(
                      onPressed: _generateSampleRequests,
                      icon: const Icon(Icons.auto_awesome, color: AppTheme.secondary),
                      label: const Text('生成随机示例'),
                      style: OutlinedButton.styleFrom(
                         foregroundColor: AppTheme.secondary,
                         side: const BorderSide(color: AppTheme.secondary),
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
  
  Widget _buildPendingRequests() {
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '待处理请求',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
            ),
            const SizedBox(height: 12),
            if (_pendingRequests.isEmpty)
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.05),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.glassBorder),
                ),
                child: const Center(
                  child: Text('暂无待处理请求', style: TextStyle(color: AppTheme.textSecondary)),
                ),
              )
            else
              ListView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _pendingRequests.length,
                itemBuilder: (context, index) {
                   final request = _pendingRequests[index];
                   return Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      decoration: BoxDecoration(
                         borderRadius: BorderRadius.circular(8),
                         color: Colors.white.withOpacity(0.05),
                         border: Border.all(color: AppTheme.glassBorder),
                      ),
                      child: ListTile(
                         dense: true,
                         title: Text(request.processName, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                         subtitle: Text('${request.size} KB', style: const TextStyle(color: AppTheme.primary, fontFamily: AppTheme.codeFont)),
                         trailing: ElevatedButton(
                            onPressed: () => _allocateMemory(request),
                            style: ElevatedButton.styleFrom(
                               backgroundColor: AppTheme.primary,
                               foregroundColor: Colors.white,
                               elevation: 0,
                            ),
                            child: const Text('分配'),
                         ),
                      ),
                   );
                },
              ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildAlgorithmSelection() {
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '分配算法',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
            ),
            const SizedBox(height: 12),
            ...MemoryAllocationAlgorithm.values.map((algo) {
              final isSelected = _selectedAllocationAlgorithm == algo;
              return Container(
                margin: const EdgeInsets.only(bottom: 4),
                decoration: BoxDecoration(
                  color: isSelected ? AppTheme.primary.withOpacity(0.1) : Colors.transparent,
                  borderRadius: BorderRadius.circular(8),
                  border: isSelected ? Border.all(color: AppTheme.primary.withOpacity(0.5)) : null,
                ),
                child: RadioListTile<MemoryAllocationAlgorithm>(
                  title: Text(algo.label, style: const TextStyle(color: Colors.white)),
                  subtitle: Text(algo.englishName, style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                  value: algo,
                  groupValue: _selectedAllocationAlgorithm,
                  activeColor: AppTheme.primary,
                  onChanged: (value) {
                    setState(() {
                      _selectedAllocationAlgorithm = value!;
                    });
                  },
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
  
  Widget _buildAllocatedProcesses() {
    final allocatedPartitions = _memoryPartitions.where((p) => !p.isFree).toList();
    
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '已分配进程',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
            ),
            const SizedBox(height: 12),
            if (allocatedPartitions.isEmpty)
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.05),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.glassBorder),
                ),
                child: const Center(
                  child: Text('暂无已分配进程', style: TextStyle(color: AppTheme.textSecondary)),
                ),
              )
            else
              ListView.builder(
                 shrinkWrap: true,
                 physics: const NeverScrollableScrollPhysics(),
                 itemCount: allocatedPartitions.length,
                 itemBuilder: (context, index) {
                    final partition = allocatedPartitions[index];
                    return Container(
                       margin: const EdgeInsets.only(bottom: 8),
                       decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(8),
                          color: Colors.white.withOpacity(0.05),
                          border: Border.all(color: AppTheme.glassBorder),
                       ),
                       child: ListTile(
                          dense: true,
                          title: Text(partition.processName ?? '进程${partition.processId}', style: const TextStyle(color: Colors.white)),
                          subtitle: Text('${partition.size} KB', style: const TextStyle(color: AppTheme.textSecondary, fontFamily: AppTheme.codeFont)),
                          trailing: IconButton(
                             icon: const Icon(Icons.delete, color: AppTheme.error),
                             onPressed: () => _releaseMemory(partition.processId!),
                          ),
                       ),
                    );
                 }
              ),
            const SizedBox(height: 16),
            SizedBox(
               width: double.infinity,
               child: OutlinedButton.icon(
                  onPressed: _initializeMemory,
                  icon: const Icon(Icons.refresh, color: AppTheme.error),
                  label: const Text('重置内存状态'),
                  style: OutlinedButton.styleFrom(
                     foregroundColor: AppTheme.error,
                     side: const BorderSide(color: AppTheme.error),
                     padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
               ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildAllocationHistory() {
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '操作历史',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.white),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: ListView.builder(
                itemCount: _allocationHistory.length,
                itemBuilder: (context, index) {
                  final event = _allocationHistory[_allocationHistory.length - 1 - index];
                  return ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(
                      event.type == MemoryEventType.allocate 
                          ? Icons.add_circle
                          : Icons.remove_circle,
                      color: event.type == MemoryEventType.allocate 
                          ? AppTheme.success
                          : AppTheme.error,
                      size: 20,
                    ),
                    title: Text(event.description, style: const TextStyle(color: Colors.white70, fontSize: 12)),
                    subtitle: Text(
                      DateTime.fromMillisecondsSinceEpoch(event.timestamp)
                          .toString()
                          .substring(11, 19),
                      style: const TextStyle(color: AppTheme.textSecondary, fontFamily: AppTheme.codeFont, fontSize: 10),
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
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  '页面请求序列',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
                ),
                TextButton.icon(
                  onPressed: _generateSamplePageRequests,
                  icon: const Icon(Icons.refresh, color: AppTheme.accent),
                  label: const Text('重新生成', style: TextStyle(color: AppTheme.accent)),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.05),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppTheme.glassBorder),
              ),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _pageRequests.map((req) {
                  final index = _pageRequests.indexOf(req);
                  final isCurrentStep = _pageReplacementResult != null && 
                      index < _currentStepIndex;
                  final isNext = _pageReplacementResult != null && index == _currentStepIndex;
                  
                  return Container(
                     width: 32,
                     height: 32,
                     alignment: Alignment.center,
                     decoration: BoxDecoration(
                        color: isNext 
                            ? AppTheme.primary 
                            : isCurrentStep 
                                ? AppTheme.primary.withOpacity(0.2)
                                : Colors.transparent,
                        border: Border.all(
                           color: isNext ? AppTheme.primary : AppTheme.glassBorder,
                        ),
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: isNext ? [BoxShadow(color: AppTheme.primary.withOpacity(0.5), blurRadius: 8)] : null,
                     ),
                     child: Text(
                        req.pageNumber.toString(),
                        style: TextStyle(
                           color: isNext ? Colors.white : (isCurrentStep ? Colors.white70 : AppTheme.textSecondary),
                           fontWeight: FontWeight.bold,
                           fontFamily: AppTheme.codeFont
                        ),
                     ),
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
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '页面置换算法',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
            ),
            const SizedBox(height: 12),
            ...PageReplacementAlgorithm.values.map((algo) {
               final isSelected = _selectedPageAlgorithm == algo;
               return Container(
                margin: const EdgeInsets.only(bottom: 4),
                decoration: BoxDecoration(
                  color: isSelected ? AppTheme.primary.withOpacity(0.1) : Colors.transparent,
                  borderRadius: BorderRadius.circular(8),
                  border: isSelected ? Border.all(color: AppTheme.primary.withOpacity(0.5)) : null,
                ),
                child: RadioListTile<PageReplacementAlgorithm>(
                  title: Text(algo.label, style: const TextStyle(color: Colors.white)),
                  subtitle: Text(algo.shortName, style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                  value: algo,
                  groupValue: _selectedPageAlgorithm,
                  activeColor: AppTheme.primary,
                  onChanged: (value) {
                    setState(() {
                      _selectedPageAlgorithm = value!;
                      _pageReplacementResult = null;
                    });
                  },
                ),
              );
            }),
            const Divider(color: Colors.white10),
            Padding(
               padding: const EdgeInsets.symmetric(horizontal: 0, vertical: 8),
               child: Row(
                  children: [
                     const Text('页框数量:', style: TextStyle(color: Colors.white)),
                     const SizedBox(width: 16),
                     Expanded(
                        child: SliderTheme(
                           data: SliderThemeData(
                              activeTrackColor: AppTheme.accent,
                              inactiveTrackColor: Colors.white10,
                              thumbColor: AppTheme.accent,
                              overlayColor: AppTheme.accent.withOpacity(0.2),
                              trackHeight: 4,
                           ),
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
                     ),
                     Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                           color: AppTheme.accent.withOpacity(0.1),
                           borderRadius: BorderRadius.circular(4),
                           border: Border.all(color: AppTheme.accent.withOpacity(0.5)),
                        ),
                        child: Text('$_frameCount g', style: const TextStyle(color: AppTheme.accent, fontFamily: AppTheme.codeFont)),
                     ),
                  ],
               ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildPageReplacementControls() {
    return Column(
       children: [
          NeonButton(
            onPressed: _executePageReplacement,
            text: '开始模拟',
            icon: Icons.play_arrow,
            isPrimary: true,
            width: double.infinity,
            height: 50,
          ),
       ],
    );
  }
  
  Widget _buildPageReplacementPlayback() {
     return GlassCard(
        child: Padding(
           padding: const EdgeInsets.all(12),
           child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                 IconButton(
                    icon: const Icon(Icons.first_page, color: Colors.white),
                    onPressed: _currentStepIndex > 0 ? () {
                       setState(() => _currentStepIndex = 0);
                    } : null,
                 ),
                 IconButton(
                    icon: const Icon(Icons.navigate_before, color: Colors.white),
                    onPressed: _currentStepIndex > 0 ? () {
                       setState(() => _currentStepIndex--);
                    } : null,
                 ),
                 FloatingActionButton.small(
                    backgroundColor: AppTheme.primary,
                    onPressed: _isPlaying ? _pausePageReplacement : _playPageReplacement,
                    child: Icon(_isPlaying ? Icons.pause : Icons.play_arrow),
                 ),
                 IconButton(
                    icon: const Icon(Icons.navigate_next, color: Colors.white),
                    onPressed: _currentStepIndex < _pageReplacementResult!.steps.length - 1 ? () {
                       setState(() => _currentStepIndex++);
                    } : null,
                 ),
                 IconButton(
                    icon: const Icon(Icons.last_page, color: Colors.white),
                    onPressed: () {
                       setState(() => _currentStepIndex = _pageReplacementResult!.steps.length - 1);
                    },
                 ),
              ],
           ),
        ),
     );
  }

  Widget _buildPageReplacementStatistics() {
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(child: _buildStatItem('总访问', '${_pageReplacementResult!.requests.length}', Colors.blue)),
                Expanded(child: _buildStatItem('缺页次数', '${_pageReplacementResult!.totalPageFaults}', AppTheme.error)),
                Expanded(child: _buildStatItem('缺页率', '${(_pageReplacementResult!.pageFaultRate * 100).toStringAsFixed(1)}%', Colors.orange)),
              ],
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildStatItem(String label, String value, Color color) {
    return Column(
      children: [
        Text(
          value,
          style: TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.bold,
            color: color,
            fontFamily: AppTheme.codeFont,
          ),
        ),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
      ],
    );
  }

  void _showHelpDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.surface,
        title: const Text('内存管理说明', style: TextStyle(color: Colors.white)),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('动态分区分配', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primary)),
              Text('模拟内存的动态分配与回收。支持首次适应(First Fit)、最佳适应(Best Fit)等算法。', style: TextStyle(color: Colors.white70)),
              SizedBox(height: 12),
              Text('页面置换', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primary)),
              Text('模拟请求分页存储管理中的页面置换过程。', style: TextStyle(color: Colors.white70)),
              SizedBox(height: 8),
              Text('• FIFO: 先进先出\n• LRU: 最近最久未使用\n• OPT: 最佳置换（理想算法）', style: TextStyle(color: Colors.white70)),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('了解', style: TextStyle(color: AppTheme.primary))),
        ],
      ),
    );
  }
}
