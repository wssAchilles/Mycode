// 数据结构页面
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../models/data_structure_model.dart';
import '../widgets/data_structures/stack_visualizer.dart';
import '../widgets/data_structures/queue_visualizer.dart';
import '../widgets/data_structures/linked_list_visualizer.dart';
import '../widgets/data_structures/tree_visualizer.dart';
import '../widgets/data_structures/graph_visualizer.dart';
import '../widgets/data_structures/heap_visualizer.dart';
import 'package:ml_platform/utils/responsive_layout.dart';

class DataStructureScreen extends StatefulWidget {
  final String? structureType;

  const DataStructureScreen({Key? key, this.structureType}) : super(key: key);

  @override
  State<DataStructureScreen> createState() => _DataStructureScreenState();
}

class _DataStructureScreenState extends State<DataStructureScreen> {
  DataStructureType? _selectedType;
  
  // GlobalKey needed to access Visualizer state
  final GlobalKey<dynamic> _stackKey = GlobalKey();
  final GlobalKey<dynamic> _queueKey = GlobalKey();
  final GlobalKey<LinkedListVisualizerState> _linkedListKey = GlobalKey();
  final GlobalKey<HeapVisualizerState> _heapKey = GlobalKey();
  final GlobalKey<GraphVisualizerState> _graphKey = GlobalKey();
  final GlobalKey<TreeVisualizerState> _treeKey = GlobalKey();

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
    final isMobile = ResponsiveLayout.isMobile(context);

