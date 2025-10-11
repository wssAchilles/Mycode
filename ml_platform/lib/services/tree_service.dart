// 树形数据结构服务
import 'dart:math' as math;
import 'package:ml_platform/models/data_structure_model.dart';

/// 二叉搜索树节点
class BSTNode {
  int value;
  BSTNode? left;
  BSTNode? right;
  int height; // 用于AVL树
  
  // 可视化位置信息
  double x;
  double y;
  
  BSTNode(this.value, {this.left, this.right, this.height = 1, this.x = 0, this.y = 0});
}

/// 树操作步骤
class TreeStep {
  final String operation;
  final String description;
  final BSTNode? root;
  final int? highlightNode;
  final List<int> searchPath;
  final String? rotationType; // 用于AVL旋转
  
  TreeStep({
    required this.operation,
    required this.description,
    this.root,
    this.highlightNode,
    this.searchPath = const [],
    this.rotationType,
  });
}

/// 树形数据结构服务
class TreeService {
  static final TreeService _instance = TreeService._internal();
  factory TreeService() => _instance;
  TreeService._internal();
  
  // ============= 二叉搜索树 (BST) =============
  
  /// BST插入操作
  List<TreeStep> bstInsert(BSTNode? root, int value) {
    List<TreeStep> steps = [];
    List<int> path = [];
    
    steps.add(TreeStep(
      operation: 'insert',
      description: '开始插入值 $value',
      root: _cloneTree(root),
      highlightNode: value,
    ));
    
    root = _bstInsertHelper(root, value, steps, path);
    
    steps.add(TreeStep(
      operation: 'insert',
      description: '插入完成！值 $value 已添加到树中',
      root: _cloneTree(root),
      highlightNode: value,
    ));
    
    return steps;
  }
  
  BSTNode? _bstInsertHelper(BSTNode? node, int value, List<TreeStep> steps, List<int> path) {
    if (node == null) {
      steps.add(TreeStep(
        operation: 'insert',
        description: '找到插入位置，创建新节点',
        searchPath: List.from(path),
        highlightNode: value,
      ));
      return BSTNode(value);
    }
    
    path.add(node.value);
    steps.add(TreeStep(
      operation: 'insert',
      description: '比较：$value ${value < node.value ? '<' : '>'} ${node.value}',
      root: _cloneTree(node),
      searchPath: List.from(path),
      highlightNode: node.value,
    ));
    
    if (value < node.value) {
      node.left = _bstInsertHelper(node.left, value, steps, path);
    } else if (value > node.value) {
      node.right = _bstInsertHelper(node.right, value, steps, path);
    } else {
      steps.add(TreeStep(
        operation: 'insert',
        description: '值 $value 已存在，跳过插入',
        root: _cloneTree(node),
        highlightNode: value,
      ));
    }
    
    path.removeLast();
    return node;
  }
  
  /// BST删除操作
  List<TreeStep> bstDelete(BSTNode? root, int value) {
    List<TreeStep> steps = [];
    List<int> path = [];
    
    steps.add(TreeStep(
      operation: 'delete',
      description: '开始删除值 $value',
      root: _cloneTree(root),
      highlightNode: value,
    ));
    
    root = _bstDeleteHelper(root, value, steps, path);
    
    steps.add(TreeStep(
      operation: 'delete',
      description: '删除操作完成',
      root: _cloneTree(root),
    ));
    
    return steps;
  }
  
  BSTNode? _bstDeleteHelper(BSTNode? node, int value, List<TreeStep> steps, List<int> path) {
    if (node == null) {
      steps.add(TreeStep(
        operation: 'delete',
        description: '值 $value 不存在',
        searchPath: List.from(path),
      ));
      return null;
    }
    
    path.add(node.value);
    
    if (value < node.value) {
      steps.add(TreeStep(
        operation: 'delete',
        description: '搜索左子树：$value < ${node.value}',
        root: _cloneTree(node),
        searchPath: List.from(path),
        highlightNode: node.value,
      ));
      node.left = _bstDeleteHelper(node.left, value, steps, path);
    } else if (value > node.value) {
      steps.add(TreeStep(
        operation: 'delete',
        description: '搜索右子树：$value > ${node.value}',
        root: _cloneTree(node),
        searchPath: List.from(path),
        highlightNode: node.value,
      ));
      node.right = _bstDeleteHelper(node.right, value, steps, path);
    } else {
      // 找到要删除的节点
      steps.add(TreeStep(
        operation: 'delete',
        description: '找到要删除的节点：$value',
        root: _cloneTree(node),
        highlightNode: value,
        searchPath: List.from(path),
      ));
      
      // 情况1：叶子节点
      if (node.left == null && node.right == null) {
        steps.add(TreeStep(
          operation: 'delete',
          description: '删除叶子节点 $value',
          root: _cloneTree(node),
          highlightNode: value,
        ));
        return null;
      }
      // 情况2：只有一个子节点
      else if (node.left == null) {
        steps.add(TreeStep(
          operation: 'delete',
          description: '用右子节点替换 $value',
          root: _cloneTree(node),
          highlightNode: value,
        ));
        return node.right;
      } else if (node.right == null) {
        steps.add(TreeStep(
          operation: 'delete',
          description: '用左子节点替换 $value',
          root: _cloneTree(node),
          highlightNode: value,
        ));
        return node.left;
      }
      // 情况3：有两个子节点
      else {
        BSTNode minNode = _findMin(node.right!);
        steps.add(TreeStep(
          operation: 'delete',
          description: '找到右子树最小值 ${minNode.value} 来替换 $value',
          root: _cloneTree(node),
          highlightNode: minNode.value,
        ));
        node.value = minNode.value;
        node.right = _bstDeleteHelper(node.right, minNode.value, steps, path);
      }
    }
    
    path.removeLast();
    return node;
  }
  
