import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'app_exceptions.dart';
import 'logger.dart';

/// 全局错误处理器
class ErrorHandler {
  /// 判断错误是否可以重试(公开方法)
  static bool canRetry(dynamic error) {
    if (error is NetworkException) {
      return true;
    } else if (error is ServiceUnavailableException) {
      return true;
    } else if (error is ValidationException) {
      return false;
    } else if (error is PermissionException) {
      return false;
    }
    return false;
  }
  
  /// 记录错误日志(可扩展为远程日志上报)
  static void logError(
    String operation,
    dynamic error,
    StackTrace? stackTrace,
  ) {
    Logger.e(
      'Error in $operation',
      error: error,
      stackTrace: stackTrace,
      tag: 'ErrorHandler',
    );
    
    // TODO: 可以在这里添加远程日志上报
    // 例如: FirebaseCrashlytics.instance.recordError(error, stackTrace);
  }
  
  /// 获取用户友好的错误消息(公开方法)
  static String getErrorMessage(dynamic error, {String? prefix}) {
    return _getErrorMessage(error, prefix: prefix);
  }
  
  /// 处理错误并显示适当的消息
  static void handleError(BuildContext context, dynamic error, {String? prefix}) {
    if (!context.mounted) return;
    
    String message = _getErrorMessage(error, prefix: prefix);
    Color backgroundColor = _getErrorColor(error);
    
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: backgroundColor,
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.all(16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
        ),
        action: SnackBarAction(
          label: '确定',
          textColor: Colors.white,
          onPressed: () {
            ScaffoldMessenger.of(context).hideCurrentSnackBar();
          },
        ),
      ),
    );
  }

  /// 内部错误消息处理
  static String _getErrorMessage(dynamic error, {String? prefix}) {
    String message;
    
    if (error is AppException) {
      message = error.message;
    } else if (error is FirebaseAuthException) {
      message = _mapFirebaseAuthError(error.code);
    } else if (error is FirebaseException) {
      message = '服务异常: ${error.message ?? error.code}';
    } else if (error is FormatException) {
      message = '数据格式错误: ${error.message}';
    } else if (error is TypeError) {
      message = '类型错误: 请检查输入数据';
    } else if (error is RangeError) {
      message = '范围错误: 数值超出有效范围';
    } else if (error is StateError) {
      message = '状态错误: 操作在当前状态下不可用';
    } else if (error is UnsupportedError) {
      message = '不支持的操作: ${error.message}';
    } else if (error is AssertionError) {
      message = '断言失败: ${error.message ?? '内部逻辑错误'}';
    } else {
      message = error.toString().replaceAll('Exception:', '').trim();
      if (message.isEmpty) {
        message = '发生未知错误';
      }
    }
    
    return prefix != null ? '$prefix: $message' : message;
  }

  /// 获取错误颜色
  static Color _getErrorColor(dynamic error) {
    if (error is ValidationException) {
      return Colors.orange;
    } else if (error is PermissionException) {
      return Colors.purple;
    } else if (error is NetworkException) {
      return Colors.red[700]!;
    } else if (error is ServiceUnavailableException) {
      return Colors.grey[700]!;
    } else if (error is NotFoundException) {
      return Colors.blue[700]!;
    } else if (error is BusinessLogicException) {
      return Colors.amber[700]!;
    } else {
      return Colors.red;
    }
  }

  /// 映射Firebase认证错误
  static String _mapFirebaseAuthError(String code) {
    switch (code) {
      case 'weak-password':
        return '密码强度太弱，请使用至少6位字符';
      case 'email-already-in-use':
        return '该邮箱已被注册，请使用其他邮箱';
      case 'invalid-email':
        return '邮箱格式不正确';
      case 'user-not-found':
        return '用户不存在，请先注册';
      case 'wrong-password':
        return '密码错误，请重试';
      case 'user-disabled':
        return '该账户已被禁用';
      case 'too-many-requests':
        return '尝试次数过多,请稍后再试';
      default:
        return '认证失败: $code';
    }
  }

  /// 显示成功消息
  static void showSuccess(BuildContext context, String message) {
    if (!context.mounted) return;
    
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.check_circle, color: Colors.white),
            const SizedBox(width: 12),
            Expanded(child: Text(message)),
          ],
        ),
        backgroundColor: Colors.green,
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.all(16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
        ),
        duration: const Duration(seconds: 2),
      ),
    );
  }

  /// 显示警告消息
  static void showWarning(BuildContext context, String message) {
    if (!context.mounted) return;
    
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.warning_amber_rounded, color: Colors.white),
            const SizedBox(width: 12),
            Expanded(child: Text(message)),
          ],
        ),
        backgroundColor: Colors.orange,
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.all(16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
        ),
        duration: const Duration(seconds: 3),
      ),
    );
  }

  /// 显示信息消息
  static void showInfo(BuildContext context, String message) {
    if (!context.mounted) return;
    
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.info_outline, color: Colors.white),
            const SizedBox(width: 12),
            Expanded(child: Text(message)),
          ],
        ),
        backgroundColor: Colors.blue,
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.all(16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
        ),
        duration: const Duration(seconds: 2),
      ),
    );
  }

  /// 显示确认对话框
  static Future<bool> showConfirmDialog(
    BuildContext context, {
    required String title,
    required String message,
    String confirmText = '确定',
    String cancelText = '取消',
    bool isDangerous = false,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext context) {
        return AlertDialog(
          title: Row(
            children: [
              Icon(
                isDangerous ? Icons.warning : Icons.help_outline,
                color: isDangerous ? Colors.red : Theme.of(context).primaryColor,
              ),
              const SizedBox(width: 12),
              Text(title),
            ],
          ),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: Text(cancelText),
            ),
            ElevatedButton(
              onPressed: () => Navigator.of(context).pop(true),
              style: isDangerous
                  ? ElevatedButton.styleFrom(
                      backgroundColor: Colors.red,
                      foregroundColor: Colors.white,
                    )
                  : null,
              child: Text(confirmText),
            ),
          ],
        );
      },
    );
    
    return result ?? false;
  }

  /// 处理异步操作
  static Future<T?> handleAsyncOperation<T>(
    BuildContext context, {
    required Future<T> Function() operation,
    String? loadingMessage,
    String? successMessage,
    String? errorPrefix,
    bool showLoading = true,
  }) async {
    if (showLoading && loadingMessage != null) {
      showInfo(context, loadingMessage);
    }

    try {
      final result = await operation();
      
      if (successMessage != null && context.mounted) {
        showSuccess(context, successMessage);
      }
      
      return result;
    } catch (error) {
      if (context.mounted) {
        handleError(context, error, prefix: errorPrefix);
      }
      return null;
    }
  }
}
