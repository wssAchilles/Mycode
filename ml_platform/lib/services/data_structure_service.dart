
import '../models/data_structure_model.dart';
import 'dart:math';

class DataStructureService {
  // 模拟延时，实际逻辑中不需要，主要用于生成步骤时的标记
  
  /// 生成随机数据
  List<int> generateRandomData(int size, {int min = 1, int max = 100}) {
    final random = Random();
    return List.generate(size, (_) => random.nextInt(max - min) + min);
  }

  /// 栈操作服务
  // 暂时将具体逻辑放在 Visualizer 中，后续逐步迁移
  // 这里先定义接口规范

  /// 辅助方法：克隆链表
  /// 辅助方法：克隆链表
  ListNode<T>? _cloneList<T>(ListNode<T>? head) {
    if (head == null) return null;
    var newHead = ListNode<T>(head.value);
    var curr = head.next;
    var newCurr = newHead;
    
    while (curr != null) {
      var newNode = ListNode<T>(curr.value);
      newCurr.next = newNode;
      newNode.prev = newCurr;
      newCurr = newNode;
      curr = curr.next;
    }
    return newHead;
  }

  /// 链表插入 (支持单向)
  List<DataStructureStep> linkedListInsert(ListNode<int>? head, int value, int index) {
    // ... existing implementation logic ...
    // 为了节省篇幅，这里假设直接复用原逻辑，因为单链表插入时 prev 为空不影响。
    // 但如果要写完整逻辑，需要把之前的大段代码搬过来。
    // 由于我不想重写整个文件，我将只替换 _cloneList 并且追加双向链表方法到类末尾。
    // 但是 replace_file_content 必须连续。
    // 所以我这里必须包含 linkedListInsert 的完整代码或者分块。
    return _singlyLinkedListInsert(head, value, index); 
  }

  List<DataStructureStep> _singlyLinkedListInsert(ListNode<int>? head, int value, int index) {
     List<DataStructureStep> steps = [];
    
    // 初始状态
    steps.add(DataStructureStep(
      stepNumber: 0,
      operation: 'Start Insert',
      description: '开始在索引 $index 处插入值 $value',
      currentState: _cloneList(head),
      highlightedElements: [],
    ));

    if (index < 0) return steps;

    // 如果插入头部
    if (index == 0) {
      var newHead = ListNode(value);
      newHead.next = _cloneList(head); 
      
      steps.add(DataStructureStep(
        stepNumber: 1,
        operation: 'Insert Head',
        description: '创建新节点 $value 并指向原头节点',
        currentState: newHead,
        highlightedElements: ['new', '0'],
      ));
      return steps;
    }

    // 模拟遍历
    var currentHead = _cloneList(head);
    var curr = currentHead;
    int currentIndex = 0;

    while (curr != null && currentIndex < index - 1) {
      steps.add(DataStructureStep(
        stepNumber: steps.length + 1,
        operation: 'Traverse',
        description: '遍历到索引 $currentIndex: ${curr.value}',
        currentState: currentHead,
        highlightedElements: [currentIndex.toString()], 
      ));
      curr = curr.next;
      currentIndex++;
    }

    if (curr != null) {
      // 找到位置
      steps.add(DataStructureStep(
        stepNumber: steps.length + 1,
        operation: 'Found Position',
        description: '找到插入位置的前驱节点: ${curr.value}',
        currentState: currentHead,
        highlightedElements: [currentIndex.toString()],
      ));

      // 执行插入
      var newNode = ListNode(value);
      newNode.next = curr.next;
      curr.next = newNode;

      steps.add(DataStructureStep(
        stepNumber: steps.length + 1,
        operation: 'Insert Node',
        description: '插入节点 $value',
        currentState: currentHead,
        highlightedElements: [(currentIndex + 1).toString()],
      ));
    }

    return steps;
  }
  
