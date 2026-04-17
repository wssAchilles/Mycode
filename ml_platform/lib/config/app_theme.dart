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

  // Chart/Data Palette (统一数据可视化色板)
  static const List<Color> chartPalette = [
    primary,
    secondary,
    success,
    warning,
    info,
    accent,
  ];

  // Glassmorphism Colors (with opacity)
  static final Color glassBackground = const Color(0xFF1E293B).withOpacity(0.6);
  static const Color glassBorder = Color(0x1AF8FAFC); // 0.1 opacity = 0x1A
  static final Color glassHighlight = const Color(0xFFF8FAFC).withOpacity(0.05);
  static const Color borderSubtle = Color(0x1A94A3B8); // Slate 400 @ 10%
  static const Color borderStrong = Color(0x3394A3B8); // Slate 400 @ 20%

  // Font Family Names (字体名称常量)
  static const String codeFont = 'Fira Code';
  static const String bodyFont = 'DM Sans';

  // ---------------------------------------------------------------------------
  // 2. Typography (排版)
  // ---------------------------------------------------------------------------

  static TextTheme get _textTheme {
    return GoogleFonts.dmSansTextTheme().copyWith(
      displayLarge: GoogleFonts.spaceGrotesk(
        fontSize: 32,
        fontWeight: FontWeight.w700,
        color: textPrimary,
        letterSpacing: 0.6,
      ),
      displayMedium: GoogleFonts.spaceGrotesk(
        fontSize: 24,
        fontWeight: FontWeight.w700,
        color: textPrimary,
        letterSpacing: 0.4,
      ),
      displaySmall: GoogleFonts.spaceGrotesk(
        fontSize: 20,
        fontWeight: FontWeight.w600,
        color: textPrimary,
      ),
      headlineMedium: GoogleFonts.spaceGrotesk(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: textPrimary,
      ),
      bodyLarge: GoogleFonts.dmSans(
        fontSize: 16,
        color: textPrimary,
        height: 1.5,
      ),
      bodyMedium: GoogleFonts.dmSans(
        fontSize: 14,
        color: textSecondary,
        height: 1.5,
      ),
      labelLarge: GoogleFonts.dmSans(
        fontSize: 14,
        fontWeight: FontWeight.w700,
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
        titleTextStyle: GoogleFonts.spaceGrotesk(
          fontSize: 20,
          fontWeight: FontWeight.w700,
          color: textPrimary,
          letterSpacing: 0.4,
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
          textStyle: GoogleFonts.spaceGrotesk(fontWeight: FontWeight.w700),
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
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          foregroundColor: primary,
          minimumSize: const Size(44, 44),
          padding: const EdgeInsets.all(10),
        ),
      ),

      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: primary,
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w600),
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: textPrimary,
          side: const BorderSide(color: borderStrong),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
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
        floatingLabelStyle: const TextStyle(color: primary),
        helperStyle: const TextStyle(color: textSecondary),
        errorStyle: const TextStyle(color: error),
        prefixIconColor: primary,
      ),

      dividerTheme: const DividerThemeData(
        color: glassBorder,
        thickness: 1,
        space: 1,
      ),

      listTileTheme: ListTileThemeData(
        iconColor: primary,
        textColor: textPrimary,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      ),

      snackBarTheme: SnackBarThemeData(
        backgroundColor: surface,
        contentTextStyle: const TextStyle(color: textPrimary),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),

      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: surface.withOpacity(0.95),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: glassBorder),
        ),
        textStyle: const TextStyle(color: textPrimary, fontSize: 12),
      ),

      dialogTheme: DialogThemeData(
        backgroundColor: surface,
        titleTextStyle: _textTheme.titleLarge?.copyWith(color: textPrimary),
        contentTextStyle: _textTheme.bodyMedium?.copyWith(color: textSecondary),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),

      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: surface.withOpacity(0.9),
        indicatorColor: primary.withOpacity(0.15),
        labelTextStyle: MaterialStateProperty.all(
          GoogleFonts.dmSans(fontSize: 12, fontWeight: FontWeight.w600),
        ),
        iconTheme: MaterialStateProperty.resolveWith((states) {
          if (states.contains(MaterialState.selected)) {
            return const IconThemeData(color: primary);
          }
          return const IconThemeData(color: textSecondary);
        }),
      ),

      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: surface,
        indicatorColor: primary.withOpacity(0.15),
        selectedIconTheme: const IconThemeData(color: primary),
        unselectedIconTheme: const IconThemeData(color: textSecondary),
        selectedLabelTextStyle: const TextStyle(color: textPrimary),
        unselectedLabelTextStyle: const TextStyle(color: textSecondary),
      ),

      chipTheme: ChipThemeData(
        backgroundColor: surface,
        selectedColor: primary.withOpacity(0.2),
        disabledColor: surface.withOpacity(0.4),
        labelStyle: const TextStyle(color: textPrimary),
        secondaryLabelStyle: const TextStyle(color: textPrimary),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        side: const BorderSide(color: glassBorder),
      ),

      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
          side: MaterialStateProperty.all(const BorderSide(color: glassBorder)),
          backgroundColor: MaterialStateProperty.resolveWith((states) {
            if (states.contains(MaterialState.selected)) {
              return primary.withOpacity(0.15);
            }
            return Colors.transparent;
          }),
          foregroundColor: MaterialStateProperty.resolveWith((states) {
            if (states.contains(MaterialState.selected)) return primary;
            return textSecondary;
          }),
        ),
      ),

      scrollbarTheme: ScrollbarThemeData(
        thumbColor: MaterialStateProperty.all(primary.withOpacity(0.35)),
        radius: const Radius.circular(12),
        thickness: MaterialStateProperty.all(6),
      ),

      colorScheme: const ColorScheme.dark(
        primary: primary,
        onPrimary: background,
        secondary: secondary,
        onSecondary: textPrimary,
        tertiary: accent,
        onTertiary: background,
        surface: surface,
        onSurface: textPrimary,
        surfaceVariant: surfaceHighlight,
        onSurfaceVariant: textSecondary,
        background: background,
        onBackground: textPrimary,
        error: error,
        onError: Colors.white,
        outline: borderStrong,
      ),
    );
  }
}

/// 通用间距
class AppSpacing {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
  static const double xxl = 48;
}

/// 通用圆角
class AppRadii {
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
}

/// 常用阴影
class AppShadows {
  static const List<BoxShadow> soft = [
    BoxShadow(
      color: Color(0x33000000),
      blurRadius: 12,
      offset: Offset(0, 6),
    ),
  ];
}
