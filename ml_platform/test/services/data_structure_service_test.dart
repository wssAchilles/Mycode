import 'package:flutter_test/flutter_test.dart';
import 'package:ml_platform/services/data_structure_service.dart';
import 'package:ml_platform/models/data_structure_model.dart';

void main() {
  group('DataStructureService Tests', () {
    late DataStructureService service;

    setUp(() {
      service = DataStructureService();
    });

    group('Singly Linked List', () {
      test('Insert at Head', () {
        // head is null
        var steps = service.linkedListInsert(null, 10, 0);
        expect(steps.last.currentState!.value, 10);

        // head is not null
        var head = ListNode(5);
        steps = service.linkedListInsert(head, 10, 0);
        var newHead = steps.last.currentState as ListNode<int>;
        expect(newHead.value, 10);
        expect(newHead.next!.value, 5);
      });

      test('Insert at Middle', () {
        var head = ListNode(1);
        head.next = ListNode(3);
        var steps = service.linkedListInsert(head, 2, 1);
        var newHead = steps.last.currentState as ListNode<int>;
        expect(newHead.next!.value, 2);
        expect(newHead.next!.next!.value, 3);
      });

      test('Delete Node', () {
        var head = ListNode(1);
        head.next = ListNode(2);
        var steps = service.linkedListDelete(head, 0); // Delete 1
        var newHead = steps.last.currentState as ListNode<int>?;
        expect(newHead!.value, 2);
      });
    });

    group('Doubly Linked List', () {
      test('Insert at Head with prev pointers', () {
        var steps = service.doublyLinkedListInsert(null, 10, 0);
        var newHead = steps.last.currentState as ListNode<int>;
        expect(newHead.value, 10);
        expect(newHead.prev, isNull);
        expect(newHead.next, isNull);

        var head = ListNode(5);
        // Note: steps logic clones the list, so we check the currentState
        steps = service.doublyLinkedListInsert(head, 10, 0);
        newHead = steps.last.currentState as ListNode<int>;
        expect(newHead.value, 10);
        expect(newHead.next!.value, 5);
        // Check prev pointer: The node 5 (next) should point back to node 10 (newHead)
        expect(newHead.next!.prev, newHead); 
      });

      test('Insert at Middle with prev pointers', () {
        var head = ListNode(1);
        var node3 = ListNode(3);
        head.next = node3;
        node3.prev = head;

        var steps = service.doublyLinkedListInsert(head, 2, 1);
        var newHead = steps.last.currentState as ListNode<int>;

        var node2 = newHead.next!;
        expect(node2.value, 2);
        expect(node2.prev!.value, 1); // 2 goes back to 1
        expect(node2.next!.value, 3); // 2 goes forward to 3
        expect(node2.next!.prev!.value, 2); // 3 goes back to 2
      });

      test('Delete Middle with prev pointers', () {
        var node1 = ListNode(1);
        var node2 = ListNode(2);
        var node3 = ListNode(3);

        node1.next = node2; node2.prev = node1;
        node2.next = node3; node3.prev = node2;

        var steps = service.doublyLinkedListDelete(node1, 1); // Delete 2
        var newHead = steps.last.currentState as ListNode<int>;

        expect(newHead.next!.value, 3);
        expect(newHead.next!.prev!.value, 1); // 3 goes back to 1
      });
    });
  });
}
