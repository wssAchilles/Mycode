// 图结构可视化页面
import 'package:flutter/material.dart';
import 'package:ml_platform/services/graph_service.dart';
import 'package:ml_platform/widgets/graph_visualizer.dart';
import 'package:ml_platform/widgets/code_display.dart';
import 'package:ml_platform/utils/responsive_layout.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/widgets/common/glass_widgets.dart';

class GraphVisualizationScreen extends StatefulWidget {
  const GraphVisualizationScreen({Key? key}) : super(key: key);
  
  @override
  State<GraphVisualizationScreen> createState() => _GraphVisualizationScreenState();
}

class _GraphVisualizationScreenState extends State<GraphVisualizationScreen>
    with TickerProviderStateMixin {
  final GraphService _graphService = GraphService();
  late AnimationController _animationController;
  late AnimationController _stepAnimationController;
  late Animation<double> _stepAnimation;
  
  Map<String, GraphVertex> _graph = {};
  List<GraphStep> _steps = [];
  int _currentStepIndex = 0;
  bool _isPlaying = false;
  String? _currentAlgorithm;
  
  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(seconds: 1),
      vsync: this,
    )..repeat();
    
    _stepAnimationController = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    );
    
    _stepAnimation = CurvedAnimation(
      parent: _stepAnimationController,
      curve: Curves.easeInOut,
    );
    
    _generateSampleGraph();
  }
  
  @override
  void dispose() {
    _animationController.dispose();
    _stepAnimationController.dispose();
    super.dispose();
  }
  
  void _generateSampleGraph() {
    setState(() {
      _graph = _graphService.generateSampleGraph();
      _steps = [];
      _currentStepIndex = 0;
      _isPlaying = false;
    });
    
    // 自动布局
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final RenderBox renderBox = context.findRenderObject() as RenderBox;
      final size = renderBox.size;
      _graphService.autoLayout(_graph, size.width * 0.6, size.height * 0.8);
      setState(() {});
    });
  }
  
  void _executeAlgorithm(String algorithm, String? startNode, String? endNode) {
    if (!_graph.containsKey(startNode)) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('节点 $startNode 不存在')),
      );
      return;
    }
    
    if (endNode != null && !_graph.containsKey(endNode)) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('节点 $endNode 不存在')),
      );
      return;
    }
    
    List<GraphStep> newSteps = [];
    
    switch (algorithm) {
      case 'dfs':
        newSteps = _graphService.dfs(_graph, startNode!, endNode);
        break;
      case 'bfs':
        newSteps = _graphService.bfs(_graph, startNode!, endNode);
        break;
      case 'dijkstra':
        if (endNode != null) {
          newSteps = _graphService.dijkstra(_graph, startNode!, endNode);
        }
        break;
    }
    
    if (newSteps.isNotEmpty) {
      setState(() {
        _steps = newSteps;
        _currentStepIndex = 0;
        _currentAlgorithm = algorithm;
      });
      
      _playSteps();
    }
  }
  
  void _playSteps() async {
    if (_steps.isEmpty) return;
    
    setState(() => _isPlaying = true);
    
    for (int i = _currentStepIndex; i < _steps.length; i++) {
      if (!mounted || !_isPlaying) break;
      
      setState(() => _currentStepIndex = i);
      
      // 触发步骤动画
      _stepAnimationController.forward(from: 0);
      
      // 等待一段时间显示当前步骤
      await Future.delayed(const Duration(milliseconds: 1500));
    }
    
    setState(() => _isPlaying = false);
  }
  
  void _pauseSteps() {
    setState(() => _isPlaying = false);
  }
  
  void _resetGraph() {
    setState(() {
      _graph = {};
      _steps = [];
      _currentStepIndex = 0;
      _isPlaying = false;
      _currentAlgorithm = null;
    });
  }
  
  void _stepForward() {
    if (_currentStepIndex < _steps.length - 1) {
      setState(() => _currentStepIndex++);
      _stepAnimationController.forward(from: 0);
    }
  }
  
  void _stepBackward() {
    if (_currentStepIndex > 0) {
      setState(() => _currentStepIndex--);
      _stepAnimationController.forward(from: 0);
    }
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final currentStep = _steps.isNotEmpty ? _steps[_currentStepIndex] : null;
    
    return Scaffold(
      appBar: AppBar(
        title: const Text('图算法可视化'),
        actions: [
          IconButton(
            icon: const Icon(Icons.help_outline),
            onPressed: () => _showHelpDialog(context),
            tooltip: '帮助',
          ),
        ],
      ),
      body: ResponsiveLayout(
        mobile: _buildMobileLayout(theme, currentStep),
        desktop: _buildDesktopLayout(theme, currentStep),
      ),
    );
  }

  Widget _buildControlPanel(ThemeData theme, GraphStep? currentStep) {
    return Column(
      children: [
        // 图操作控制面板
        GraphControlPanel(
          onExecute: _executeAlgorithm,
          onReset: _resetGraph,
          onGenerateRandom: _generateSampleGraph,
          onAddNode: (nodeId) {
            // 添加节点功能
          },
          onAddEdge: (from, to, weight) {
            // 添加边功能
          },
        ),
        const SizedBox(height: AppSpacing.md),
        
        // 播放控制
        if (_steps.isNotEmpty) ...[
          GlassCard(
            title: '步骤控制',
            icon: Icons.play_circle_outline,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.skip_previous),
                      onPressed: _currentStepIndex > 0 ? _stepBackward : null,
                      tooltip: '上一步',
                    ),
                    IconButton(
                      icon: Icon(_isPlaying ? Icons.pause : Icons.play_arrow),
                      onPressed: _isPlaying ? _pauseSteps : _playSteps,
                      tooltip: _isPlaying ? '暂停' : '播放',
                    ),
                    IconButton(
                      icon: const Icon(Icons.skip_next),
                      onPressed: _currentStepIndex < _steps.length - 1
                          ? _stepForward
                          : null,
                      tooltip: '下一步',
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                LinearProgressIndicator(
                  value: _steps.isNotEmpty
                      ? (_currentStepIndex + 1) / _steps.length
                      : 0,
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  '步骤 ${_currentStepIndex + 1} / ${_steps.length}',
                  style: theme.textTheme.bodySmall,
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.md),
        ],
        
        // 当前步骤信息
        if (currentStep != null)
          GlassCard(
            title: '当前步骤',
            icon: Icons.timeline,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                GlassContainer(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  borderRadius: BorderRadius.circular(AppRadii.sm),
                  child: Text(
                    currentStep.description,
                    style: theme.textTheme.bodyLarge,
                  ),
                ),
                  
                // 显示栈或队列
                if (currentStep.stack != null) ...[
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    '栈：${currentStep.stack!.join(" → ")}',
                    style: theme.textTheme.bodyMedium,
                  ),
                ],
                if (currentStep.queue != null) ...[
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    '队列：${currentStep.queue!.join(" → ")}',
                    style: theme.textTheme.bodyMedium,
                  ),
                ],
                  
                // 显示距离（Dijkstra）
                if (currentStep.distances != null) ...[
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    '节点距离：',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.xs,
                    children: currentStep.distances!.entries.map((entry) {
                      final distance = entry.value == 999999 ? '∞' : entry.value.toString();
                      return Chip(
                        label: Text('${entry.key}: $distance'),
                        backgroundColor: currentStep.currentVertex == entry.key
                            ? AppTheme.primary.withOpacity(0.2)
                            : AppTheme.surfaceHighlight,
                      );
                    }).toList(),
                  ),
                ],
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildVisualizationPanel(GraphStep? currentStep) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: GlassContainer(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: AnimatedBuilder(
          animation: _stepAnimation,
          builder: (context, child) {
            return GraphVisualizer(
              vertices: currentStep?.vertices ?? _graph,
              currentVertex: currentStep?.currentVertex,
              visitedVertices: currentStep?.visitedVertices ?? [],
              pathVertices: currentStep?.pathVertices ?? [],
              distances: currentStep?.distances,
              animationController: _animationController,
            );
          },
        ),
      ),
    );
  }

  Widget _buildDesktopLayout(ThemeData theme, GraphStep? currentStep) {
    return Row(
      children: [
        Container(
          width: 350,
          padding: const EdgeInsets.all(AppSpacing.md),
          child: SingleChildScrollView(
            child: _buildControlPanel(theme, currentStep),
          ),
        ),
        Expanded(
          child: _buildVisualizationPanel(currentStep),
        ),
        if (_currentAlgorithm != null)
          Container(
            width: 320,
            padding: const EdgeInsets.all(AppSpacing.md),
            child: CodeDisplay(
              algorithmName: _getAlgorithmDisplayName(_currentAlgorithm!),
              currentLine: _getCurrentCodeLine(currentStep),
              language: 'pseudocode',
            ),
          ),
      ],
    );
  }

  Widget _buildMobileLayout(ThemeData theme, GraphStep? currentStep) {
    return Column(
      children: [
        Expanded(
          flex: 3,
          child: _buildVisualizationPanel(currentStep),
        ),
        if (_currentAlgorithm != null)
          SizedBox(
            height: 200,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: CodeDisplay(
                algorithmName: _getAlgorithmDisplayName(_currentAlgorithm!),
                currentLine: _getCurrentCodeLine(currentStep),
                language: 'pseudocode',
              ),
            ),
          ),
        Expanded(
          flex: 2,
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: _buildControlPanel(theme, currentStep),
          ),
        ),
      ],
    );
  }
  
  String _getAlgorithmDisplayName(String algorithm) {
    switch (algorithm) {
      case 'dfs':
        return 'DFS';
      case 'bfs':
        return 'BFS';
      case 'dijkstra':
        return 'Dijkstra';
      default:
        return algorithm;
    }
  }
  
  int? _getCurrentCodeLine(GraphStep? step) {
    if (step == null) return null;
    // 根据步骤描述映射到代码行（简化实现）
    return (_currentStepIndex % 10) + 1;
  }
  
  void _showHelpDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('图算法可视化帮助'),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                '支持的算法：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              const Text('• DFS（深度优先搜索）：探索尽可能深的分支'),
              const Text('• BFS（广度优先搜索）：逐层探索所有节点'),
              const Text('• Dijkstra：寻找最短路径'),
              const SizedBox(height: 16),
              const Text(
                '颜色说明：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              _buildColorLegend(AppTheme.primary, '未访问节点'),
              _buildColorLegend(AppTheme.error, '当前节点'),
              _buildColorLegend(AppTheme.warning, '已访问节点'),
              _buildColorLegend(AppTheme.success, '最短路径'),
              const SizedBox(height: 16),
              const Text(
                '操作说明：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              const Text('• 点击节点可以选中'),
              const Text('• 鼠标悬停显示节点信息'),
              const Text('• 使用控制面板执行算法'),
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
  
  Widget _buildColorLegend(Color color, String label) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Container(
            width: 16,
            height: 16,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 8),
          Text(label),
        ],
      ),
    );
  }
}
