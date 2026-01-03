// 段页式内存管理界面 - Academic Tech Dark 风格优化
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ml_platform/models/os/segment_page_model.dart';
import 'package:ml_platform/services/os/segment_page_service.dart';
import 'package:ml_platform/widgets/os/segment_page_visualizer.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/widgets/common/glass_widgets.dart';

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
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  _buildAddressTranslationTab(),
                  _buildMemoryViewTab(),
                  _buildStatisticsTab(),
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
      height: 106,
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
                           '段页式内存管理',
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
                           icon: const Icon(Icons.refresh, color: AppTheme.secondary),
                           onPressed: _resetSystem,
                           tooltip: '重置系统',
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
            TabBar(
               controller: _tabController,
               labelColor: AppTheme.primary,
               unselectedLabelColor: AppTheme.textSecondary,
               indicatorColor: AppTheme.primary,
               dividerColor: Colors.transparent,
               tabs: const [
                  Tab(text: '地址转换', icon: Icon(Icons.transform)),
                  Tab(text: '内存视图', icon: Icon(Icons.memory)),
                  Tab(text: '系统统计', icon: Icon(Icons.analytics)),
               ],
            ),
         ],
      ),
    );
  }
  
  Widget _buildAddressTranslationTab() {
     return LayoutBuilder(
      builder: (context, constraints) {
         final isDesktop = constraints.maxWidth > 900;
         return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
               // 左侧控制面板
               SizedBox(
                  width: isDesktop ? 400 : constraints.maxWidth * 0.4,
                  child: SingleChildScrollView(
                     padding: const EdgeInsets.all(16),
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
                  child: Padding(
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
                              Expanded(
                                 child: GlassCard(
                                    child: Center(
                                       child: Column(
                                          mainAxisAlignment: MainAxisAlignment.center,
                                          children: [
                                             Icon(Icons.touch_app, size: 60, color: AppTheme.textSecondary.withOpacity(0.3)),
                                             const SizedBox(height: 20),
                                             const Text('请输入逻辑地址并执行地址转换', style: TextStyle(color: AppTheme.textSecondary, fontSize: 18)),
                                          ]
                                       ),
                                    ),
                                 ),
                              ),
                        ],
                     ),
                  ),
               ),
            ],
         );
      }
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
    return SingleChildScrollView(
       padding: const EdgeInsets.all(16),
       child: Column(
         children: [
           MemorySystemStatsVisualizer(
             stats: _memorySystem.getStatistics(),
           ),
           const SizedBox(height: 16),
           
           // 地址转换统计
           if (_translationHistory.isNotEmpty) ...[
             GlassCard(
               child: Padding(
                 padding: const EdgeInsets.all(16),
                 child: Column(
                   crossAxisAlignment: CrossAxisAlignment.start,
                   children: [
                     const Text(
                       '地址转换统计',
                       style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
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
                           AppTheme.success,
                         ),
                         _buildTranslationStat(
                           '失败',
                           '${_translationHistory.where((r) => !r.success).length}',
                           Icons.error,
                           AppTheme.error,
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
             GlassCard(
               child: Padding(
                 padding: const EdgeInsets.all(16),
                 child: Column(
                   crossAxisAlignment: CrossAxisAlignment.start,
                   children: [
                     const Text(
                       '错误类型统计',
                       style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
                     ),
                     const SizedBox(height: 16),
                     
                     ...TranslationError.values.map((error) {
                       final count = _translationHistory
                           .where((r) => r.error == error)
                           .length;
                       
                       return Container(
                          margin: const EdgeInsets.only(bottom: 8),
                          decoration: BoxDecoration(
                             color: Colors.white.withOpacity(0.05),
                             borderRadius: BorderRadius.circular(8),
                             border: Border.all(color: AppTheme.glassBorder)
                          ),
                          child: ListTile(
                           leading: const Icon(Icons.error_outline, color: AppTheme.error),
                           title: Text(error.message, style: const TextStyle(color: Colors.white70)),
                           trailing: Container(
                             padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                             decoration: BoxDecoration(
                               color: AppTheme.error.withOpacity(0.2),
                               borderRadius: BorderRadius.circular(12),
                               border: Border.all(color: AppTheme.error.withOpacity(0.3)),
                             ),
                             child: Text('$count', style: const TextStyle(color: AppTheme.error, fontWeight: FontWeight.bold)),
                           ),
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
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '逻辑地址输入',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 16,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 16),
            
            Row(
              children: [
                Expanded(
                  child: _buildNeonTextField(_segmentController, '段号'),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _buildNeonTextField(_pageController, '页号'),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _buildNeonTextField(_offsetController, '偏移'),
                ),
              ],
            ),
            
            const SizedBox(height: 16),
            
            // 访问类型选择
            const Text('访问类型:', style: TextStyle(color: AppTheme.textSecondary)),
            const SizedBox(height: 8),
            Container(
               padding: const EdgeInsets.all(4),
               decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.05),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.glassBorder),
               ),
               child: Row(
                  children: AccessType.values.map((type) {
                     final isSelected = _selectedAccessType == type;
                     return Expanded(
                        child: GestureDetector(
                           onTap: () {
                              setState(() {
                                 _selectedAccessType = type;
                              });
                           },
                           child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              decoration: BoxDecoration(
                                 color: isSelected ? type.color.withOpacity(0.2) : Colors.transparent,
                                 borderRadius: BorderRadius.circular(6),
                                 border: isSelected ? Border.all(color: type.color.withOpacity(0.5)) : null,
                              ),
                              child: Row(
                                 mainAxisAlignment: MainAxisAlignment.center,
                                 children: [
                                    Icon(type.icon, size: 16, color: isSelected ? type.color : Colors.white60),
                                    const SizedBox(width: 4),
                                    Text(
                                       type.label,
                                       style: TextStyle(
                                          color: isSelected ? type.color : Colors.white60,
                                          fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                                          fontSize: 12
                                       ),
                                    ),
                                 ],
                              ),
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
  
  Widget _buildNeonTextField(TextEditingController controller, String label) {
     return TextField(
        controller: controller,
        style: const TextStyle(color: Colors.white, fontFamily: AppTheme.codeFont),
        decoration: InputDecoration(
           labelText: label,
           labelStyle: const TextStyle(color: AppTheme.textSecondary),
           border: const OutlineInputBorder(),
           enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: AppTheme.glassBorder)),
           focusedBorder: const OutlineInputBorder(borderSide: BorderSide(color: AppTheme.primary)),
           filled: true,
           fillColor: Colors.white.withOpacity(0.05),
           isDense: true,
        ),
        keyboardType: TextInputType.number,
     );
  }
  
  Widget _buildControlButtons() {
    return Column(
      children: [
        NeonButton(
          onPressed: _executeAddressTranslation,
          text: '执行地址转换',
          icon: Icons.transform,
          isPrimary: true,
          width: double.infinity,
          height: 48,
        ),
        const SizedBox(height: 12),
        SizedBox(
           width: double.infinity,
           child: OutlinedButton.icon(
              onPressed: _generateRandomAddress,
              icon: const Icon(Icons.shuffle, color: AppTheme.secondary),
              label: const Text('生成随机地址'),
              style: OutlinedButton.styleFrom(
                 foregroundColor: AppTheme.secondary,
                 side: const BorderSide(color: AppTheme.secondary),
                 padding: const EdgeInsets.symmetric(vertical: 12),
                 shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
           ),
        ),
      ],
    );
  }
  
  Widget _buildTranslationHistory() {
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '转换历史',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
            ),
            const SizedBox(height: 12),
            
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: _translationHistory.length > 5 ? 5 : _translationHistory.length,
              itemBuilder: (context, index) {
                final result = _translationHistory[_translationHistory.length - 1 - index];
                return Container(
                   margin: const EdgeInsets.only(bottom: 8),
                   decoration: BoxDecoration(
                      border: Border(bottom: BorderSide(color: AppTheme.glassBorder)),
                   ),
                   child: ListTile(
                     dense: true,
                     contentPadding: EdgeInsets.zero,
                     leading: Icon(
                       result.success ? Icons.check_circle : Icons.error,
                       color: result.success ? AppTheme.success : AppTheme.error,
                       size: 20,
                     ),
                     title: Text(
                       result.success 
                           ? result.physicalAddress.toString()
                           : result.errorMessage,
                       style: const TextStyle(fontSize: 12, color: Colors.white70, fontFamily: AppTheme.codeFont),
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
  
  Widget _buildPlaybackControls() {
    if (_translationResult == null) return const SizedBox.shrink();
    
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  icon: const Icon(Icons.skip_previous, color: Colors.white),
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
                  onPressed: _isPlaying ? _pauseSteps : _playSteps,
                  child: Icon(_isPlaying ? Icons.pause : Icons.play_arrow),
                ),
                IconButton(
                  icon: const Icon(Icons.navigate_next, color: Colors.white),
                  onPressed: _currentStepIndex < _translationResult!.steps.length - 1 ? () {
                    setState(() => _currentStepIndex++);
                  } : null,
                ),
                IconButton(
                  icon: const Icon(Icons.skip_next, color: Colors.white),
                  onPressed: () {
                    setState(() => _currentStepIndex = _translationResult!.steps.length - 1);
                  },
                ),
              ],
            ),
            const SizedBox(height: 8),
            LinearProgressIndicator(
              value: (_currentStepIndex + 1) / _translationResult!.steps.length,
              backgroundColor: Colors.white10,
              color: AppTheme.primary,
            ),
            const SizedBox(height: 8),
            Text(
               '步骤 ${_currentStepIndex + 1} / ${_translationResult!.steps.length}',
               style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
            ),
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
            fontFamily: AppTheme.codeFont,
          ),
        ),
        Text(
          label,
          style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
        ),
      ],
    );
  }
  
  LogicalAddress? _getLogicalAddressFromResult() {
    if (_translationResult == null) return null;
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
        backgroundColor: AppTheme.surface,
        title: const Text('段页式内存管理帮助', style: TextStyle(color: Colors.white)),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '段页式内存管理：',
                style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primary),
              ),
              SizedBox(height: 8),
              Text('段页式内存管理结合了段式和页式管理的优点，将程序按逻辑分段，每段又分成固定大小的页面。', style: TextStyle(color: Colors.white70)),
              SizedBox(height: 16),
              Text(
                '地址转换过程：',
                style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primary),
              ),
              SizedBox(height: 8),
              Text('1. 根据段号查找段表，获取页表基址', style: TextStyle(color: Colors.white70)),
              Text('2. 根据页号查找页表，获取页框号', style: TextStyle(color: Colors.white70)),
              Text('3. 计算物理地址 = 页框号 × 页面大小 + 页内偏移', style: TextStyle(color: Colors.white70)),
              SizedBox(height: 16),
              Text(
                '使用说明：',
                style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primary),
              ),
              SizedBox(height: 8),
              Text('• 在地址转换页面输入逻辑地址（段号、页号、偏移）', style: TextStyle(color: Colors.white70)),
              Text('• 选择访问类型（读、写、执行）', style: TextStyle(color: Colors.white70)),
              Text('• 点击"执行地址转换"查看转换过程', style: TextStyle(color: Colors.white70)),
              Text('• 在内存视图页面查看段表、页表和物理内存状态', style: TextStyle(color: Colors.white70)),
              Text('• 在统计页面查看系统使用情况和错误统计', style: TextStyle(color: Colors.white70)),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('关闭', style: TextStyle(color: AppTheme.primary)),
          ),
        ],
      ),
    );
  }
}
