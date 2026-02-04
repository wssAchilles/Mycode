import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:ml_platform/config/app_theme.dart';
import '../models/tutorial_model.dart';
import '../services/tutorial_service.dart';

/// 教程侧边栏组件
class TutorialSidebar extends StatefulWidget {
  final String tutorialId;
  final int currentStep;
  final bool isExpanded;
  final Function(bool)? onExpandedChanged;
  final Function(int)? onStepSelected;
  final double width;

  const TutorialSidebar({
    Key? key,
    required this.tutorialId,
    this.currentStep = 0,
    this.isExpanded = true,
    this.onExpandedChanged,
    this.onStepSelected,
    this.width = 350,
  }) : super(key: key);

  @override
  State<TutorialSidebar> createState() => _TutorialSidebarState();
}

class _TutorialSidebarState extends State<TutorialSidebar>
    with SingleTickerProviderStateMixin {
  final TutorialService _tutorialService = TutorialService();
  Tutorial? _tutorial;
  bool _isLoading = true;
  late AnimationController _animationController;
  late Animation<double> _slideAnimation;
  late bool _isExpanded;
  
  // 滚动控制器
  final ScrollController _scrollController = ScrollController();
  final Map<int, GlobalKey> _stepKeys = {};

  @override
  void initState() {
    super.initState();
    _isExpanded = widget.isExpanded;
    
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 300),
      vsync: this,
    );
    
    _slideAnimation = Tween<double>(
      begin: 0.0,
      end: 1.0,
    ).animate(CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeInOut,
    ));
    
    if (_isExpanded) {
      _animationController.value = 1.0;
    }
    
    _loadTutorial();
  }

  @override
  void didUpdateWidget(TutorialSidebar oldWidget) {
    super.didUpdateWidget(oldWidget);
    
    if (oldWidget.tutorialId != widget.tutorialId) {
      _loadTutorial();
    }
    
    if (oldWidget.currentStep != widget.currentStep) {
      _scrollToCurrentStep();
    }
    
    if (oldWidget.isExpanded != widget.isExpanded) {
      _toggleExpanded();
    }
  }

  @override
  void dispose() {
    _animationController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  /// 加载教程
  Future<void> _loadTutorial() async {
    setState(() => _isLoading = true);
    
    final tutorial = await _tutorialService.getTutorial(widget.tutorialId);
    
    if (mounted) {
      setState(() {
        _tutorial = tutorial;
        _isLoading = false;
      });
      
      // 初始化步骤键
      if (tutorial != null) {
        for (int i = 0; i < tutorial.steps.length; i++) {
          _stepKeys[i] = GlobalKey();
        }
        
        // 滚动到当前步骤
        WidgetsBinding.instance.addPostFrameCallback((_) {
          _scrollToCurrentStep();
        });
      }
    }
  }

  /// 切换展开/折叠
  void _toggleExpanded() {
    setState(() {
      _isExpanded = !_isExpanded;
    });
    
    if (_isExpanded) {
      _animationController.forward();
    } else {
      _animationController.reverse();
    }
    
    widget.onExpandedChanged?.call(_isExpanded);
  }

  /// 滚动到当前步骤
  void _scrollToCurrentStep() {
    if (!_scrollController.hasClients) return;
    
    final key = _stepKeys[widget.currentStep];
    if (key?.currentContext != null) {
      Scrollable.ensureVisible(
        key!.currentContext!,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return AnimatedBuilder(
      animation: _slideAnimation,
      builder: (context, child) {
        return Container(
          width: _slideAnimation.value * widget.width,
          decoration: BoxDecoration(
            color: AppTheme.surface,
            boxShadow: [
              BoxShadow(
                color: AppTheme.borderStrong,
                blurRadius: 6,
                offset: const Offset(-2, 0),
              ),
            ],
          ),
          child: Row(
            children: [
              // 展开/折叠按钮
              Container(
                width: 40,
                color: theme.primaryColor,
                child: IconButton(
                  icon: Icon(
                    _isExpanded ? Icons.chevron_right : Icons.chevron_left,
                    color: AppTheme.textPrimary,
                  ),
                  onPressed: _toggleExpanded,
                  tooltip: _isExpanded ? '折叠' : '展开',
                ),
              ),
              // 教程内容
              if (_isExpanded)
                Expanded(
                  child: _isLoading
                      ? const Center(child: CircularProgressIndicator())
                      : _tutorial != null
                          ? _buildTutorialContent()
                          : _buildEmptyState(),
                ),
            ],
          ),
        );
      },
    );
  }

  /// 构建教程内容
  Widget _buildTutorialContent() {
    final tutorial = _tutorial!;
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 教程标题
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppTheme.surfaceHighlight,
            border: Border(
              bottom: const BorderSide(color: AppTheme.borderSubtle),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                tutorial.title,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  _buildDifficultyBadge(tutorial.difficulty),
                  const SizedBox(width: 8),
                  const Icon(Icons.timer, size: 14, color: AppTheme.textSecondary),
                  const SizedBox(width: 4),
                  Text(
                    '${tutorial.estimatedMinutes}分钟',
                    style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                  ),
                  const SizedBox(width: 8),
                  const Icon(Icons.flag, size: 14, color: AppTheme.textSecondary),
                  const SizedBox(width: 4),
                  Text(
                    '${widget.currentStep + 1}/${tutorial.steps.length}',
                    style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              // 进度条
              LinearProgressIndicator(
                value: (widget.currentStep + 1) / tutorial.steps.length,
                backgroundColor: AppTheme.borderSubtle,
                valueColor: AlwaysStoppedAnimation<Color>(
                  Theme.of(context).primaryColor,
                ),
              ),
            ],
          ),
        ),
        
        // 学习目标
        if (tutorial.objectives.isNotEmpty)
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppTheme.primary.withOpacity(0.08),
              border: Border(
                bottom: const BorderSide(color: AppTheme.borderSubtle),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.lightbulb, size: 16, color: AppTheme.primary),
                    const SizedBox(width: 8),
                    Text(
                      '学习目标',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.primary,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                ...tutorial.objectives.map((objective) => Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.check, size: 14, color: AppTheme.primary),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          objective,
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                    ],
                  ),
                )),
              ],
            ),
          ),
        
        // 教程步骤
        Expanded(
          child: ListView.builder(
            controller: _scrollController,
            padding: const EdgeInsets.all(16),
            itemCount: tutorial.steps.length,
            itemBuilder: (context, index) {
              final step = tutorial.steps[index];
              final isCurrentStep = index == widget.currentStep;
              
              return _buildStepCard(
                key: _stepKeys[index],
                step: step,
                index: index,
                isCurrentStep: isCurrentStep,
              );
            },
          ),
        ),
      ],
    );
  }

  /// 构建步骤卡片
  Widget _buildStepCard({
    Key? key,
    required TutorialStep step,
    required int index,
    required bool isCurrentStep,
  }) {
    return Container(
      key: key,
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: isCurrentStep
            ? AppTheme.primary.withOpacity(0.08)
            : AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isCurrentStep
              ? Theme.of(context).primaryColor
              : AppTheme.borderSubtle,
          width: isCurrentStep ? 2 : 1,
        ),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () => widget.onStepSelected?.call(index),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 步骤标题
                Row(
                  children: [
                    Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        color: isCurrentStep
                            ? Theme.of(context).primaryColor
                            : AppTheme.borderSubtle,
                        shape: BoxShape.circle,
                      ),
                      child: Center(
                        child: Text(
                          '${index + 1}',
                          style: TextStyle(
                            color: isCurrentStep
                                ? AppTheme.textPrimary
                                : AppTheme.textSecondary,
                            fontWeight: FontWeight.bold,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        step.title,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: isCurrentStep
                              ? Theme.of(context).primaryColor
                              : AppTheme.textPrimary,
                        ),
                      ),
                    ),
                  ],
                ),
                
                const SizedBox(height: 12),
                
                // 步骤描述
                Text(
                  step.description,
                  style: const TextStyle(fontSize: 14),
                ),
                
                // 代码片段
                if (step.codeSnippet != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppTheme.surface,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Stack(
                      children: [
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Text(
                            step.codeSnippet!,
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 12,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                        ),
                        Positioned(
                          top: 0,
                          right: 0,
                          child: IconButton(
                            icon: const Icon(Icons.copy, size: 16),
                            color: AppTheme.textSecondary,
                            onPressed: () {
                              Clipboard.setData(
                                ClipboardData(text: step.codeSnippet!),
                              );
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('代码已复制'),
                                  duration: Duration(seconds: 1),
                                ),
                              );
                            },
                            tooltip: '复制代码',
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                
                // 解释说明
                if (step.explanation != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppTheme.warning.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: AppTheme.warning.withOpacity(0.3)),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.info,
                          size: 16,
                          color: AppTheme.warning,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            step.explanation!,
                            style: TextStyle(
                              fontSize: 12,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                
                // 高亮要点
                if (step.highlights.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: step.highlights.map((highlight) {
                      return Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: Theme.of(context).primaryColor.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: Theme.of(context).primaryColor.withOpacity(0.3),
                          ),
                        ),
                        child: Text(
                          highlight,
                          style: TextStyle(
                            fontSize: 11,
                            color: Theme.of(context).primaryColor,
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// 构建难度徽章
  Widget _buildDifficultyBadge(int difficulty) {
    Color color;
    String text;
    
    switch (difficulty) {
      case 1:
        color = AppTheme.success;
        text = '入门';
        break;
      case 2:
        color = AppTheme.primary;
        text = '基础';
        break;
      case 3:
        color = AppTheme.warning;
        text = '中级';
        break;
      case 4:
        color = AppTheme.error;
        text = '高级';
        break;
      case 5:
        color = AppTheme.secondary;
        text = '专家';
        break;
      default:
        color = AppTheme.textSecondary;
        text = '未知';
    }
    
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: color),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 11,
          color: color,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  /// 构建空状态
  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.menu_book,
            size: 64,
            color: AppTheme.textSecondary,
          ),
          const SizedBox(height: 16),
          Text(
            '暂无教程',
            style: TextStyle(
              fontSize: 16,
              color: AppTheme.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}
