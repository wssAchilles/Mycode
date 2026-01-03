import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// 全局设计系统配置
/// 风格：Academic Tech Dark (学术科技深色模式)
class AppTheme {
  // 私有构造函数，防止实例化
  AppTheme._();

  // ---------------------------------------------------------------------------
  // 1. Color Palette (色板)
  // ---------------------------------------------------------------------------
  
  static const Color background = Color(0xFF0F172A); // Slate 900 - 深空蓝灰
  static const Color surface = Color(0xFF1E293B);    // Slate 800 - 卡片背景
  static const Color surfaceHighlight = Color(0xFF334155); // Slate 700 - 高亮背景

  // Primary: 科技青 - 用于高亮、按钮、关键数据
  static const Color primary = Color(0xFF00F5FF); 
  static const Color primaryDark = Color(0xFF00B8C0); 

  // Secondary: AI 紫 - 用于 ML 相关、渐变
  static const Color secondary = Color(0xFF7B61FF);
  
  // Accent: 成功/运行中
  static const Color accent = Color(0xFF00FF94);
  
  // Success: 成功状态 (与 accent 相同)
  static const Color success = Color(0xFF00FF94);

  // Semantic Colors
  static const Color error = Color(0xFFFF4D4D);
  static const Color warning = Color(0xFFFFC107);
  static const Color info = Color(0xFF2196F3);

  // Text Colors
  static const Color textPrimary = Color(0xFFF8FAFC); // Slate 50 - 主要文字
  static const Color textSecondary = Color(0xFF94A3B8); // Slate 400 - 次要文字
  static const Color textLog = Color(0xFF38BDF8); // Sky 400 - 日志/代码文字

  // Glassmorphism Colors (with opacity)
  static final Color glassBackground = const Color(0xFF1E293B).withOpacity(0.6);
  static const Color glassBorder = Color(0x1AF8FAFC); // 0.1 opacity = 0x1A
  static final Color glassHighlight = const Color(0xFFF8FAFC).withOpacity(0.05);

  // Font Family Names (字体名称常量)
  static const String codeFont = 'Fira Code';
  static const String bodyFont = 'Atkinson Hyperlegible';

  // ---------------------------------------------------------------------------
  // 2. Typography (排版)
  // ---------------------------------------------------------------------------

  static TextTheme get _textTheme {
    // 优先使用 Atkinson Hyperlegible，如果被墙则回退到 Roboto
    return GoogleFonts.atkinsonHyperlegibleTextTheme().copyWith(
      displayLarge: GoogleFonts.exo2(
        fontSize: 32,
        fontWeight: FontWeight.bold,
        color: textPrimary,
        letterSpacing: 1.2,
      ),
      displayMedium: GoogleFonts.exo2(
        fontSize: 24,
        fontWeight: FontWeight.bold,
        color: textPrimary,
        letterSpacing: 1.0,
      ),
      displaySmall: GoogleFonts.exo2(
        fontSize: 20,
        fontWeight: FontWeight.w600,
        color: textPrimary,
      ),
      headlineMedium: GoogleFonts.atkinsonHyperlegible(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: textPrimary,
      ),
      bodyLarge: GoogleFonts.atkinsonHyperlegible(
        fontSize: 16,
        color: textPrimary,
        height: 1.5,
      ),
      bodyMedium: GoogleFonts.atkinsonHyperlegible(
        fontSize: 14,
        color: textSecondary,
        height: 1.5,
      ),
      labelLarge: GoogleFonts.atkinsonHyperlegible(
        fontSize: 14,
        fontWeight: FontWeight.bold,
        color: textPrimary,
      ),
      // 代码/日志字体
      bodySmall: GoogleFonts.firaCode(
        fontSize: 12,
        color: textLog,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // 3. ThemeData (主题配置)
  // ---------------------------------------------------------------------------

  static ThemeData get darkTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: background,
      primaryColor: primary,
      
      // 字体配置
      textTheme: _textTheme,
      
      // AppBar 配置
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent, // 透明背景，配合 Glass 效果
        elevation: 0,
        centerTitle: true,
        titleTextStyle: GoogleFonts.exo2(
          fontSize: 20,
          fontWeight: FontWeight.bold,
          color: textPrimary,
          letterSpacing: 1.0,
        ),
        iconTheme: const IconThemeData(color: primary),
      ),

      // Card 配置 (默认样式，会被 GlassCard 替代，但作为兜底)
      cardTheme: CardThemeData(
        color: surface,
        elevation: 4,
        shadowColor: Colors.black.withOpacity(0.3),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: glassBorder, width: 1),
        ),
      ),

      // Button 配置
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: background,
          elevation: 0,
          textStyle: GoogleFonts.exo2(fontWeight: FontWeight.bold),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ).copyWith(
          // 添加发光阴影
          shadowColor: MaterialStateProperty.all(primary.withOpacity(0.5)),
          elevation: MaterialStateProperty.resolveWith((states) {
             if (states.contains(MaterialState.hovered)) return 8;
             return 0;
          }),
        ),
      ),

      iconTheme: const IconThemeData(
        color: primary,
        size: 24,
      ),
      
      // Input 配置
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface.withOpacity(0.5),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: glassBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: glassBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: primary, width: 2),
        ),
        labelStyle: const TextStyle(color: textSecondary),
        prefixIconColor: primary,
      ),

      colorScheme: const ColorScheme.dark(
        primary: primary,
        secondary: secondary,
        surface: surface,
        background: background,
        error: error,
      ),
    );
  }
}
