// 树形数据结构服务
import 'dart:math' as math;
import 'package:ml_platform/models/data_structure_model.dart';

/// 二叉搜索树节点
class BSTNode {
  int value;
  BSTNode? left;
  BSTNode? right;
  int height; // 用于AVL树
  bool isRed; // 用于红黑树 (true=Red, false=Black)
  
  // 可视化位置信息
  double x;
  double y;
  
  BSTNode(this.value, {this.left, this.right, this.height = 1, this.isRed = false, this.x = 0, this.y = 0});
}

/// 树操作步骤
class TreeStep {
  final String operation;
  final String description;
  final BSTNode? root;
  final int? highlightNode;
  final List<int> searchPath;
  final String? rotationType; // 用于AVL旋转
  final BSTNode? nextRoot; // 用于动画过渡的目标状态
  
  TreeStep({
    required this.operation,
    required this.description,
    this.root,
    this.highlightNode,
    this.searchPath = const [],
    this.rotationType,
    this.nextRoot,
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
    // 4. 如果不平衡，执行旋转
    if (balance > 1) {
      if (value < node.left!.value) {
        // 左-左情况：右旋
        BSTNode before = _cloneTree(node)!;
        BSTNode newRoot = _rotateRight(node);
        
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: 'LL情况：对节点 ${node.value} 执行右旋',
          root: before, // 旋转前
          nextRoot: _cloneTree(newRoot), // 旋转后
          highlightNode: node.value,
          rotationType: 'right',
        ));
        return newRoot;
      } else {
        // 左-右情况：先左旋后右旋
        // Step 1: Left Rotate on child
        // 这是一个复合动作。我们可以拆成两步动画，或者一步完成。
        // 为了平滑演示，先展示 "准备旋转" (LR -> LL) 然后 (LL -> Balanced)
        // 或者直接展示最终结果。
        // 还是拆分吧。
        
        // Capture initial state
        BSTNode beforeDouble = _cloneTree(node)!;
        
        // Perform 1st rotation (Left on child)
        node.left = _rotateLeft(node.left!);
        
        BSTNode middle = _cloneTree(node)!;
        
        steps.add(TreeStep(
           operation: 'avl_rotate',
           description: 'LR情况：先对左子节点 ${node.left!.value} 左旋',
           root: beforeDouble,
           nextRoot: middle,
           highlightNode: node.left!.value,
           rotationType: 'left', // 局部左旋
        ));
        
        // Perform 2nd rotation (Right on root)
        BSTNode newRoot = _rotateRight(node);
        
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: 'LR情况：再对节点 ${node.value} 右旋',
          root: middle, 
          nextRoot: _cloneTree(newRoot),
          highlightNode: node.value,
          rotationType: 'right',
        ));
        
