/// 输入验证工具类
class Validators {
  /// 邮箱验证正则表达式
  static final RegExp _emailRegExp = RegExp(
    r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$',
  );

  /// 验证邮箱格式
  static String? validateEmail(String? value) {
    if (value == null || value.isEmpty) {
      return '请输入邮箱地址';
    }
    
    final trimmedValue = value.trim();
    if (!_emailRegExp.hasMatch(trimmedValue)) {
      return '请输入有效的邮箱地址';
    }
    
    if (trimmedValue.length > 100) {
      return '邮箱地址过长';
    }
    
    return null;
  }

  /// 验证密码
  static String? validatePassword(String? value) {
    if (value == null || value.isEmpty) {
      return '请输入密码';
    }
    
    if (value.length < 6) {
      return '密码至少需要6个字符';
    }
    
    if (value.length > 50) {
      return '密码不能超过50个字符';
    }
    
    // 检查密码强度
    bool hasUppercase = value.contains(RegExp(r'[A-Z]'));
    bool hasLowercase = value.contains(RegExp(r'[a-z]'));
    bool hasDigit = value.contains(RegExp(r'[0-9]'));
    
    if (!hasUppercase && !hasLowercase && !hasDigit) {
      return '密码过于简单，请包含字母和数字';
    }
    
    return null;
  }

  /// 验证确认密码
  static String? validateConfirmPassword(String? value, String password) {
    if (value == null || value.isEmpty) {
      return '请再次输入密码';
    }
    
    if (value != password) {
      return '两次输入的密码不一致';
    }
    
    return null;
  }

  /// 验证用户名
  static String? validateUsername(String? value) {
    if (value == null || value.isEmpty) {
      return '请输入用户名';
    }
    
    final trimmedValue = value.trim();
    
    if (trimmedValue.length < 2) {
      return '用户名至少需要2个字符';
    }
    
    if (trimmedValue.length > 30) {
      return '用户名不能超过30个字符';
    }
    
    // 检查是否包含非法字符
    if (!RegExp(r'^[a-zA-Z0-9_\u4e00-\u9fa5]+$').hasMatch(trimmedValue)) {
      return '用户名只能包含字母、数字、下划线和中文';
    }
    
    return null;
  }

  /// 验证正整数
  static String? validatePositiveInteger(String? value, {
    String fieldName = '数值',
    int? min,
    int? max,
  }) {
    if (value == null || value.isEmpty) {
      return '请输入$fieldName';
    }
    
    final number = int.tryParse(value);
    if (number == null) {
      return '$fieldName必须是整数';
    }
    
    if (number <= 0) {
      return '$fieldName必须大于0';
    }
    
    if (min != null && number < min) {
      return '$fieldName不能小于$min';
    }
    
    if (max != null && number > max) {
      return '$fieldName不能大于$max';
    }
    
    return null;
  }

  /// 验证非负整数
  static String? validateNonNegativeInteger(String? value, {
    String fieldName = '数值',
    int? max,
  }) {
    if (value == null || value.isEmpty) {
      return '请输入$fieldName';
    }
    
    final number = int.tryParse(value);
    if (number == null) {
      return '$fieldName必须是整数';
    }
    
    if (number < 0) {
      return '$fieldName不能为负数';
    }
    
    if (max != null && number > max) {
      return '$fieldName不能大于$max';
    }
    
    return null;
  }

  /// 验证浮点数
  static String? validateDouble(String? value, {
    String fieldName = '数值',
    double? min,
    double? max,
  }) {
    if (value == null || value.isEmpty) {
      return '请输入$fieldName';
    }
    
    final number = double.tryParse(value);
    if (number == null) {
      return '$fieldName必须是数字';
    }
    
    if (min != null && number < min) {
      return '$fieldName不能小于$min';
    }
    
    if (max != null && number > max) {
      return '$fieldName不能大于$max';
    }
    
    return null;
  }

