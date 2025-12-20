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

/// MCP 服务交互异常
class MCPException extends AppException {
  final int? statusCode;

  MCPException(String message, {required String code, this.statusCode, dynamic originalError}) 
    : super(message, code: code, originalError: originalError);

  /// 获取用户友好的错误消息
  String get userMessage {
    switch (code) {
      case 'TIMEOUT':
        return '请求超时，请检查网络连接后重试';
      case 'NETWORK_ERROR':
        return '网络连接失败，请检查网络设置';
      case 'SERVER_ERROR':
        return '服务器暂时无法响应，请稍后重试';
      case 'CLIENT_ERROR':
        return message;
      case 'PARSE_ERROR':
        return '数据格式错误，请联系技术支持';
      default:
        return '操作失败: $message';
    }
  }

  /// 判断是否可以重试
  bool get canRetry {
    return code == 'TIMEOUT' || code == 'NETWORK_ERROR' || code == 'SERVER_ERROR';
  }
}

/// 机器学习服务异常
class MLException extends AppException {
  MLException(String message, {String? code, dynamic originalError}) 
    : super(message, code: code, originalError: originalError);
}