        return newRoot;
      }
    }
    
    if (balance < -1) {
      if (value > node.right!.value) {
        // 右-右情况：左旋
        BSTNode before = _cloneTree(node)!;
        BSTNode newRoot = _rotateLeft(node);
        
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: 'RR情况：对节点 ${node.value} 执行左旋',
          root: before,
          nextRoot: _cloneTree(newRoot),
          highlightNode: node.value,
          rotationType: 'left',
        ));
        return newRoot;
      } else {
        // 右-左情况：先右旋后左旋
        BSTNode beforeDouble = _cloneTree(node)!;
        
        // 1. Right rotate on child
        node.right = _rotateRight(node.right!);
        BSTNode middle = _cloneTree(node)!;
        
        steps.add(TreeStep(
           operation: 'avl_rotate',
           description: 'RL情况：先对右子节点 ${node.right!.value} 右旋',
           root: beforeDouble,
           nextRoot: middle,
           highlightNode: node.right!.value,
           rotationType: 'right',
        ));
        
        // 2. Left rotate on root
        BSTNode newRoot = _rotateLeft(node);
        
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: 'RL情况：再对节点 ${node.value} 左旋',
          root: middle,
          nextRoot: _cloneTree(newRoot),
          highlightNode: node.value,
          rotationType: 'left',
        ));
        return newRoot;
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
        // LL
        BSTNode before = _cloneTree(node)!;
        BSTNode newRoot = _rotateRight(node);
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: '删除后LL情况：右旋节点 ${node.value}',
          root: before,
          nextRoot: _cloneTree(newRoot),
          highlightNode: node.value,
          rotationType: 'right',
        ));
        return newRoot;
      } else {
        // LR
        BSTNode before = _cloneTree(node)!;
        node.left = _rotateLeft(node.left!);
        BSTNode middle = _cloneTree(node)!;
        
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: '删除后LR情况：左旋左子节点',
          root: before,
          nextRoot: middle,
          highlightNode: node.left!.value,
          rotationType: 'left',
        ));
        
        BSTNode newRoot = _rotateRight(node);
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: '删除后LR情况：右旋当前节点',
          root: middle,
          nextRoot: _cloneTree(newRoot),
          highlightNode: node.value,
          rotationType: 'right',
        ));
        return newRoot;
      }
    }
    
    if (balance < -1) {
      if (_getBalance(node.right) <= 0) {
        // RR
        BSTNode before = _cloneTree(node)!;
        BSTNode newRoot = _rotateLeft(node);
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: '删除后RR情况：左旋节点 ${node.value}',
          root: before,
          nextRoot: _cloneTree(newRoot),
          highlightNode: node.value,
          rotationType: 'left',
        ));
        return newRoot;
      } else {
        // RL
        BSTNode before = _cloneTree(node)!;
        node.right = _rotateRight(node.right!);
        BSTNode middle = _cloneTree(node)!;
        
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: '删除后RL情况：右旋右子节点',
          root: before,
          nextRoot: middle,
          highlightNode: node.right!.value,
          rotationType: 'right',
        ));
        
        BSTNode newRoot = _rotateLeft(node);
        steps.add(TreeStep(
          operation: 'avl_rotate',
          description: '删除后RL情况：左旋当前节点',
          root: middle,
          nextRoot: _cloneTree(newRoot),
          highlightNode: node.value,
          rotationType: 'left',
        ));
        return newRoot;
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
    BSTNode newNode = BSTNode(node.value, height: node.height, isRed: node.isRed, x: node.x, y: node.y);
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

  // ============= 红黑树 (R-B Tree) =============
  
  /// R-B Tree 插入操作
  List<TreeStep> rbInsert(BSTNode? root, int value) {
    List<TreeStep> steps = [];
    
    // 如果根为空，直接插入黑色根节点
    if (root == null) {
      root = BSTNode(value, isRed: false); // 根节点必须是黑色
      steps.add(TreeStep(
        operation: 'rb_insert',
        description: '插入根节点 $value (黑色)',
        root: _cloneTree(root),
        highlightNode: value,
      ));
      return steps;
    }
    
    steps.add(TreeStep(
        operation: 'rb_insert',
        description: '开始R-B插入值 $value',
        root: _cloneTree(root),
        highlightNode: value,
    ));

    // 使用非递归插入，因为红黑树修复需要父节点指针，或者递归修复返回新根
    // 这里为了方便处理父指针逻辑，我们采用类似 recursive BST insert but with fixup hook
    // 但是 R-B fixup 通常是从下往上的。
    // 我们先实现标准 BST 插入，新节点设为红色，然后自底向上修复。
    // 为了简化 path tracking，我们在递归 return 后检查冲突。
    
    // 其实更好的方式是：递归插入，并在回溯时检查是否违反 R-B 属性。
    // 但是 R-B 调整可能涉及祖父节点。
    
    // 这里我们使用一个稍微不同的方法：先插入，然后修复。
    // 由于 Dart 是引用传递，我们可以修改节点颜色。
    // 但 rotation 会改变拓扑。
    
    // 简化策略：
    // 1. 标准 BST 插入 (新节点红色)
    // 2. 收集路径
    // 3. 从新节点向上回溯修复
    
    // 重构：直接在 helper 中处理
    // 由于 _cloneTree 是深拷贝，我们可以在每一步记录快照。
    
    // 我们需要一个可以修改 root 的 helper，但 root 是局部变量引用。
    // 实际上 avlInsert 也是返回新 root。 rbInsert 也可以。
    
    root = _rbInsertHelper(root, value, steps);
    root!.isRed = false; // 根永远是黑色
    
    steps.add(TreeStep(
      operation: 'rb_insert',
      description: '插入完成 (确保根为黑色)',
      root: _cloneTree(root),
      highlightNode: value,
    ));
    
    return steps;
  }
  
  BSTNode _rbInsertHelper(BSTNode node, int value, List<TreeStep> steps) {
    // 此时 node 不会为 null (除了第一次调用如果是 null，但我们在入口处理了)
    
    if (value < node.value) {
      if (node.left == null) {
        node.left = BSTNode(value, isRed: true); // 新插入节点为红色
        steps.add(TreeStep(
          operation: 'rb_insert',
          description: '插入红色节点 $value 作为 ${node.value} 的左子',
          root: _cloneTree(node), // 这只是子树快照，实际上我们需要全树快照... 
          // 这是一个问题：TreeStep 需要全树快照。
          // 简单的解决：我们在递归中不传递全树。
          // 但 TreeService 的所有 snapshot 都是基于传递给 TreeStep 的 `root`。
          // 在 avlInsert 中，我们是在递归返回后（回溯时）做 snapshot。
          // 但是这里我想在插入瞬间做 snapshot。
          // 由于无法访问 global root，我们只能... 
          // 暂时忽略中间步骤的全树可视化问题？或者依靠回溯时的 fixup 步骤来展示。
        ));
      } else {
        node.left = _rbInsertHelper(node.left!, value, steps);
      }
      
      // 回溯修复：检查 node.left 是否导致冲突
      if (_isRed(node.left) && _isRed(node.left!.left)) {
          // 连续红色： left is Red, left.left is Red.
          // Node 必须是 Black (如果 R-B 树合法)。但如果 Node 是 Red，那就是祖父的问题。
          node = _rbFixupLeft(node, steps);
      } 
      if (_isRed(node.left) && _isRed(node.left!.right)) {
          node = _rbFixupLeft(node, steps);
      }
      
    } else if (value > node.value) {
      if (node.right == null) {
        node.right = BSTNode(value, isRed: true);
        steps.add(TreeStep(
           operation: 'rb_insert',
           description: '插入红色节点 $value 作为 ${node.value} 的右子',
           // root: ... 无法获取
        ));
      } else {
        node.right = _rbInsertHelper(node.right!, value, steps);
      }
      
      // Fixup Right
      if (_isRed(node.right) && (_isRed(node.right!.left) || _isRed(node.right!.right))) {
        node = _rbFixupRight(node, steps);
      }
    }
    
    return node;
  }

  BSTNode _rbFixupLeft(BSTNode node, List<TreeStep> steps) {
      // Current situation: Node (Black?), Left (Red), Left.Child (Red).
      // Node is the "Grandparent" context potentially.
      
      // Case 1: Uncle is Red -> Recolor
      // Uncle is node.right
      BSTNode? left = node.left!;
      BSTNode? right = node.right;
      
      if (_isRed(right)) {
          // Color Flip
          steps.add(TreeStep(
             operation: 'rb_recolor',
             description: '发现红叔叔节点：变色 (父黑, 叔黑, 祖父红)',
             // 这里的描述是相对于新插入节点而言的。
             // node 是祖父。node.left 是父。node.right 是叔。
             // 变色：父(B->B? No, 父是红). 祖父 (B->R). 叔 (R->B). 父(R->B).
             // flipColors: parent(R->B), uncle(R->B), grandparent(B->R).
             // 注意：这里 node 是 Grandparent.
             root: null, // snapshot placeholder
          ));
          
          node.isRed = true;
          left.isRed = false;
          right!.isRed = false;
          
          // 注意：我们将 node 变成了红色，这可能会在上一层递归引起冲突。
          return node;
      }
      
      // Case 2: Uncle is Black (or null) -> Rotate
      // subcase: LL (Left-Left) or LR (Left-Right)
      
      if (_isRed(left.left)) {
          // LL Case: Right Rotate on Node (Grandparent)
          // Swap colors: Parent (Red->Black), Grandparent (Black->Red)
          
          BSTNode before = _cloneTree(node)!;
          
          // Change colors first
          node.isRed = true;
          left.isRed = false;
          
          steps.add(TreeStep(
             operation: 'rb_rotate',
             description: 'LL冲突 (叔叔黑)：变色并右旋',
             root: null, 
          ));
          
          BSTNode newRoot = _rotateRight(node);
          return newRoot;
      } else if (_isRed(left.right)) {
          // LR Case: Left Rotate on Parent (Initial), then Right Rotate on Grandparent
          
          // 1. Left Rotate Parent
          node.left = _rotateLeft(left);
          
          // Now it becomes LL case
           node.isRed = true;
           node.left!.isRed = false; // The new left (which was the LR child)
           
           return _rotateRight(node);
      }
      
      return node;
  }

  BSTNode _rbFixupRight(BSTNode node, List<TreeStep> steps) {
      BSTNode? left = node.left;
      BSTNode? right = node.right!;
      
      // Case 1: Uncle is Red
      if (_isRed(left)) {
          node.isRed = true;
          left!.isRed = false;
          right.isRed = false;
          return node;
      }
      
      // Case 2: Uncle is Black
      if (_isRed(right.right)) {
          // RR Case: Left Rotate
          node.isRed = true;
          right.isRed = false;
          return _rotateLeft(node);
      } else if (_isRed(right.left)) {
          // RL Case
          node.right = _rotateRight(right);
          
          node.isRed = true;
          node.right!.isRed = false;
          
          return _rotateLeft(node);
      }
      
      return node;
  }

  /// 红黑树删除操作
  List<TreeStep> rbDelete(BSTNode? root, int value) {
    List<TreeStep> steps = [];
    
    steps.add(TreeStep(
        operation: 'rb_delete',
        description: '开始R-B删除值 $value',
        root: _cloneTree(root),
        highlightNode: value,
    ));
    
    // We need a helper that returns both the new root and whether height decreased (Double Black propagated)
    // Dart doesn't support returning multiple values efficiently without a class or record.
    // We will use a wrapper object or record.
    // Record: (BSTNode?, bool heightDecreased)
    
    var result = _rbDeleteHelper(root, value, steps);
    root = result.node;
    
    if (root != null) {
      root.isRed = false; // Root is always Black
    }
    
    steps.add(TreeStep(
      operation: 'rb_delete',
      description: '删除完成',
      root: _cloneTree(root),
    ));
    
    return steps;
  }
  
  // Return (NewNode, HeightDecreased)
  ({BSTNode? node, bool heightDecreased}) _rbDeleteHelper(BSTNode? node, int value, List<TreeStep> steps) {
    if (node == null) {
       steps.add(TreeStep(
         operation: 'rb_delete',
         description: '值 $value 不存在',
         root: _cloneTree(node) // Placeholder
       ));
       return (node: null, heightDecreased: false);
    }
    
    if (value < node.value) {
       var res = _rbDeleteHelper(node.left, value, steps);
       node.left = res.node;
       
       if (res.heightDecreased) {
           // Fixup on Left Child (Double Black is at node.left)
           return _rbDeleteFixupLeft(node, steps);
       }
       return (node: node, heightDecreased: false);
       
    } else if (value > node.value) {
       var res = _rbDeleteHelper(node.right, value, steps);
       node.right = res.node;
       
       if (res.heightDecreased) {
           // Fixup on Right Child
           return _rbDeleteFixupRight(node, steps);
       }
       return (node: node, heightDecreased: false);
       
    } else {
       // Found node to delete
       steps.add(TreeStep(
         operation: 'rb_delete', // Found
         description: '找到节点 $value，准备删除',
         root: _cloneTree(node), // Note: this snapshot is local, not global root...
         highlightNode: value,
       ));
       
       // Case 1: Less than 2 children
       if (node.left == null) {
          BSTNode? child = node.right;
          // If deleted node was Red, no problem.
          // If deleted node was Black:
          //   If Child is Red -> Color Child Black. Done (Height not decreased).
          //   If Child is Black (or Null) -> Height Decreased.
          
          bool nodeIsRed = node.isRed;
          bool childIsRed = _isRed(child);
          
          if (nodeIsRed) {
             // Deleted Red node. No black height change.
             return (node: child, heightDecreased: false);
          } else {
             if (childIsRed) {
                child!.isRed = false;
                return (node: child, heightDecreased: false);
             } else {
                return (node: child, heightDecreased: true);
             }
          }
       } else if (node.right == null) {
          BSTNode? child = node.left;
          
          bool nodeIsRed = node.isRed;
          bool childIsRed = _isRed(child);
          
          if (nodeIsRed) {
             return (node: child, heightDecreased: false);
          } else {
             if (childIsRed) {
                child!.isRed = false;
                return (node: child, heightDecreased: false);
             } else {
                return (node: child, heightDecreased: true);
             }
          }
       } 
       
       // Case 3: 2 Children. Find successor
       BSTNode successor = _findMin(node.right!);
       node.value = successor.value; // Copy value
       
       steps.add(TreeStep(
         operation: 'rb_delete',
         description: '使用后继节点 ${successor.value} 替换',
         highlightNode: node.value,
       ));
       
       // Recursively delete successor from right subtree
       var res = _rbDeleteHelper(node.right, successor.value, steps);
       node.right = res.node;
       
       if (res.heightDecreased) {
           return _rbDeleteFixupRight(node, steps);
       }
       
       return (node: node, heightDecreased: false);
    }
  }

  // Fixup when Left Child has Double Black
  ({BSTNode? node, bool heightDecreased}) _rbDeleteFixupLeft(BSTNode parent, List<TreeStep> steps) {
      // Sibling is Right
      BSTNode? sibling = parent.right;
      
      // Case 1: Sibling is Red
      // Rotate Left, Recolor
      if (_isRed(sibling)) {
         steps.add(TreeStep(
           operation: 'rb_fixup',
           description: 'Case 1: 兄弟节点是红色 -> 旋转并变色',
           highlightNode: sibling?.value,
           rotationType: 'left',
         ));
         
         parent.isRed = true;
         sibling!.isRed = false;
         
         // Rotate Left at Parent
         BSTNode newParent = _rotateLeft(parent); // sibling becomes root of this subtree
         
         // Now parent is red, its right child (new sibling) is black.
         // We need to continue fixup on original parent (which is now left child of newParent)
         // Original Parent's right child is now 'sibling.left'
         
         // Since recursive structure is hard to jump, we do it carefully.
         // 'newParent' is the node we return to upper level.
         // Inside 'newParent', 'newParent.left' is our 'parent'.
         // We need to fixup 'newParent.left'.
         
         var res = _rbDeleteFixupLeft(newParent.left!, steps);
         newParent.left = res.node;
         
         return (node: newParent, heightDecreased: res.heightDecreased);
      }
      
      // Sibling is Black
      BSTNode? sLeft = sibling?.left;
      BSTNode? sRight = sibling?.right;
      
      // Case 2: Sibling Black, Both Children Black
      if (!_isRed(sLeft) && !_isRed(sRight)) {
          steps.add(TreeStep(
           operation: 'rb_fixup',
           description: 'Case 2: 兄弟黑，双子黑 -> 兄弟变红，DoubleBlack上移',
          ));
          
          sibling?.isRed = true;
          // If Parent was Red, make specific it Black and we are done.
          if (parent.isRed) {
              parent.isRed = false;
              return (node: parent, heightDecreased: false);
          } else {
              // Parent was Black, so it becomes Double Black. Propagate up.
              return (node: parent, heightDecreased: true);
          }
      }
      
      // Case 3: Sibling Black, Close Child (Left) Red, Far Child (Right) Black
      if (_isRed(sLeft) && !_isRed(sRight)) {
           steps.add(TreeStep(
           operation: 'rb_fixup',
           description: 'Case 3: 兄弟黑，内侧红 -> 旋转兄弟',
           rotationType: 'right',
          ));
          
          sibling!.isRed = true;
          sLeft!.isRed = false;
          parent.right = _rotateRight(sibling);
          
          // Fall through to Case 4
          sibling = parent.right; // New sibling (was sLeft)
          sRight = sibling?.right; // New Far Child
      }
      
      // Case 4: Sibling Black, Far Child (Right) Red
      if (_isRed(sibling!.right)) {
          steps.add(TreeStep(
           operation: 'rb_fixup',
           description: 'Case 4: 兄弟黑，外侧红 -> 旋转父节点',
           rotationType: 'left',
          ));
          
          sibling.isRed = parent.isRed;
          parent.isRed = false;
          sibling.right!.isRed = false;
          
          return (node: _rotateLeft(parent), heightDecreased: false);
      }
      
      return (node: parent, heightDecreased: false);
  }

  // Fixup when Right Child has Double Black
  ({BSTNode? node, bool heightDecreased}) _rbDeleteFixupRight(BSTNode parent, List<TreeStep> steps) {
      // Sibling is Left
      BSTNode? sibling = parent.left;
      
      // Case 1: Sibling is Red
      if (_isRed(sibling)) {
         steps.add(TreeStep(
           operation: 'rb_fixup',
           description: 'Case 1: 兄弟节点是红色 -> 旋转并变色',
           highlightNode: sibling?.value,
           rotationType: 'right',
         ));
         
         parent.isRed = true;
         sibling!.isRed = false;
         
         BSTNode newParent = _rotateRight(parent);
         
         // Continue fixup on parent (now right child of newParent)
         var res = _rbDeleteFixupRight(newParent.right!, steps);
         newParent.right = res.node;
         return (node: newParent, heightDecreased: res.heightDecreased);
      }
      
      BSTNode? sLeft = sibling?.left;
      BSTNode? sRight = sibling?.right;
      
      // Case 2: Sibling Black, Both Children Black
      if (!_isRed(sLeft) && !_isRed(sRight)) {
         steps.add(TreeStep(
           operation: 'rb_fixup',
           description: 'Case 2: 兄弟黑，双子黑 -> 兄弟变红，DoubleBlack上移',
          ));
          sibling?.isRed = true;
          if (parent.isRed) {
              parent.isRed = false;
              return (node: parent, heightDecreased: false);
          } else {
              return (node: parent, heightDecreased: true);
          }
      }
      
      // Case 3: Inner Child (Right) Red
      if (_isRed(sRight) && !_isRed(sLeft)) {
         steps.add(TreeStep(
           operation: 'rb_fixup',
           description: 'Case 3: 兄弟黑，内侧红 -> 旋转兄弟',
           rotationType: 'left',
          ));
          sibling!.isRed = true;
          sRight!.isRed = false;
          parent.left = _rotateLeft(sibling);
          
          sibling = parent.left;
          sLeft = sibling?.left;
      }
      
      // Case 4: Outer Child (Left) Red
      if (_isRed(sibling!.left)) {
         steps.add(TreeStep(
           operation: 'rb_fixup',
           description: 'Case 4: 兄弟黑，外侧红 -> 旋转父节点',
           rotationType: 'right',
          ));
          sibling.isRed = parent.isRed;
          parent.isRed = false;
          sibling.left!.isRed = false;
          
          return (node: _rotateRight(parent), heightDecreased: false);
      }
      
      return (node: parent, heightDecreased: false);
  }

  bool _isRed(BSTNode? node) {
    if (node == null) return false; // Null nodes are Black
    return node.isRed;
  }
}
