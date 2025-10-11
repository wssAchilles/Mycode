/// 应用自定义异常基类
class AppException implements Exception {
  final String message;
  final String? code;
  final dynamic originalError;
  
  AppException(this.message, {this.code, this.originalError});

  @override
  String toString() => message;
}

/// 认证相关异常
class AuthException extends AppException {
  AuthException(String message, {String? code, dynamic originalError}) 
    : super(message, code: code, originalError: originalError);
}

/// 数据存储相关异常
class FirestoreException extends AppException {
  FirestoreException(String message, {String? code, dynamic originalError}) 
    : super(message, code: code, originalError: originalError);
}

/// 网络请求异常
class NetworkException extends AppException {
  NetworkException(String message, {String? code, dynamic originalError}) 
    : super(message, code: code, originalError: originalError);
}

/// 文件处理异常
class FileException extends AppException {
  FileException(String message, {String? code, dynamic originalError}) 
    : super(message, code: code, originalError: originalError);
}

/// 验证异常
class ValidationException extends AppException {
  ValidationException(String message, {String? code, dynamic originalError}) 
    : super(message, code: code, originalError: originalError);
}

/// 业务逻辑异常
class BusinessLogicException extends AppException {
  BusinessLogicException(String message, {String? code, dynamic originalError}) 
    : super(message, code: code, originalError: originalError);
}

/// 权限异常
class PermissionException extends AppException {
  PermissionException(String message, {String? code, dynamic originalError}) 
    : super(message, code: code, originalError: originalError);
}

/// 资源未找到异常
class NotFoundException extends AppException {
  NotFoundException(String message, {String? code, dynamic originalError}) 
    : super(message, code: code, originalError: originalError);
}

/// 服务不可用异常
class ServiceUnavailableException extends AppException {
  ServiceUnavailableException(String message, {String? code, dynamic originalError}) 
    : super(message, code: code, originalError: originalError);
}
