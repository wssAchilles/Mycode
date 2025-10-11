// 排序算法页面
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:go_router/go_router.dart';
import 'package:ml_platform/models/algorithm_model.dart';
import 'package:ml_platform/models/visualization_state.dart';
import 'package:ml_platform/services/algorithm_service.dart';
import 'package:ml_platform/widgets/sorting_visualizer.dart';
import 'package:ml_platform/widgets/common/control_panel.dart';

class SortingScreen extends StatefulWidget {
  final String? algorithmType;

  const SortingScreen({Key? key, this.algorithmType}) : super(key: key);

  @override
  State<SortingScreen> createState() => _SortingScreenState();
}

class _SortingScreenState extends State<SortingScreen> with TickerProviderStateMixin {
  late AnimationController _animationController;
  late AnimationController _stepAnimationController;
  late Animation<double> _stepAnimation;
  late Animation<double> _colorAnimation;
  final AlgorithmService _algorithmService = AlgorithmService();
  List<SortingStep> _steps = [];
  Timer? _playTimer;
  int _currentStepIndex = 0;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );
    
    // 步骤动画控制器
    _stepAnimationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );
    
    // 使用缓动曲线
    _stepAnimation = CurvedAnimation(
      parent: _stepAnimationController,
      curve: Curves.easeInOut,
    );
    
    // 颜色变化动画
    _colorAnimation = CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeInOutCubic,
    );
    
    // 初始化数据
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final state = context.read<VisualizationState>();
      state.generateRandomData(20);
      if (widget.algorithmType != null) {
        state.setSelectedType(widget.algorithmType!);
      }
    });
  }

  @override
  void dispose() {
    _animationController.dispose();
    _stepAnimationController.dispose();
    _playTimer?.cancel();
    super.dispose();
  }

  Future<void> _executeAlgorithm(AlgorithmType type) async {
    final state = context.read<VisualizationState>();
    state.setLoading(true);
    
    try {
      _steps = await _algorithmService.executeSort(type, state.inputData);
      state.setTotalSteps(_steps.length);
      state.setLoading(false);
    } catch (e) {
      state.setError('执行算法时出错: $e');
      state.setLoading(false);
    }
  }

  void _play() {
    final state = context.read<VisualizationState>();
    state.setPlaybackState(PlaybackState.playing);
    
    _playTimer = Timer.periodic(
      Duration(milliseconds: (1000 / state.config.animationSpeed).round()),
      (timer) {
        if (state.currentStep >= state.totalSteps - 1) {
          _pause();
          state.setPlaybackState(PlaybackState.finished);
        } else {
          state.nextStep();
        }
      },
    );
  }

  void _pause() {
    _playTimer?.cancel();
    context.read<VisualizationState>().setPlaybackState(PlaybackState.paused);
  }

  void _reset() {
    _playTimer?.cancel();
    final state = context.read<VisualizationState>();
    state.resetSteps();
    _steps.clear();
  }

  void _stepForward() {
    context.read<VisualizationState>().nextStep();
  }

  void _stepBackward() {
    context.read<VisualizationState>().previousStep();
  }

  void _generateRandomData() {
    final state = context.read<VisualizationState>();
    state.generateRandomData(state.config.dataSize);
    _reset();
  }

  void _onSpeedChanged(double speed) {
    final state = context.read<VisualizationState>();
    state.updateConfig(state.config.copyWith(animationSpeed: speed));
    
    // 如果正在播放，重新启动定时器以应用新速度
    if (state.playbackState == PlaybackState.playing) {
      _playTimer?.cancel();
      _play();
    }
  }

  void _onDataSizeChanged(int size) {
    final state = context.read<VisualizationState>();
    state.updateConfig(state.config.copyWith(dataSize: size));
    state.generateRandomData(size);
    _reset();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('排序算法可视化'),
        actions: [
          IconButton(
            icon: const Icon(Icons.help_outline),
            onPressed: () => _showHelpDialog(context),
            tooltip: '帮助',
          ),
        ],
      ),
      body: Consumer<VisualizationState>(
        builder: (context, state, child) {
          return Row(
            children: [
              // 左侧控制面板
              Container(
                width: 320,
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    // 算法选择
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  '选择算法',
                                  style: theme.textTheme.titleMedium?.copyWith(
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                ElevatedButton.icon(
                                  onPressed: () => context.go('/sorting/comparison'),
                                  icon: const Icon(Icons.compare_arrows, size: 18),
                                  label: const Text('性能对比'),
                                  style: ElevatedButton.styleFrom(
                                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                    backgroundColor: theme.colorScheme.secondary,
                                    foregroundColor: Colors.white,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: AlgorithmType.values.map((type) {
                                final isSelected = state.selectedType == type.name;
                                return ChoiceChip(
                                  label: Text(type.displayName),
                                  selected: isSelected,
                                  onSelected: (selected) {
                                    if (selected) {
                                      state.setSelectedType(type.name);
                                      _executeAlgorithm(type);
                                    }
                                  },
                                );
                              }).toList(),
                            ),
                          ],
                        ),
                      ),
                    ),
                    
                    const SizedBox(height: 16),
                    
                    // 控制面板
                    Expanded(
                      child: SingleChildScrollView(
                        child: ControlPanel(
                          onPlay: state.totalSteps > 0 ? _play : null,
                          onPause: _pause,
                          onReset: _reset,
                          onStepForward: _stepForward,
                          onStepBackward: _stepBackward,
                          onGenerateData: _generateRandomData,
                          onSpeedChanged: _onSpeedChanged,
                          onDataSizeChanged: _onDataSizeChanged,
                        ),
                      ),
                    ),
                    
                    // 算法复杂度信息
                    if (state.selectedType != null) ...[
                      const SizedBox(height: 16),
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '算法复杂度',
                                style: theme.textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const SizedBox(height: 12),
                              Row(
                                children: [
                                  Icon(Icons.schedule, size: 16, color: theme.primaryColor),
                                  const SizedBox(width: 8),
                                  Text(
                                    '时间复杂度: ${_algorithmService.getTimeComplexity(
                                      AlgorithmType.values.firstWhere(
                                        (type) => type.name == state.selectedType,
                                      ),
                                    )}',
                                    style: theme.textTheme.bodyMedium,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  Icon(Icons.memory, size: 16, color: theme.primaryColor),
                                  const SizedBox(width: 8),
                                  Text(
                                    '空间复杂度: ${_algorithmService.getSpaceComplexity(
                                      AlgorithmType.values.firstWhere(
                                        (type) => type.name == state.selectedType,
                                      ),
                                    )}',
                                    style: theme.textTheme.bodyMedium,
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              
              // 右侧可视化区域
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      // 可视化区域
                      Expanded(
                        child: Card(
                          child: Padding(
                            padding: const EdgeInsets.all(16.0),
                            child: SortingVisualizer(
                              step: _steps.isNotEmpty ? _steps[_currentStepIndex] : SortingStep(
                                array: [],
                                description: '初始状态',
                                stepNumber: 0,
                              ),
                              animationController: _stepAnimationController,
                            ),
                          ),
                        ),
                      ),
                      
                      // 步骤描述
                      if (_steps.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Card(
                          child: Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '当前步骤',
                                  style: theme.textTheme.titleSmall?.copyWith(
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  _steps[state.currentStep].description,
                                  style: theme.textTheme.bodyLarge,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  void _showHelpDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('使用帮助'),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('1. 选择要学习的排序算法'),
              SizedBox(height: 8),
              Text('2. 使用控制面板调整动画速度和数据规模'),
              SizedBox(height: 8),
              Text('3. 点击"生成随机数据"创建新的测试数据'),
              SizedBox(height: 8),
              Text('4. 使用播放按钮开始动画，或使用步进按钮逐步查看'),
              SizedBox(height: 8),
              Text('5. 观察算法的执行过程和性能指标'),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('知道了'),
          ),
        ],
      ),
    );
  }
}