  /// 双向链表插入
  List<DataStructureStep> doublyLinkedListInsert(ListNode<int>? head, int value, int index) {
      List<DataStructureStep> steps = [];
      steps.add(DataStructureStep(
        stepNumber: 0,
        operation: 'Start Insert',
        description: '双向链表：开始在索引 $index 处插入值 $value',
        currentState: _cloneList(head),
        highlightedElements: [],
      ));
      
      var currentHead = _cloneList(head);
      
      if (index == 0) {
          var newNode = ListNode(value);
          newNode.next = currentHead;
          if (currentHead != null) {
              currentHead.prev = newNode; 
          }
          currentHead = newNode;
          
          steps.add(DataStructureStep(
            stepNumber: 1,
            operation: 'Insert Head',
            description: '从头部插入，更新 prev/next 指针',
            currentState: currentHead,
            highlightedElements: ['0'],
          ));
          return steps;
      }
      
      var curr = currentHead;
      int currentIndex = 0;
      while (curr != null && currentIndex < index - 1) {
          curr = curr.next;
          currentIndex++;
      }
      
      if (curr != null) {
          var newNode = ListNode(value);
          newNode.next = curr.next;
          newNode.prev = curr;
          
          if (curr.next != null) {
              curr.next!.prev = newNode;
          }
          curr.next = newNode;
          
          steps.add(DataStructureStep(
            stepNumber: 2,
            operation: 'Insert Node',
            description: '插入完成，所有指针已更新',
            currentState: currentHead,
            highlightedElements: [index.toString()],
          ));
      }
      
      return steps;
  }

  /// 链表删除
  List<DataStructureStep> linkedListDelete(ListNode<int>? head, int index) {
    List<DataStructureStep> steps = [];
    if (head == null) return steps;

    var currentHead = _cloneList(head);
    
    steps.add(DataStructureStep(
      stepNumber: 0,
      operation: 'Start Delete',
      description: '开始删除索引 $index 处的节点',
      currentState: currentHead,
      highlightedElements: [],
    ));

    if (index == 0) {
      steps.add(DataStructureStep(
        stepNumber: 1,
        operation: 'Delete Head',
        description: '删除头节点 ${head.value}',
        currentState: currentHead?.next,
        highlightedElements: [],
      ));
      return steps;
    }

    var curr = currentHead;
    int currentIndex = 0;
    while (curr != null && currentIndex < index - 1) {
        steps.add(DataStructureStep(
        stepNumber: steps.length + 1,
        operation: 'Traverse',
        description: '遍历到索引 $currentIndex: ${curr.value}',
        currentState: currentHead,
        highlightedElements: [currentIndex.toString()],
      ));
      curr = curr.next;
      currentIndex++;
    }

    if (curr != null && curr.next != null) {
        var toDelete = curr.next!;
        curr.next = toDelete.next;
        
         steps.add(DataStructureStep(
          stepNumber: steps.length + 1,
          operation: 'Delete Node',
          description: '删除节点 ${toDelete.value}',
          currentState: currentHead,
          highlightedElements: [],
        ));
    }

    return steps;
  }
  /// 双向链表删除
  List<DataStructureStep> doublyLinkedListDelete(ListNode<int>? head, int index) {
      List<DataStructureStep> steps = [];
      if (head == null) return steps;
      
      var currentHead = _cloneList(head);
      
      steps.add(DataStructureStep(
        stepNumber: 0,
        operation: 'Start Delete',
        description: '双向链表：开始删除索引 $index 处的节点',
        currentState: currentHead,
        highlightedElements: [],
      ));
      
      if (index == 0) {
          if (currentHead!.next != null) {
              currentHead.next!.prev = null;
          }
          currentHead = currentHead.next;
          
          steps.add(DataStructureStep(
            stepNumber: 1,
            operation: 'Delete Head',
            description: '删除头节点，更新 next.prev 为空',
            currentState: currentHead,
            highlightedElements: [],
          ));
          return steps;
      }
      
      var curr = currentHead;
      int currentIndex = 0;
      // 遍历找到要删除的节点
      while (curr != null && currentIndex < index) {
          curr = curr.next;
          currentIndex++;
      }
      
      if (curr != null) {
          // curr 是要删除的节点
          if (curr.prev != null) {
              curr.prev!.next = curr.next;
          }
          if (curr.next != null) {
              curr.next!.prev = curr.prev;
          }
          
          steps.add(DataStructureStep(
             stepNumber: 2,
             operation: 'Delete Node',
             description: '删除节点 ${curr.value}，更新前驱后继指针',
             currentState: currentHead,
             highlightedElements: [],
          ));
      }
      return steps;
  }
}

