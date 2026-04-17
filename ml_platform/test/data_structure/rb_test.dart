
import 'package:flutter_test/flutter_test.dart';
import 'package:ml_platform/services/tree_service.dart';

void main() {
  group('Red-Black Tree Logic', () {
    final service = TreeService();
    
    // Helper to check Red property
    bool isRed(BSTNode? node) => node?.isRed ?? false;
    bool isBlack(BSTNode? node) => !isRed(node);

    test('Insert Root', () {
      final steps = service.rbInsert(null, 10);
      BSTNode? root = steps.last.root;
      
      expect(root?.value, 10);
      expect(isBlack(root), true); // Root must be Black
    });

    test('Insert Red Child', () {
      BSTNode? root = BSTNode(10, isRed: false);
      final steps = service.rbInsert(root, 5);
      root = steps.last.root; // Note: steps return snapshot
      
      // Since we don't have access to global root reference in unit test simply by calling insert,
      // we need to rely on the returned snapshot.
      // But service.rbInsert logic:
      // root = _rbInsertHelper(root, value, steps);
      // ...
      // steps.add(..., root: _cloneTree(root));
      // So steps.last.root IS the tree.
      
      expect(root?.left?.value, 5);
      expect(isRed(root?.left), true); // New node is Red
      expect(isBlack(root), true);
    });

    test('Recolor Case (Uncle is Red)', () {
      //      10(B)
      //     /    \
      //   5(R)   15(R)
      //   /
      // 1(R)  <- Insert
      //
      // Should become:
      //      10(B) -> 10(B) ? No, root stays black
      //     /    \
      //   5(B)   15(B) 
      //   /
      // 1(R)
      
      BSTNode? root = BSTNode(10, isRed: false);
      root?.left = BSTNode(5, isRed: true);
      root?.right = BSTNode(15, isRed: true);
      
      final steps = service.rbInsert(root, 1);
      BSTNode? newRoot = steps.last.root;
      
      // Check structure
      expect(newRoot?.value, 10);
      expect(newRoot?.left?.value, 5);
      expect(newRoot?.right?.value, 15);
      expect(newRoot?.left?.left?.value, 1);
      
      // Check colors
      expect(isBlack(newRoot), true);       // 10 Black
      expect(isBlack(newRoot?.left), true); // 5 Black (Recolored)
      expect(isBlack(newRoot?.right), true);// 15 Black (Recolored)
      expect(isRed(newRoot?.left?.left), true); // 1 Red
    });

    test('LL Rotation Case (Uncle is Black)', () {
      //      10(B)
      //     /
      //   5(R)
      //   /
      // 1(R) <- Insert
      //
      // Uncle (right of 10) is Null (Black)
      // Should Rotate Right on 10.
      //
      //      5(B)
      //     /   \
      //   1(R)  10(R)
      
      BSTNode? root = BSTNode(10, isRed: false);
      root?.left = BSTNode(5, isRed: true);
      
      final steps = service.rbInsert(root, 1);
      BSTNode? newRoot = steps.last.root;
      
      expect(newRoot?.value, 5);
      expect(newRoot?.left?.value, 1);
      expect(newRoot?.right?.value, 10);
      
      // Colors
      // Parent (5) becomes the new root (would be black if it was real root, but here it's effectively local root)
      // Actually rbInsert forces root to be black at the end.
      expect(isBlack(newRoot), true); 
      expect(isRed(newRoot?.left), true);
      expect(isRed(newRoot?.right), true);
      
      // Wait, is 10 Red?
      // LL Fixup: Swap colors Parent(5) and Grandparent(10).
      // 5 was Red, 10 was Black.
      // 5 becomes Black, 10 becomes Red.
      // But 5 is the new Root, so it is forced Black.
    });
    
    test('LR Rotation Case', () {
       //      10(B)
       //     /
       //   5(R)
       //     \
       //     7(R) <- Insert
       //
       // Uncle is Null (Black).
       // LR -> Left Rotate 5, then Right Rotate 10.
       //
       //      7(B)
       //     /   \
       //   5(R)  10(R)
       
       BSTNode? root = BSTNode(10, isRed: false);
       root?.left = BSTNode(5, isRed: true);
       
       final steps = service.rbInsert(root, 7);
       BSTNode? newRoot = steps.last.root;
       
       expect(newRoot?.value, 7);
       expect(newRoot?.left?.value, 5);
       expect(newRoot?.right?.value, 10);
       
       expect(isBlack(newRoot), true);
       expect(isRed(newRoot?.left), true);
       expect(isRed(newRoot?.right), true);
    });

    test('Delete Leaf Node (Red)', () {
       //      10(B)
       //     /
       //   5(R)  <- Delete 5
       //
       // Simple deletion. No fixup.
       
       BSTNode? root = BSTNode(10, isRed: false);
       root.left = BSTNode(5, isRed: true);
       
       final steps = service.rbDelete(root, 5);
       BSTNode? newRoot = steps.last.root;
       
       expect(newRoot?.value, 10);
       expect(newRoot?.left, null);
    });

    test('Delete Node with 2 Children (Substitute Successor)', () {
       //      10(B)
       //     /    \
       //   5(R)   15(R)
       //          /   \
       //        12(B) 17(B)
       //
       // Delete 10. Successor is 12.
       // 12 (Black) replaces 10 (Black).
       // We then delete 12 from its original position.
       // 12 was Black Leaf -> Height Decreased -> Fixup.
       
       BSTNode? root = BSTNode(10, isRed: false);
       root.left = BSTNode(5, isRed: true);
       root.right = BSTNode(15, isRed: true);
       root.right!.left = BSTNode(12, isRed: false);
       root.right!.right = BSTNode(17, isRed: false);
       
       final steps = service.rbDelete(root, 10);
       BSTNode? newRoot = steps.last.root;
       
       // Successor 12 should be at root
       expect(newRoot?.value, 12);
       expect(newRoot?.left?.value, 5);
       expect(newRoot?.right?.value, 15);
       
       // Fixup should occur on the right side.
       // Original: 12 was deleted from 15's left.
       // 15(R) became pivot. Sibling was 17(B).
       // ... Verification might depend on specific fixup path.
       // But tree must be valid.
       expect(isBlack(newRoot), true);
    });
    
    test('Fixup Case 1 (Sibling is Red)', () {
       //       10(B)
       //      /     \
       //    5(B)    20(R)  <- Sibling
       //            /  \
       //          15(B) 25(B)
       //
       //  Delete 5(B). Double Black at left.
       //  Sibling 20 is Red. -> Case 1.
       
       BSTNode? root = BSTNode(10, isRed: false);
       root.left = BSTNode(5, isRed: false);
       root.right = BSTNode(20, isRed: true);
       root.right!.left = BSTNode(15, isRed: false);
       root.right!.right = BSTNode(25, isRed: false);
       
       final steps = service.rbDelete(root, 5);
       BSTNode? newRoot = steps.last.root;
       
       // Sibling 20(R) Rotates Left, 10 becomes Red.
       // 15 becomes new Sibling of 5(Ghost).
       // 15 is Black. 
       // If 15 has Black children (Case 2) -> 15 becomes Red, Double Black up to 10(R).
       // 10 becomes Black. Done.
       
       // Expected Result:
       //       20(B)
       //      /    \
       //    10(B)  25(B)
       //      \
       //      15(R)
       
       expect(newRoot?.value, 20);
       expect(newRoot?.left?.value, 10);
       expect(newRoot?.right?.value, 25);
       expect(newRoot?.left?.right?.value, 15);
       expect(isRed(newRoot?.left?.right), true); 
    });
  });
}