    // 根据 widget.structureType 更新选中状态 (如果 URL 变化)
    if (widget.structureType != null) {
      try {
        _selectedType = DataStructureType.values.firstWhere(
          (type) => type.name == widget.structureType,
        );
      } catch (_) {
         // Invalid type, maybe ignore or set to default
      }
    } else {
      // If URL has no type, selectedType should effectively be null for mobile View logic,
      // but for desktop we might want to keep selection or select default.
      // For now, let's keep it simple: if URL is empty, selection is null.
      if (isMobile) {
         _selectedType = null;
      }
    }

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (isMobile && _selectedType != null) {
               context.go('/data-structures');
            } else {
               context.go('/home');
            }
          },
          tooltip: '返回',
        ),
        title: Text(_selectedType?.displayName ?? '数据结构可视化'),
        actions: [
          IconButton(
            icon: const Icon(Icons.help_outline),
            onPressed: () => _showHelpDialog(context),
            tooltip: '帮助',
          ),
        ],
      ),
      body: ResponsiveLayout(
        mobile: _buildMobileLayout(context),
        tablet: _buildDesktopLayout(context), 
        desktop: _buildDesktopLayout(context),
      ),
    );
  }

  Widget _buildMobileLayout(BuildContext context) {
    if (_selectedType != null) {
      return _buildVisualizationArea(context);
    }
    return _buildStructureList(context);
  }

  Widget _buildDesktopLayout(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
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
                child: _buildStructureList(context),
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
    );
  }

  Widget _buildStructureList(BuildContext context) {
     return ListView(
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
          if (ResponsiveLayout.isMobile(context)) {
             context.go('/data-structures/${type.name}');
          } else {
             context.go('/data-structures/${type.name}');
             // For desktop, explicitly set state if router doesn't rebuild immediately
             setState(() {
               _selectedType = type;
             });
          }
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
                      if (_selectedType == DataStructureType.stack) {
                         (_stackKey.currentState as dynamic)?.clear();
                      } else if (_selectedType == DataStructureType.queue) {
                         (_queueKey.currentState as dynamic)?.clear();
                      } else if (_selectedType == DataStructureType.heap) {
                         _heapKey.currentState?.clear();
                      } else if (_selectedType == DataStructureType.graph) {
                         _graphKey.currentState?.clear();
                      }
                      // TODO: Implement clear for other types
                    },
                    tooltip: '重置',
                  ),
                  IconButton(
                    icon: const Icon(Icons.info_outline),
                    onPressed: () => _showHelpDialog(context),
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

  Future<void> _showTwoInputsDialog({
    required BuildContext context,
    required String title,
    required String label1,
    required String label2,
    required Function(int, int) onConfirm,
  }) async {
    final TextEditingController c1 = TextEditingController();
    final TextEditingController c2 = TextEditingController();
    return showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(title),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
               TextField(
                 controller: c1, 
                 decoration: InputDecoration(hintText: label1, labelText: label1), 
                 keyboardType: TextInputType.number,
                 autofocus: true,
               ),
               const SizedBox(height: 16),
               TextField(
                 controller: c2, 
                 decoration: InputDecoration(hintText: label2, labelText: label2), 
                 keyboardType: TextInputType.number
               ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(), 
              child: const Text('取消')
            ),
            ElevatedButton(
              onPressed: () {
                final v1 = int.tryParse(c1.text);
                final v2 = int.tryParse(c2.text);
                if (v1 != null && v2 != null) {
                    onConfirm(v1, v2);
                    Navigator.of(context).pop();
                }
              }, 
              child: const Text('确定')
            ),
          ],
        );
      },
    );
  }

  Future<void> _showAddEdgeDialog({
    required BuildContext context,
    required Function(int, int, int) onConfirm,
  }) async {
    final TextEditingController cU = TextEditingController();
    final TextEditingController cV = TextEditingController();
    final TextEditingController cW = TextEditingController(text: '1');
    return showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('添加带权边'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
               TextField(
                 controller: cU, 
                 decoration: const InputDecoration(hintText: '起点 ID', labelText: '起点 ID'), 
                 keyboardType: TextInputType.number,
                 autofocus: true,
               ),
               const SizedBox(height: 8),
               TextField(
                 controller: cV, 
                 decoration: const InputDecoration(hintText: '终点 ID', labelText: '终点 ID'), 
                 keyboardType: TextInputType.number
               ),
               const SizedBox(height: 8),
               TextField(
                 controller: cW, 
                 decoration: const InputDecoration(hintText: '权重 (Weight)', labelText: '权重'), 
                 keyboardType: TextInputType.number
               ),
            ],
          ),
          actions: [
             TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('取消')),
             ElevatedButton(
               onPressed: () {
                 final u = int.tryParse(cU.text);
                 final v = int.tryParse(cV.text);
                 final w = int.tryParse(cW.text);
                 if (u != null && v != null && w != null) {
                    onConfirm(u, v, w);
                    Navigator.of(context).pop();
                 }
               },
               child: const Text('添加'),
             ),
          ],
        );
      },
    );
  }

  Future<void> _showInputDialog({
    required BuildContext context,
    required String title,
    required String hintText,
    required Function(int) onConfirm,
  }) async {
    final TextEditingController controller = TextEditingController();
    return showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(title),
          content: TextField(
            controller: controller,
            keyboardType: TextInputType.number,
            autofocus: true,
            decoration: InputDecoration(
              hintText: hintText,
              contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('取消'),
            ),
            ElevatedButton(
              onPressed: () {
                final val = int.tryParse(controller.text);
                if (val != null) {
                  onConfirm(val);
                  Navigator.of(context).pop();
                }
              },
              child: const Text('确定'),
            ),
          ],
        );
      },
    );
  }

  List<Widget> _getOperationButtons() {
    switch (_selectedType) {
      case DataStructureType.stack:
        return [
          ElevatedButton.icon(
            onPressed: () {
              // Show dialog to input value
              _showInputDialog(
                context: context,
                title: '入栈元素',
                hintText: '请输入整数',
                onConfirm: (val) {
                  (_stackKey.currentState as dynamic)?.push(val);
                },
              );
            },
            icon: const Icon(Icons.add),
            label: const Text('入栈'),
          ),
          ElevatedButton.icon(
            onPressed: () {
              (_stackKey.currentState as dynamic)?.pop();
            },
            icon: const Icon(Icons.remove),
            label: const Text('出栈'),
          ),
          OutlinedButton.icon(
            onPressed: () {
               (_stackKey.currentState as dynamic)?.peek();
            },
            icon: const Icon(Icons.visibility),
            label: const Text('查看栈顶'),
          ),
        ];
      case DataStructureType.queue:
        return [
          ElevatedButton.icon(
            onPressed: () {
              _showInputDialog(
                context: context,
                title: '入队元素',
                hintText: '请输入整数',
                onConfirm: (val) {
                  (_queueKey.currentState as dynamic)?.enqueue(val);
                },
              );
            },
            icon: const Icon(Icons.add),
            label: const Text('入队'),
          ),
          ElevatedButton.icon(
            onPressed: () {
              (_queueKey.currentState as dynamic)?.dequeue();
            },
            icon: const Icon(Icons.remove),
            label: const Text('出队'),
          ),
          OutlinedButton.icon(
            onPressed: () {
               (_queueKey.currentState as dynamic)?.peek();
            },
            icon: const Icon(Icons.visibility),
            label: const Text('查看队首'),
          ),
        ];
      case DataStructureType.linkedList:
        return [
          ElevatedButton.icon(
            onPressed: () {
               _showTwoInputsDialog(
                 context: context,
                 title: '插入节点',
                 label1: '数值',
                 label2: '索引',
                 onConfirm: (val, idx) {
                    _linkedListKey.currentState?.insertNode(val, idx);
                 },
               );
            },
            icon: const Icon(Icons.add),
            label: const Text('插入节点'),
          ),
          ElevatedButton.icon(
            onPressed: () {
               _showInputDialog(
                 context: context,
                 title: '删除节点',
                 hintText: '请输入索引',
                 onConfirm: (idx) {
                    _linkedListKey.currentState?.deleteNode(idx);
                 },
               );
            },
            icon: const Icon(Icons.remove),
            label: const Text('删除节点'),
          ),
          OutlinedButton.icon(
            onPressed: () {
                _showInputDialog(
                 context: context,
                 title: '查找节点',
                 hintText: '请输入数值',
                 onConfirm: (val) {
                    _linkedListKey.currentState?.searchNode(val);
                 },
               );
            },
            icon: const Icon(Icons.search),
            label: const Text('查找节点'),
          ),
        ];
      case DataStructureType.binarySearchTree:
      case DataStructureType.avlTree:
        return [
          ElevatedButton.icon(
            onPressed: () {
               _showInputDialog(
                 context: context,
                 title: '插入节点',
                 hintText: '输入整数',
                 onConfirm: (val) {
                    _treeKey.currentState?.insert(val);
                 },
               );
            },
            icon: const Icon(Icons.add),
            label: const Text('插入'),
          ),
          ElevatedButton.icon(
            onPressed: () {
               _showInputDialog(
                 context: context,
                 title: '删除节点',
                 hintText: '输入整数',
                 onConfirm: (val) {
                    _treeKey.currentState?.delete(val);
                 },
               );
            },
            icon: const Icon(Icons.remove),
            label: const Text('删除'),
          ),
          OutlinedButton.icon(
            onPressed: () {
               _showInputDialog(
                 context: context,
                 title: '查找节点',
                 hintText: '输入整数',
                 onConfirm: (val) {
                    _treeKey.currentState?.search(val);
                 },
               );
            },
            icon: const Icon(Icons.search),
            label: const Text('查找'),
          ),
          OutlinedButton.icon(
            onPressed: () {
               // In-order traversal?
            },
            icon: const Icon(Icons.format_list_bulleted),
            label: const Text('遍历'),
          ),
        ];

      case DataStructureType.heap:
        return [
          ElevatedButton.icon(
             onPressed: () {
               _showInputDialog(
                 context: context,
                 title: '插入元素',
                 hintText: '输入整数',
                 onConfirm: (val) {
                    _heapKey.currentState?.insert(val);
                 },
               );
             },
             icon: const Icon(Icons.add),
             label: const Text('插入'),
          ),
          ElevatedButton.icon(
             onPressed: () {
                _heapKey.currentState?.extractMax();
             },
             icon: const Icon(Icons.remove),
             label: const Text('移除最大值'),
          ),
          OutlinedButton.icon(
             onPressed: () {
                // Peek? Or just clear?
                // Visualizer shows default view.
             },
             icon: const Icon(Icons.visibility),
             label: const Text('查看(Top)'),
          ),
        ];

      case DataStructureType.graph:
        return [
          ElevatedButton.icon(
            onPressed: () {
              _graphKey.currentState?.addVertex();
            },
            icon: const Icon(Icons.add_location),
            label: const Text('添加顶点'),
          ),
          ElevatedButton.icon(
            onPressed: () {
               _showAddEdgeDialog(
                 context: context,
                 onConfirm: (u, v, w) {
                    _graphKey.currentState?.addEdge(u, v, weight: w);
                 },
               );
            },
            icon: const Icon(Icons.add_road),
            label: const Text('添加边'),
          ),
          OutlinedButton.icon(
            onPressed: () {
               _graphKey.currentState?.dfs();
            },
            icon: const Icon(Icons.explore),
            label: const Text('DFS遍历'),
          ),
          OutlinedButton.icon(
            onPressed: () {
               _graphKey.currentState?.bfs();
            },
            icon: const Icon(Icons.radar),
            label: const Text('BFS遍历'),
          ),
          OutlinedButton.icon(
            onPressed: () {
               _graphKey.currentState?.dijkstra();
            },
            icon: const Icon(Icons.route),
            label: const Text('Dijkstra'),
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
        return StackVisualizer(key: _stackKey);
      case DataStructureType.queue:
        return QueueVisualizer(key: _queueKey);
      case DataStructureType.linkedList:
        return LinkedListVisualizer(key: _linkedListKey, initialType: LinkedListType.singly);
      case DataStructureType.doublyLinkedList:
        return LinkedListVisualizer(key: _linkedListKey, initialType: LinkedListType.doubly);
      case DataStructureType.binaryTree:
      case DataStructureType.binarySearchTree:
        return TreeVisualizer(key: _treeKey, initialType: TreeType.bst);
      case DataStructureType.avlTree:
        return TreeVisualizer(key: _treeKey, initialType: TreeType.avl);
      case DataStructureType.heap:
        return HeapVisualizer(key: _heapKey);
      case DataStructureType.graph:
        return GraphVisualizer(key: _graphKey);
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

