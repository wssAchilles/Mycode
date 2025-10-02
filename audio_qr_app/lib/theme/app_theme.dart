import 'package:flutter/material.dart';

class AppTheme {
  // 主题色定义 - 更现代的配色方案
  static const Color primaryColor = Color(0xFF4F46E5); // 深蓝紫色，更加专业
  static const Color secondaryColor = Color(0xFF7C3AED); // 活力紫色
  static const Color accentColor = Color(0xFF0891B2); // 清新青色
  
  // 扩展颜色 - 更柔和的色彩
  static const Color successColor = Color(0xFF059669); // 深绿色
  static const Color warningColor = Color(0xFFD97706); // 温暖橙色
  static const Color errorColor = Color(0xFFDC2626); // 柔和红色
  static const Color infoColor = Color(0xFF2563EB); // 明亮蓝色
  
  // 渐变色定义
  static const List<Color> primaryGradient = [
    Color(0xFF4F46E5),
    Color(0xFF7C3AED),
  ];
  
  static const List<Color> secondaryGradient = [
    Color(0xFF0891B2),
    Color(0xFF0284C7),
  ];
  
  static const List<Color> accentGradient = [
    Color(0xFFEC4899),
    Color(0xFFF43F5E),
  ];
  
  // 创建明亮主题
  static ThemeData get lightTheme {
    const ColorScheme lightColorScheme = ColorScheme(
      brightness: Brightness.light,
      primary: primaryColor,
      onPrimary: Colors.white,
      primaryContainer: Color(0xFFE0E7FF),
      onPrimaryContainer: Color(0xFF1E1B4B),
      secondary: secondaryColor,
      onSecondary: Colors.white,
      secondaryContainer: Color(0xFFEDE9FE),
      onSecondaryContainer: Color(0xFF2E1065),
      tertiary: accentColor,
      onTertiary: Colors.white,
      tertiaryContainer: Color(0xFFCFFAFE),
      onTertiaryContainer: Color(0xFF164E63),
      error: errorColor,
      onError: Colors.white,
      errorContainer: Color(0xFFFEE2E2),
      onErrorContainer: Color(0xFF991B1B),
      surface: Colors.white,
      onSurface: Color(0xFF1F2937),
      surfaceContainerHighest: Color(0xFFF9FAFB),
      onSurfaceVariant: Color(0xFF6B7280),
      outline: Color(0xFFD1D5DB),
      outlineVariant: Color(0xFFE5E7EB),
      shadow: Colors.black26,
      scrim: Colors.black54,
      inverseSurface: Color(0xFF111827),
      onInverseSurface: Color(0xFFF9FAFB),
      inversePrimary: Color(0xFF818CF8),
      surfaceTint: primaryColor,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: lightColorScheme,
      fontFamily: 'System',
      
      // 应用栏主题
      appBarTheme: const AppBarTheme(
        elevation: 0,
        centerTitle: true,
        backgroundColor: Colors.transparent,
        foregroundColor: Color(0xFF1F2937),
        titleTextStyle: TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: Color(0xFF1F2937),
        ),
      ),
      
      // 卡片主题
      cardTheme: CardThemeData(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: lightColorScheme.outline.withOpacity(0.2),
            width: 1,
          ),
        ),
        color: Colors.white,
      ),
      
      // 按钮主题
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          side: BorderSide(color: lightColorScheme.outline),
          textStyle: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      
      // 输入框主题
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Color(0xFFF9FAFB),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: lightColorScheme.outline),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: lightColorScheme.outline.withOpacity(0.5)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: lightColorScheme.primary, width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      ),
      
      // 列表瓦片主题
      listTileTheme: const ListTileThemeData(
        contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(12)),
        ),
      ),
      
      // 分割线主题
      dividerTheme: DividerThemeData(
        color: lightColorScheme.outline.withOpacity(0.2),
        thickness: 1,
        space: 1,
      ),
    );
  }
  
  // 创建暗黑主题
  static ThemeData get darkTheme {
    const ColorScheme darkColorScheme = ColorScheme(
      brightness: Brightness.dark,
      primary: Color(0xFF818CF8),
      onPrimary: Color(0xFF1E1B4B),
      primaryContainer: Color(0xFF312E81),
      onPrimaryContainer: Color(0xFFE0E7FF),
      secondary: Color(0xFFA78BFA),
      onSecondary: Color(0xFF2E1065),
      secondaryContainer: Color(0xFF553C9A),
      onSecondaryContainer: Color(0xFFEDE9FE),
      tertiary: Color(0xFF22D3EE),
      onTertiary: Color(0xFF164E63),
      tertiaryContainer: Color(0xFF0891B2),
      onTertiaryContainer: Color(0xFFCFFAFE),
      error: Color(0xFFFB7185),
      onError: Color(0xFF991B1B),
      errorContainer: Color(0xFFDC2626),
      onErrorContainer: Color(0xFFFEE2E2),
      surface: Color(0xFF111827),
      onSurface: Color(0xFFF9FAFB),
      surfaceContainerHighest: Color(0xFF1F2937),
      onSurfaceVariant: Color(0xFF9CA3AF),
      outline: Color(0xFF4B5563),
      outlineVariant: Color(0xFF374151),
      shadow: Colors.black54,
      scrim: Colors.black87,
      inverseSurface: Color(0xFFF9FAFB),
      onInverseSurface: Color(0xFF111827),
      inversePrimary: primaryColor,
      surfaceTint: Color(0xFF818CF8),
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: darkColorScheme,
      fontFamily: 'System',
      
      // 应用栏主题
      appBarTheme: const AppBarTheme(
        elevation: 0,
        centerTitle: true,
        backgroundColor: Colors.transparent,
        foregroundColor: Color(0xFFF9FAFB),
        titleTextStyle: TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: Color(0xFFF9FAFB),
        ),
      ),
      
      // 卡片主题
      cardTheme: CardThemeData(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: darkColorScheme.outline.withOpacity(0.3),
            width: 1,
          ),
        ),
        color: const Color(0xFF1F2937),
      ),
      
      // 按钮主题
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          side: BorderSide(color: darkColorScheme.outline),
          textStyle: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      
      // 输入框主题
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFF1F2937),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: darkColorScheme.outline),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: darkColorScheme.outline.withOpacity(0.5)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: darkColorScheme.primary, width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      ),
      
      // 列表瓦片主题
      listTileTheme: const ListTileThemeData(
        contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(12)),
        ),
      ),
      
      // 分割线主题
      dividerTheme: DividerThemeData(
        color: darkColorScheme.outline.withOpacity(0.3),
        thickness: 1,
        space: 1,
      ),
    );
  }
  
  // 主题扩展颜色
  static MaterialColor get successSwatch => const MaterialColor(0xFF10B981, {
    50: Color(0xFFECFDF5),
    100: Color(0xFFD1FAE5),
    200: Color(0xFFA7F3D0),
    300: Color(0xFF6EE7B7),
    400: Color(0xFF34D399),
    500: Color(0xFF10B981),
    600: Color(0xFF059669),
    700: Color(0xFF047857),
    800: Color(0xFF065F46),
    900: Color(0xFF064E3B),
  });
  
  static MaterialColor get warningSwatch => const MaterialColor(0xFFF59E0B, {
    50: Color(0xFFFFFBEB),
    100: Color(0xFFFEF3C7),
    200: Color(0xFFFDE68A),
    300: Color(0xFFFCD34D),
    400: Color(0xFFFBBF24),
    500: Color(0xFFF59E0B),
    600: Color(0xFFD97706),
    700: Color(0xFFB45309),
    800: Color(0xFF92400E),
    900: Color(0xFF78350F),
  });
}