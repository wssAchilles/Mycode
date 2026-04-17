import 'package:flutter_test/flutter_test.dart';
import 'package:ml_platform/utils/validators.dart';

void main() {
  group('Validators.validateEmail', () {
    test('returns error for empty', () {
      expect(Validators.validateEmail(''), isNotNull);
    });

    test('returns error for invalid format', () {
      expect(Validators.validateEmail('invalid-email'), isNotNull);
    });

    test('returns null for valid email', () {
      expect(Validators.validateEmail('user@example.com'), isNull);
    });
  });

  group('Validators.validatePassword', () {
    test('returns error for empty', () {
      expect(Validators.validatePassword(''), isNotNull);
    });

    test('returns error for short password', () {
      expect(Validators.validatePassword('123'), isNotNull);
    });

    test('returns null for reasonable password', () {
      expect(Validators.validatePassword('Test1234'), isNull);
    });
  });

  group('Validators.validateConfirmPassword', () {
    test('returns error when mismatch', () {
      expect(Validators.validateConfirmPassword('abc', 'abcd'), isNotNull);
    });

    test('returns null when match', () {
      expect(Validators.validateConfirmPassword('abc', 'abc'), isNull);
    });
  });
}