  /// 验证百分比（0-100）
  static String? validatePercentage(String? value, {
    String fieldName = '百分比',
  }) {
    if (value == null || value.isEmpty) {
      return '请输入$fieldName';
    }
    
    final number = double.tryParse(value);
    if (number == null) {
      return '$fieldName必须是数字';
    }
    
    if (number < 0 || number > 100) {
      return '$fieldName必须在0到100之间';
    }
    
    return null;
  }

  /// 验证列表不为空
  static String? validateListNotEmpty<T>(List<T>? list, {
    String fieldName = '列表',
  }) {
    if (list == null || list.isEmpty) {
      return '$fieldName不能为空';
    }
    return null;
  }

  /// 验证矩阵维度
  static String? validateMatrix(List<List<int>>? matrix, {
    required int expectedRows,
    required int expectedCols,
    String fieldName = '矩阵',
  }) {
    if (matrix == null) {
      return '$fieldName不能为空';
    }
    
    if (matrix.length != expectedRows) {
      return '$fieldName行数必须为$expectedRows';
    }
    
    for (int i = 0; i < matrix.length; i++) {
      if (matrix[i].length != expectedCols) {
        return '$fieldName第${i + 1}行列数必须为$expectedCols';
      }
    }
    
    return null;
  }

  /// 验证文件路径
  static String? validateFilePath(String? value) {
    if (value == null || value.isEmpty) {
      return '请选择文件';
    }
    
    // 检查路径是否过长
    if (value.length > 260) {
      return '文件路径过长';
    }
    
    // 检查是否包含非法字符
    if (value.contains(RegExp(r'[<>:"|?*]'))) {
      return '文件路径包含非法字符';
    }
    
    return null;
  }

  /// 验证CSV文件扩展名
  static String? validateCSVFile(String? filePath) {
    final pathError = validateFilePath(filePath);
    if (pathError != null) return pathError;
    
    if (!filePath!.toLowerCase().endsWith('.csv')) {
      return '请选择CSV文件';
    }
    
    return null;
  }

  /// 验证URL
  static String? validateUrl(String? value) {
    if (value == null || value.isEmpty) {
      return '请输入URL';
    }
    
    try {
      final uri = Uri.parse(value);
      if (!uri.hasScheme || !uri.hasAuthority) {
        return '请输入有效的URL';
      }
      
      if (uri.scheme != 'http' && uri.scheme != 'https') {
        return 'URL必须以http://或https://开头';
      }
      
      return null;
    } catch (e) {
      return '无效的URL格式';
    }
  }

  /// 清理输入字符串
  static String sanitizeInput(String input) {
    return input
        .trim()
        .replaceAll(RegExp(r'<[^>]*>'), '') // 移除HTML标签
        .replaceAll(RegExp(r'[^\w\s\u4e00-\u9fa5.,!?@#$%^&*()_+=\-\[\]{}|;:]'), ''); // 保留常见字符
  }

  /// 验证搜索关键词
  static String? validateSearchQuery(String? value, {
    int minLength = 2,
    int maxLength = 50,
  }) {
    if (value == null || value.isEmpty) {
      return null; // 允许空搜索
    }
    
    final trimmedValue = value.trim();
    
    if (trimmedValue.length < minLength) {
      return '搜索关键词至少需要$minLength个字符';
    }
    
    if (trimmedValue.length > maxLength) {
      return '搜索关键词不能超过$maxLength个字符';
    }
    
    return null;
  }

  /// 批量验证
  static Map<String, String?> validateAll(Map<String, String? Function()> validators) {
    final errors = <String, String?>{};
    
    validators.forEach((key, validator) {
      errors[key] = validator();
    });
    
    // 移除null值
    errors.removeWhere((key, value) => value == null);
    
    return errors;
  }

  /// 检查是否有验证错误
  static bool hasErrors(Map<String, String?> errors) {
    return errors.values.any((error) => error != null);
  }
}
