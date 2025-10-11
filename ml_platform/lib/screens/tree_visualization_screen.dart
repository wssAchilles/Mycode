// 树形结构可视化页面
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'dart:math' as math;
import 'package:ml_platform/models/visualization_state.dart';
import 'package:ml_platform/services/tree_service.dart';
import 'package:ml_platform/widgets/tree_visualizer.dart';
import 'package:ml_platform/widgets/common/control_panel.dart';

class TreeVisualizationScreen extends StatefulWidget {
  final String? treeType; // 'bst' or 'avl'
  
  const TreeVisualizationScreen({Key? key, this.treeType}) : super(key: key);
  
  @override
  State<TreeVisualizationScreen> createState() => _TreeVisualizationScreenState();
}

class _TreeVisualizationScreenState extends State<TreeVisualizationScreen>
    with TickerProviderStateMixin {
  final TreeService _treeService = TreeService();
  late AnimationController _animationController;
  
  BSTNode? _root;
  List<TreeStep> _steps = [];
  int _currentStepIndex = 0;
  bool _isPlaying = false;
  bool _isAVL = false;
  
  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(seconds: 1),
      vsync: this,
    )..repeat();
    
    _isAVL = widget.treeType == 'avl';
    _generateRandomTree();
  }
  
  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }
  
  void _generateRandomTree() {
    setState(() {
      _root = null;
      _steps = [];
      _currentStepIndex = 0;
    });
    
    // 生成随机数并插入树
    final random = math.Random();
    final values = <int>[];
    for (int i = 0; i < 7; i++) {
      values.add(random.nextInt(100));
    }
    
    for (final value in values) {
      if (_isAVL) {
        _root = _insertAVL(value);
      } else {
        _root = _insertBST(value);
      }
    }
    
    setState(() {});
  }
  
  BSTNode? _insertBST(int value) {
    if (_root == null) {
      return BSTNode(value);
    }
    return _insertBSTHelper(_root!, value);
  }
  
  BSTNode _insertBSTHelper(BSTNode node, int value) {
    if (value < node.value) {
      if (node.left == null) {
        node.left = BSTNode(value);
      } else {
        node.left = _insertBSTHelper(node.left!, value);
      }
    } else if (value > node.value) {
      if (node.right == null) {
        node.right = BSTNode(value);
      } else {
        node.right = _insertBSTHelper(node.right!, value);
      }
    }
    return node;
  }
  
  BSTNode? _insertAVL(int value) {
    final steps = _treeService.avlInsert(_root, value);
    if (steps.isNotEmpty && steps.last.root != null) {
      return steps.last.root;
    }
    return _root;
  }
  
  void _executeOperation(String operation, int value) {
    List<TreeStep> newSteps = [];
    
    switch (operation) {
      case 'insert':
        if (_isAVL) {
          newSteps = _treeService.avlInsert(_root, value);
        } else {
          newSteps = _treeService.bstInsert(_root, value);
        }
        break;
      case 'delete':
        if (_isAVL) {
          newSteps = _treeService.avlDelete(_root, value);
        } else {
          newSteps = _treeService.bstDelete(_root, value);
        }
        break;
      case 'search':
        newSteps = _treeService.bstSearch(_root, value);
        break;
    }
    
    if (newSteps.isNotEmpty) {
      setState(() {
        _steps = newSteps;
        _currentStepIndex = 0;
        
        // 更新根节点（对于插入和删除操作）
        if (operation != 'search' && newSteps.last.root != null) {
          _root = newSteps.last.root;
        }
      });
      
      _playSteps();
    }
  }
  
  void _playSteps() async {
    if (_steps.isEmpty) return;
    
    setState(() => _isPlaying = true);
    
    for (int i = 0; i < _steps.length; i++) {
      if (!mounted || !_isPlaying) break;
      
      setState(() => _currentStepIndex = i);
      
      // 等待一段时间显示当前步骤
      await Future.delayed(const Duration(seconds: 1));
    }
    
    setState(() => _isPlaying = false);
  }
  
  void _pauseSteps() {
    setState(() => _isPlaying = false);
  }
  
  void _resetTree() {
    setState(() {
      _root = null;
      _steps = [];
      _currentStepIndex = 0;
      _isPlaying = false;
    });
  }
  
  void _stepForward() {
    if (_currentStepIndex < _steps.length - 1) {
      setState(() => _currentStepIndex++);
    }
  }
  
  void _stepBackward() {
    if (_currentStepIndex > 0) {
      setState(() => _currentStepIndex--);
    }
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final currentStep = _steps.isNotEmpty ? _steps[_currentStepIndex] : null;
    
    return Scaffold(
      appBar: AppBar(
        title: Text(_isAVL ? 'AVL树可视化' : '二叉搜索树可视化'),
        actions: [
          // 切换树类型
          IconButton(
            icon: Icon(_isAVL ? Icons.account_tree : Icons.park),
            onPressed: () {
              setState(() {
                _isAVL = !_isAVL;
                _resetTree();
              });
            },
            tooltip: _isAVL ? '切换到BST' : '切换到AVL',
          ),
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
            width: 350,
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                // 树操作控制面板
                TreeControlPanel(
                  isAVL: _isAVL,
                  onOperation: _executeOperation,
                  onReset: _resetTree,
                  onGenerateRandom: _generateRandomTree,
                ),
                const SizedBox(height: 16),
                
                // 播放控制
                if (_steps.isNotEmpty) ...[
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '步骤控制',
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 12),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              IconButton(
                                icon: const Icon(Icons.skip_previous),
                                onPressed: _currentStepIndex > 0 ? _stepBackward : null,
                              ),
                              IconButton(
                                icon: Icon(_isPlaying ? Icons.pause : Icons.play_arrow),
                                onPressed: _isPlaying ? _pauseSteps : _playSteps,
                              ),
                              IconButton(
                                icon: const Icon(Icons.skip_next),
                                onPressed: _currentStepIndex < _steps.length - 1
                                    ? _stepForward
                                    : null,
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          LinearProgressIndicator(
                            value: _steps.isNotEmpty
                                ? (_currentStepIndex + 1) / _steps.length
                                : 0,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            '步骤 ${_currentStepIndex + 1} / ${_steps.length}',
                            style: theme.textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
                
                // 当前步骤描述
                if (currentStep != null) ...[
                  Expanded(
                    child: Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '当前步骤',
                              style: theme.textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 12),
                            Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: theme.colorScheme.surfaceVariant.withOpacity(0.5),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                currentStep.description,
                                style: theme.textTheme.bodyLarge,
                              ),
                            ),
                            if (currentStep.searchPath.isNotEmpty) ...[
                              const SizedBox(height: 12),
                              Text(
                                '访问路径',
                                style: theme.textTheme.bodyMedium?.copyWith(
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Wrap(
                                spacing: 8,
                                children: currentStep.searchPath.map((value) {
                                  return Chip(
                                    label: Text(value.toString()),
                                    backgroundColor: Colors.orange.shade100,
                                  );
                                }).toList(),
                              ),
                            ],
                            if (currentStep.rotationType != null) ...[
                              const SizedBox(height: 12),
                              Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: Colors.purple.shade50,
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: Colors.purple.shade200),
                                ),
                                child: Row(
                                  children: [
                                    Icon(
                                      Icons.rotate_right,
                                      color: Colors.purple.shade600,
                                    ),
                                    const SizedBox(width: 8),
                                    Text(
                                      '旋转类型：${_getRotationName(currentStep.rotationType!)}',
                                      style: TextStyle(
                                        color: Colors.purple.shade800,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ],
                        ),
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
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: currentStep != null
                      ? TreeVisualizer(
                          root: currentStep.root ?? _root,
                          searchPath: currentStep.searchPath,
                          highlightNode: currentStep.highlightNode,
                          rotationType: currentStep.rotationType,
                          animationController: _animationController,
                        )
                      : TreeVisualizer(
                          root: _root,
                          animationController: _animationController,
                        ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
  
  String _getRotationName(String type) {
    switch (type) {
      case 'left':
        return '左旋';
      case 'right':
        return '右旋';
      case 'left-right':
        return '左右双旋';
      case 'right-left':
        return '右左双旋';
      default:
        return type;
    }
  }
  
  void _showHelpDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('树结构可视化帮助'),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                '基本操作：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              const Text('• 插入：向树中添加新节点'),
              const Text('• 删除：从树中移除指定节点'),
              const Text('• 查找：搜索指定值是否存在'),
              const SizedBox(height: 16),
              const Text(
                '颜色说明：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              _buildColorLegend(Colors.blue, '普通节点'),
              _buildColorLegend(Colors.red, '高亮节点'),
              _buildColorLegend(Colors.orange, '搜索路径'),
              _buildColorLegend(Colors.purple, 'AVL旋转'),
              const SizedBox(height: 16),
              const Text(
                'AVL树特性：',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              const Text('• 自动保持平衡'),
              const Text('• 任意节点左右子树高度差不超过1'),
              const Text('• 通过旋转操作维持平衡'),
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
