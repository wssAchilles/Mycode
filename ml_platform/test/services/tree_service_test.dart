import 'package:flutter_test/flutter_test.dart';
import 'package:ml_platform/services/tree_service.dart';
// import 'package:ml_platform/models/data_structure_model.dart'; // BSTNode is inside TreeService file now? No, I see class BSTNode in tree_service.dart line 6.
// Wait, previous view_file of data_structure_model.dart L29 showed TreeNode.
// TreeService.dart L3 imports data_structure_model.dart but defines BSTNode at L6.
// It seems TreeService uses its own BSTNode class, or maybe I should check if it exports it.
// bstInsert returns List<TreeStep>. TreeStep uses BSTNode.
// So I need to import tree_service.dart.

void main() {
  group('TreeService Tests', () {
    late TreeService service;

    setUp(() {
      service = TreeService();
    });

    group('BST Operations', () {
      test('Insert values', () {
        List<TreeStep> steps = service.bstInsert(null, 10);
        var root = steps.last.root;
        expect(root!.value, 10);
        
        steps = service.bstInsert(root, 5);
        root = steps.last.root;
        expect(root!.left!.value, 5);
        
        steps = service.bstInsert(root, 15);
        root = steps.last.root;
        expect(root!.right!.value, 15);
      });

      test('Delete leaf node', () {
        var root = BSTNode(10);
        root.left = BSTNode(5);
        
        List<TreeStep> steps = service.bstDelete(root, 5);
        var newRoot = steps.last.root;
        expect(newRoot!.value, 10);
        expect(newRoot.left, isNull);
      });
    });

    group('AVL Operations', () {
      test('Left Rotation (RR Case)', () {
        // Insert 10, 20, 30 -> Should rotate left
        List<TreeStep> steps = service.avlInsert(null, 10);
        var root = steps.last.root;
        
        steps = service.avlInsert(root, 20);
        root = steps.last.root;
        
        steps = service.avlInsert(root, 30);
        root = steps.last.root;
        
        expect(root!.value, 20);
        expect(root.left!.value, 10);
        expect(root.right!.value, 30);
        expect(root.height, 2);
      });

      test('Right Rotation (LL Case)', () {
        // Insert 30, 20, 10 -> Should rotate right
        List<TreeStep> steps = service.avlInsert(null, 30);
        var root = steps.last.root;
        
        steps = service.avlInsert(root, 20);
        root = steps.last.root;
        
        steps = service.avlInsert(root, 10);
        root = steps.last.root;
        
        expect(root!.value, 20);
        expect(root.left!.value, 10);
        expect(root.right!.value, 30);
      });

      test('Left-Right Rotation (LR Case)', () {
        // Insert 30, 10, 20
        List<TreeStep> steps = service.avlInsert(null, 30);
        var root = steps.last.root;
        
        steps = service.avlInsert(root, 10);
        root = steps.last.root;
        
        steps = service.avlInsert(root, 20);
        root = steps.last.root;
        
        expect(root!.value, 20);
        expect(root.left!.value, 10);
        expect(root.right!.value, 30);
      });

      test('Right-Left Rotation (RL Case)', () {
        // Insert 10, 30, 20
        List<TreeStep> steps = service.avlInsert(null, 10);
        var root = steps.last.root;
        
        steps = service.avlInsert(root, 30);
        root = steps.last.root;
        
        steps = service.avlInsert(root, 20);
        root = steps.last.root;
        
        expect(root!.value, 20);
        expect(root.left!.value, 10);
        expect(root.right!.value, 30);
      });
    });
  });
}