  /// BST查找操作
  List<TreeStep> bstSearch(BSTNode? root, int value) {
    List<TreeStep> steps = [];
    List<int> path = [];
    
    steps.add(TreeStep(
      operation: 'search',
      description: '开始搜索值 $value',
      root: _cloneTree(root),
      highlightNode: value,
    ));
    
    bool found = _bstSearchHelper(root, value, steps, path);
    
    steps.add(TreeStep(
      operation: 'search',
      description: found ? '找到值 $value！' : '值 $value 不存在',
      root: _cloneTree(root),
      searchPath: path,
      highlightNode: found ? value : null,
    ));
    
    return steps;
  }
  
  bool _bstSearchHelper(BSTNode? node, int value, List<TreeStep> steps, List<int> path) {
    if (node == null) {
      return false;
    }
    
    path.add(node.value);
    steps.add(TreeStep(
      operation: 'search',
      description: '访问节点 ${node.value}',
      root: _cloneTree(node),
      searchPath: List.from(path),
      highlightNode: node.value,
    ));
    
    if (value == node.value) {
      return true;
    } else if (value < node.value) {
      steps.add(TreeStep(
        operation: 'search',
        description: '$value < ${node.value}，搜索左子树',
        root: _cloneTree(node),
        searchPath: List.from(path),
      ));
      return _bstSearchHelper(node.left, value, steps, path);
    } else {
      steps.add(TreeStep(
        operation: 'search',
        description: '$value > ${node.value}，搜索右子树',
        root: _cloneTree(node),
        searchPath: List.from(path),
      ));
      return _bstSearchHelper(node.right, value, steps, path);
    }
  }
  
  // ============= AVL树 =============
  
  /// AVL树插入操作
  List<TreeStep> avlInsert(BSTNode? root, int value) {
    List<TreeStep> steps = [];
    
    steps.add(TreeStep(
      operation: 'avl_insert',
      description: '开始AVL插入值 $value',
      root: _cloneTree(root),
      highlightNode: value,
    ));
    
    root = _avlInsertHelper(root, value, steps);
    
    steps.add(TreeStep(
      operation: 'avl_insert',
      description: 'AVL插入完成，树已平衡',
      root: _cloneTree(root),
      highlightNode: value,
    ));
    
    return steps;
  }
  
