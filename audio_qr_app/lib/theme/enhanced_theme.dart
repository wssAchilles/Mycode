import 'package:flutter/material.dart';

/// 增强的UI主题配置
class EnhancedTheme {
  // 现代化配色方案
  static const Color primaryColor = Color(0xFF4F46E5); // 深蓝紫色
  static const Color secondaryColor = Color(0xFF7C3AED); // 活力紫色
  static const Color accentColor = Color(0xFF0891B2); // 清新青色
  
  // 功能性颜色
  static const Color successColor = Color(0xFF059669);
  static const Color warningColor = Color(0xFFD97706);
  static const Color errorColor = Color(0xFFDC2626);
  static const Color dangerColor = Color(0xFFDC2626);
  static const Color infoColor = Color(0xFF2563EB);
  
  // 渐变色组合
  static const List<Color> primaryGradient = [Color(0xFF4F46E5), Color(0xFF7C3AED)];
  static const List<Color> secondaryGradient = [Color(0xFF0891B2), Color(0xFF0284C7)];
  static const List<Color> successGradient = [Color(0xFF059669), Color(0xFF10B981)];
  static const List<Color> warningGradient = [Color(0xFFD97706), Color(0xFFF59E0B)];
  static const List<Color> accentGradient = [Color(0xFF0891B2), Color(0xFF7C3AED)];
  
  // 增强按钮样式
  static ButtonStyle enhancedElevatedButtonStyle(ColorScheme colorScheme) {
    return ElevatedButton.styleFrom(
      elevation: 0,
      shadowColor: Colors.transparent,
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
      ),
      textStyle: const TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.5,
      ),
    ).copyWith(
      // 悬停和按压效果
      overlayColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.hovered)) {
          return colorScheme.primary.withOpacity(0.08);
        }
        if (states.contains(WidgetState.pressed)) {
          return colorScheme.primary.withOpacity(0.16);
        }
        return null;
      }),
      // 动态阴影效果
      elevation: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.hovered)) {
          return 8;
        }
        if (states.contains(WidgetState.pressed)) {
          return 2;
        }
        return 4;
      }),
      // 动态背景色
      backgroundColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) {
          return colorScheme.onSurface.withOpacity(0.12);
        }
        return colorScheme.primary;
      }),
    );
  }
  
  // 增强outlined按钮样式
  static ButtonStyle enhancedOutlinedButtonStyle(ColorScheme colorScheme) {
    return OutlinedButton.styleFrom(
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
      ),
      textStyle: const TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.5,
      ),
    ).copyWith(
      // 边框颜色
      side: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.hovered)) {
          return BorderSide(color: colorScheme.primary, width: 2);
        }
        if (states.contains(WidgetState.pressed)) {
          return BorderSide(color: colorScheme.primary, width: 2);
        }
        return BorderSide(color: colorScheme.outline, width: 1.5);
      }),
      // 悬停效果
      overlayColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.hovered)) {
          return colorScheme.primary.withOpacity(0.04);
        }
        if (states.contains(WidgetState.pressed)) {
          return colorScheme.primary.withOpacity(0.08);
        }
        return null;
      }),
    );
  }
  
  // 增强卡片样式
  static CardTheme enhancedCardTheme(ColorScheme colorScheme) {
    return CardTheme(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20), // 更圆润的边角
        side: BorderSide(
          color: colorScheme.outline.withOpacity(0.12),
          width: 1,
        ),
      ),
      color: colorScheme.surface,
      shadowColor: colorScheme.shadow.withOpacity(0.1),
      surfaceTintColor: colorScheme.surfaceTint,
    );
  }
  
  // 增强输入框样式
  static InputDecorationTheme enhancedInputDecorationTheme(ColorScheme colorScheme) {
    return InputDecorationTheme(
      filled: true,
      fillColor: colorScheme.surfaceContainerHighest.withOpacity(0.3),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: colorScheme.outline.withOpacity(0.5)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: colorScheme.outline.withOpacity(0.3)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: colorScheme.primary, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: colorScheme.error, width: 2),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      hintStyle: TextStyle(
        color: colorScheme.onSurface.withOpacity(0.6),
        fontWeight: FontWeight.w400,
      ),
    );
  }
  
  // 获取渐变装饰
  static BoxDecoration getGradientDecoration(List<Color> colors, {double borderRadius = 16}) {
    return BoxDecoration(
      borderRadius: BorderRadius.circular(borderRadius),
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: colors,
      ),
      boxShadow: [
        BoxShadow(
          color: colors.first.withOpacity(0.3),
          blurRadius: 12,
          offset: const Offset(0, 6),
        ),
      ],
    );
  }
  
  // 获取玻璃效果装饰
  static BoxDecoration getGlassDecoration(ColorScheme colorScheme, {double borderRadius = 16}) {
    return BoxDecoration(
      borderRadius: BorderRadius.circular(borderRadius),
      color: colorScheme.surface.withOpacity(0.7),
      border: Border.all(
        color: colorScheme.outline.withOpacity(0.2),
        width: 1,
      ),
      boxShadow: [
        BoxShadow(
          color: colorScheme.shadow.withOpacity(0.1),
          blurRadius: 20,
          offset: const Offset(0, 8),
        ),
      ],
    );
  }
}

/// 扩展的Material按钮样式
class EnhancedButtonStyles {
  // 主要按钮样式
  static ButtonStyle primary(ColorScheme colorScheme) {
    return ElevatedButton.styleFrom(
      backgroundColor: colorScheme.primary,
      foregroundColor: colorScheme.onPrimary,
      elevation: 0,
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    );
  }
  
  // 成功按钮样式
  static ButtonStyle success(ColorScheme colorScheme) {
    return ElevatedButton.styleFrom(
      backgroundColor: EnhancedTheme.successColor,
      foregroundColor: Colors.white,
      elevation: 0,
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    );
  }
  
  // 警告按钮样式
  static ButtonStyle warning(ColorScheme colorScheme) {
    return ElevatedButton.styleFrom(
      backgroundColor: EnhancedTheme.warningColor,
      foregroundColor: Colors.white,
      elevation: 0,
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    );
  }
  
  // 危险按钮样式
  static ButtonStyle danger(ColorScheme colorScheme) {
    return ElevatedButton.styleFrom(
      backgroundColor: EnhancedTheme.errorColor,
      foregroundColor: Colors.white,
      elevation: 0,
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    );
  }
  
  // 渐变按钮样式
  static ButtonStyle gradient(List<Color> colors) {
    return ElevatedButton.styleFrom(
      backgroundColor: Colors.transparent,
      shadowColor: Colors.transparent,
      elevation: 0,
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    );
  }
}