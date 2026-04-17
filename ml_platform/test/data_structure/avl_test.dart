
import 'package:flutter_test/flutter_test.dart';
import 'package:ml_platform/services/tree_service.dart';

void main() {
  group('AVL Tree Logic', () {
    final service = TreeService();

    test('Single Rotate Right (LL Case)', () {
      //      30           20
      //     /            /  \
      //   20     ->    10    30
      //   /
      // 10
      BSTNode? root = BSTNode(30);
      root = service.avlInsert(root, 20).last.root; // Insert 20
      // Note: avlInsert returns steps. steps.last.root is the SUBTREE snapshot of last step?
      // No, avlInsert creates a wrapper step at the end with the FULL tree.
      // Let's check avlInsert:
      // steps.add(TreeStep(..., root: _cloneTree(root), ...)); return steps;
      // The `root` passed to avlInsert IS updated by `root = _avlInsertHelper(...)`.
      // So steps.last.root is typically the final tree state.
      
      // Reset logic: avlInsert returns Steps. 
      // But we need the actual resulting Node structure to verify height.
      // The service doesn't expose a method "insertAndReturnRoot".
      // But we can simulate it by trusting the service logic or inspecting steps.last.root
      
      // Actually, looking at code:
      // root = _avlInsertHelper(root, value, steps);
      // steps.add(TreeStep(..., root: _cloneTree(root)));
      // So yes, steps.last.root is the full balanced tree.
      
      root = service.avlInsert(root, 10).last.root;

      expect(root?.value, 20);
      expect(root?.left?.value, 10);
      expect(root?.right?.value, 30);
      expect(root?.height, 2);
    });

    test('Single Rotate Left (RR Case)', () {
      // 10               20
      //   \             /  \
      //   20    ->    10    30
      //     \
      //     30
      BSTNode? root = BSTNode(10);
      root = service.avlInsert(root, 20).last.root;
      root = service.avlInsert(root, 30).last.root;

      expect(root?.value, 20);
      expect(root?.left?.value, 10);
      expect(root?.right?.value, 30);
      expect(root?.height, 2);
    });

    test('Double Rotate Left-Right (LR Case)', () {
      //   30              30            25
      //   /              /             /  \
      // 20      ->     25     ->     20    30
      //   \            /
      //   25          20
      BSTNode? root = BSTNode(30);
      root = service.avlInsert(root, 20).last.root;
      root = service.avlInsert(root, 25).last.root;

      expect(root?.value, 25);
      expect(root?.left?.value, 20);
      expect(root?.right?.value, 30);
      expect(root?.height, 2);
    });

    test('Double Rotate Right-Left (RL Case)', () {
      // 10              10              15
      //   \              \             /  \
      //   20     ->      15    ->    10    20
      //   /               \
      //  15               20
      BSTNode? root = BSTNode(10);
      root = service.avlInsert(root, 20).last.root;
      root = service.avlInsert(root, 15).last.root;

      expect(root?.value, 15);
      expect(root?.left?.value, 10);
      expect(root?.right?.value, 20);
      expect(root?.height, 2);
    });
    
    test('Complex Balance', () {
      // Insert 10, 20, 30, 40, 50, 25
      // Should remain balanced
      BSTNode? root = BSTNode(10);
      root = service.avlInsert(root, 20).last.root;
      root = service.avlInsert(root, 30).last.root; 
      // 20 (10,30)
      root = service.avlInsert(root, 40).last.root;
      // 20 (10, 30(40))
      root = service.avlInsert(root, 50).last.root;
      // RR on 30: 20 (10, 40(30, 50))
      root = service.avlInsert(root, 25).last.root;
      // Insert 25: 20 -> 40 -> 30 -> 25.
      // 30 becomes unbalanced? No.
      // 40 left (30) height 2. 40 right (50) height 1. OK.
      // 20 left (10) height 1. 20 right (40) height 3. Unbalanced.
      // RL Rotation on 20?
      // Check structure.
      
      // Expected root might change.
      // Just check AVL property: for every node, |height diff| <= 1.
      bool isBalanced(BSTNode? node) {
        if (node == null) return true;
        int diff = (service.avlInsert(null, 0).isEmpty ? 0 : 0); // access private? No.
        // We can't access _getHeight here.
        // But we can check node.height logic we implemented.
        int hL = node.left?.height ?? 0;
        int hR = node.right?.height ?? 0;
        if ((hL - hR).abs() > 1) return false;
        return isBalanced(node.left) && isBalanced(node.right);
      }
      expect(isBalanced(root), true);
    });
  });
}