  BSTNode? _avlInsertHelper(BSTNode? node, int value, List<TreeStep> steps) {
    // 1. 执行标准BST插入
    if (node == null) {
      return BSTNode(value);
    }
    
    if (value < node.value) {
      node.left = _avlInsertHelper(node.left, value, steps);
    } else if (value > node.value) {
      node.right = _avlInsertHelper(node.right, value, steps);
    } else {
      return node; // 重复值不插入
    }
    
    // 2. 更新高度
    node.height = 1 + math.max(_getHeight(node.left), _getHeight(node.right));
    
    // 3. 获取平衡因子
    int balance = _getBalance(node);
    
    // 4. 如果不平衡，执行旋转
    if (balance > 1) {
      if (value < node.left!.value) {
        // 左-左情况：右旋
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: 'LL情况：对节点 ${node.value} 执行右旋',
          root: _cloneTree(node),
          highlightNode: node.value,
          rotationType: 'right',
        ));
        return _rotateRight(node);
      } else {
        // 左-右情况：先左旋后右旋
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: 'LR情况：先对 ${node.left!.value} 左旋，再对 ${node.value} 右旋',
          root: _cloneTree(node),
          highlightNode: node.value,
          rotationType: 'left-right',
        ));
        node.left = _rotateLeft(node.left!);
        return _rotateRight(node);
      }
    }
    
    if (balance < -1) {
      if (value > node.right!.value) {
        // 右-右情况：左旋
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: 'RR情况：对节点 ${node.value} 执行左旋',
          root: _cloneTree(node),
          highlightNode: node.value,
          rotationType: 'left',
        ));
        return _rotateLeft(node);
      } else {
        // 右-左情况：先右旋后左旋
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: 'RL情况：先对 ${node.right!.value} 右旋，再对 ${node.value} 左旋',
          root: _cloneTree(node),
          highlightNode: node.value,
          rotationType: 'right-left',
        ));
        node.right = _rotateRight(node.right!);
        return _rotateLeft(node);
      }
    }
    
    return node;
  }
  
  /// AVL树删除操作
  List<TreeStep> avlDelete(BSTNode? root, int value) {
    List<TreeStep> steps = [];
    
    steps.add(TreeStep(
      operation: 'avl_delete',
      description: '开始AVL删除值 $value',
      root: _cloneTree(root),
      highlightNode: value,
    ));
    
    root = _avlDeleteHelper(root, value, steps);
    
    steps.add(TreeStep(
      operation: 'avl_delete',
      description: 'AVL删除完成，树已重新平衡',
      root: _cloneTree(root),
    ));
    
    return steps;
  }
  
  BSTNode? _avlDeleteHelper(BSTNode? node, int value, List<TreeStep> steps) {
    if (node == null) return null;
    
    // 1. 执行标准BST删除
    if (value < node.value) {
      node.left = _avlDeleteHelper(node.left, value, steps);
    } else if (value > node.value) {
      node.right = _avlDeleteHelper(node.right, value, steps);
    } else {
      if (node.left == null || node.right == null) {
        node = node.left ?? node.right;
      } else {
        BSTNode temp = _findMin(node.right!);
        node.value = temp.value;
        node.right = _avlDeleteHelper(node.right, temp.value, steps);
      }
    }
    
    if (node == null) return null;
    
    // 2. 更新高度
    node.height = 1 + math.max(_getHeight(node.left), _getHeight(node.right));
    
    // 3. 获取平衡因子并重新平衡
    int balance = _getBalance(node);
    
    if (balance > 1) {
      if (_getBalance(node.left) >= 0) {
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: '删除后LL情况：右旋节点 ${node.value}',
          root: _cloneTree(node),
          highlightNode: node.value,
          rotationType: 'right',
        ));
        return _rotateRight(node);
      } else {
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: '删除后LR情况：左右双旋节点 ${node.value}',
          root: _cloneTree(node),
          highlightNode: node.value,
          rotationType: 'left-right',
        ));
        node.left = _rotateLeft(node.left!);
        return _rotateRight(node);
      }
    }
    
    if (balance < -1) {
      if (_getBalance(node.right) <= 0) {
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: '删除后RR情况：左旋节点 ${node.value}',
          root: _cloneTree(node),
          highlightNode: node.value,
          rotationType: 'left',
        ));
        return _rotateLeft(node);
      } else {
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: '删除后RL情况：右左双旋节点 ${node.value}',
          root: _cloneTree(node),
          highlightNode: node.value,
          rotationType: 'right-left',
        ));
        node.right = _rotateRight(node.right!);
        return _rotateLeft(node);
      }
    }
    
    return node;
  }
  
  // ============= 辅助函数 =============
  
  /// 右旋
  BSTNode _rotateRight(BSTNode y) {
    BSTNode x = y.left!;
    BSTNode? T2 = x.right;
    
    x.right = y;
    y.left = T2;
    
    y.height = math.max(_getHeight(y.left), _getHeight(y.right)) + 1;
    x.height = math.max(_getHeight(x.left), _getHeight(x.right)) + 1;
    
    return x;
  }
  
  /// 左旋
  BSTNode _rotateLeft(BSTNode x) {
    BSTNode y = x.right!;
    BSTNode? T2 = y.left;
    
    y.left = x;
    x.right = T2;
    
    x.height = math.max(_getHeight(x.left), _getHeight(x.right)) + 1;
    y.height = math.max(_getHeight(y.left), _getHeight(y.right)) + 1;
    
    return y;
  }
  
  /// 获取节点高度
  int _getHeight(BSTNode? node) {
    return node?.height ?? 0;
  }
  
  /// 获取平衡因子
  int _getBalance(BSTNode? node) {
    if (node == null) return 0;
    return _getHeight(node.left) - _getHeight(node.right);
  }
  
  /// 找到最小节点
  BSTNode _findMin(BSTNode node) {
    while (node.left != null) {
      node = node.left!;
    }
    return node;
  }
  
  /// 克隆树
  BSTNode? _cloneTree(BSTNode? node) {
    if (node == null) return null;
    BSTNode newNode = BSTNode(node.value, height: node.height, x: node.x, y: node.y);
    newNode.left = _cloneTree(node.left);
    newNode.right = _cloneTree(node.right);
    return newNode;
  }
  
  /// 计算树的布局位置
  void calculateTreeLayout(BSTNode? root, double width, double height) {
    if (root == null) return;
    
    int treeHeight = _getTreeHeight(root);
    _calculateNodePositions(root, 0, width, 0, height / (treeHeight + 1));
  }
  
  void _calculateNodePositions(BSTNode? node, double left, double right, int depth, double levelHeight) {
    if (node == null) return;
    
    node.x = (left + right) / 2;
    node.y = (depth + 1) * levelHeight;
    
    if (node.left != null) {
      _calculateNodePositions(node.left, left, node.x, depth + 1, levelHeight);
    }
    if (node.right != null) {
      _calculateNodePositions(node.right, node.x, right, depth + 1, levelHeight);
    }
  }
  
  int _getTreeHeight(BSTNode? node) {
    if (node == null) return 0;
    return 1 + math.max(_getTreeHeight(node.left), _getTreeHeight(node.right));
  }
}
