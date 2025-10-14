// 数据结构页面
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../models/data_structure_model.dart';
import '../widgets/data_structures/stack_visualizer.dart';
import '../widgets/data_structures/queue_visualizer.dart';
import '../widgets/data_structures/linked_list_visualizer.dart';

class DataStructureScreen extends StatefulWidget {
  final String? structureType;

  const DataStructureScreen({Key? key, this.structureType}) : super(key: key);

  @override
  State<DataStructureScreen> createState() => _DataStructureScreenState();
}

class _DataStructureScreenState extends State<DataStructureScreen> {
  DataStructureType? _selectedType;

  @override
  void initState() {
    super.initState();
    if (widget.structureType != null) {
      // 根据路径参数设置初始选中的数据结构类型
      _selectedType = DataStructureType.values.firstWhere(
        (type) => type.name == widget.structureType,
        orElse: () => DataStructureType.stack,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
          tooltip: '返回',
        ),
        title: const Text('数据结构可视化'),
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
          // 左侧数据结构选择面板
          Container(
            width: 320,
            decoration: BoxDecoration(
              color: theme.cardColor,
              border: Border(
                right: BorderSide(
                  color: theme.dividerColor,
                  width: 1,
                ),
              ),
            ),
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    '选择数据结构',
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    children: [
                      _buildCategoryTitle(context, '线性结构'),
                      _buildStructureCard(
                        context,
                        DataStructureType.stack,
                        Icons.layers,
                        '支持入栈、出栈操作的后进先出(LIFO)数据结构',
                      ),
                      _buildStructureCard(
                        context,
                        DataStructureType.queue,
                        Icons.queue,
                        '支持入队、出队操作的先进先出(FIFO)数据结构',
                      ),
                      _buildStructureCard(
                        context,
                        DataStructureType.linkedList,
                        Icons.link,
                        '动态链式存储结构，支持高效的插入和删除操作',
                      ),
                      const SizedBox(height: 16),
                      _buildCategoryTitle(context, '树形结构'),
                      _buildTreeCard(
                        context,
                        Icons.account_tree,
                        '二叉搜索树',
                        '有序的二叉树结构',
                        () => context.go('/data-structures/tree/bst'),
                      ),
                      _buildTreeCard(
                        context,
                        Icons.balance,
                        'AVL树',
                        '自平衡二叉搜索树',
                        () => context.go('/data-structures/tree/avl'),
                      ),
                      _buildStructureCard(
                        context,
                        DataStructureType.heap,
                        Icons.filter_list,
                        '完全二叉树，支持优先队列操作',
                      ),
                      const SizedBox(height: 16),
                      _buildCategoryTitle(context, '图结构'),
                      _buildTreeCard(
                        context,
                        Icons.hub,
                        '图算法',
                        '由顶点和边组成的网络结构，支持DFS、BFS、Dijkstra等算法',
                        () => context.go('/data-structures/graph'),
                      ),
                      const SizedBox(height: 16),
                    ],
                  ),
                ),
              ],
            ),
          ),
          // 右侧可视化区域
          Expanded(
            child: _selectedType == null
                ? _buildEmptyState(context)
                : _buildVisualizationArea(context),
          ),
        ],
      ),
    );
  }

  Widget _buildCategoryTitle(BuildContext context, String title) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleMedium?.copyWith(
          fontWeight: FontWeight.bold,
          color: Theme.of(context).primaryColor,
        ),
      ),
    );
  }

  Widget _buildStructureCard(
    BuildContext context,
    DataStructureType type,
    IconData icon,
    String description,
  ) {
    final theme = Theme.of(context);
    final isSelected = _selectedType == type;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      elevation: isSelected ? 4 : 1,
      color: isSelected ? theme.primaryColor.withOpacity(0.1) : null,
      child: InkWell(
        onTap: () {
          setState(() {
            _selectedType = type;
          });
        },
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: isSelected
                      ? theme.primaryColor
                      : theme.primaryColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  icon,
                  color: isSelected ? Colors.white : theme.primaryColor,
                  size: 24,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      type.displayName,
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      description,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: Colors.grey[600],
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTreeCard(
    BuildContext context,
    IconData icon,
    String title,
    String description,
    VoidCallback onTap,
  ) {
    final theme = Theme.of(context);

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      elevation: 1,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: theme.primaryColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  icon,
                  color: theme.primaryColor,
                  size: 24,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      description,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: Colors.grey[600],
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.arrow_forward_ios,
                color: theme.primaryColor,
                size: 16,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState(BuildContext context) {
    final theme = Theme.of(context);

    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.touch_app,
            size: 80,
            color: Colors.grey[400],
          ),
          const SizedBox(height: 24),
          Text(
            '请选择一个数据结构',
            style: theme.textTheme.headlineSmall?.copyWith(
              color: Colors.grey[600],
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '点击左侧的数据结构卡片开始探索',
            style: theme.textTheme.bodyLarge?.copyWith(
              color: Colors.grey[500],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildVisualizationArea(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 标题和操作按钮
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                _selectedType!.displayName,
                style: theme.textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.refresh),
                    onPressed: () {
                      // 重置数据结构
                    },
                    tooltip: '重置',
                  ),
                  IconButton(
                    icon: const Icon(Icons.info_outline),
                    onPressed: () {
                      // 显示数据结构信息
                    },
                    tooltip: '详细信息',
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),
          // 可视化展示区域
          Expanded(
            child: _buildDataStructureVisualizer(),
          ),
          const SizedBox(height: 16),
          // 操作控制面板
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '操作控制',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: _getOperationButtons(),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _getOperationButtons() {
    switch (_selectedType) {
      case DataStructureType.stack:
        return [
          ElevatedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.add),
            label: const Text('入栈'),
          ),
          ElevatedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.remove),
            label: const Text('出栈'),
          ),
          OutlinedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.visibility),
            label: const Text('查看栈顶'),
          ),
        ];
      case DataStructureType.queue:
        return [
          ElevatedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.add),
            label: const Text('入队'),
          ),
          ElevatedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.remove),
            label: const Text('出队'),
          ),
        ];
      case DataStructureType.linkedList:
        return [
          ElevatedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.add),
            label: const Text('插入节点'),
          ),
          ElevatedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.remove),
            label: const Text('删除节点'),
          ),
          OutlinedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.search),
            label: const Text('查找节点'),
          ),
        ];
      case DataStructureType.binarySearchTree:
      case DataStructureType.avlTree:
        return [
          ElevatedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.add),
            label: const Text('插入'),
          ),
          ElevatedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.remove),
            label: const Text('删除'),
          ),
          OutlinedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.search),
            label: const Text('查找'),
          ),
          OutlinedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.format_list_bulleted),
            label: const Text('遍历'),
          ),
        ];
      case DataStructureType.graph:
        return [
          ElevatedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.add_location),
            label: const Text('添加顶点'),
          ),
          ElevatedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.add_road),
            label: const Text('添加边'),
          ),
          OutlinedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.explore),
            label: const Text('DFS遍历'),
          ),
          OutlinedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.radar),
            label: const Text('BFS遍历'),
          ),
        ];
      default:
        return [];
    }
  }

  Widget _buildDataStructureVisualizer() {
    if (_selectedType == null) {
      return const Card(
        child: Center(
          child: Text('请选择一个数据结构'),
        ),
      );
    }

    switch (_selectedType!) {
      case DataStructureType.stack:
        return const StackVisualizer();
      case DataStructureType.queue:
        return const QueueVisualizer();
      case DataStructureType.linkedList:
        return const LinkedListVisualizer();
      case DataStructureType.binaryTree:
      case DataStructureType.binarySearchTree:
      case DataStructureType.avlTree:
      case DataStructureType.heap:
      case DataStructureType.graph:
        return Card(
          child: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  Icons.construction,
                  size: 64,
                  color: Colors.orange[400],
                ),
                const SizedBox(height: 16),
                Text(
                  '${_selectedType!.displayName}可视化',
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                Text(
                  '该功能正在开发中',
                  style: TextStyle(color: Colors.grey[600]),
                ),
              ],
            ),
          ),
        );
    }
  }

  void _showHelpDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('数据结构帮助'),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('选择一个数据结构来查看其可视化演示。'),
              SizedBox(height: 12),
              Text('操作说明:', style: TextStyle(fontWeight: FontWeight.bold)),
              SizedBox(height: 4),
              Text('1. 选择要学习的数据结构类型'),
              Text('2. 使用控制面板进行各种操作'),
              Text('3. 观察可视化界面的变化'),
              Text('4. 通过可视化理解数据结构的内部机制'),
              SizedBox(height: 12),
              Text('提示:', style: TextStyle(fontWeight: FontWeight.bold)),
              Text('• 不同的数据结构有不同的操作方式'),
              Text('• 注意观察操作的时间复杂度'),
              Text('• 理解每种数据结构的适用场景'),
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
