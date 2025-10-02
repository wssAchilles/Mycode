import 'package:flutter/material.dart';

/// QR码样式配置
class QRStyle {
  final Color backgroundColor;
  final Color foregroundColor;
  final double dotScale;
  final QRShapeType shapeType;
  final bool hasLogo;
  final Color? eyeColor;
  final QREyeShape eyeShape;
  final double borderRadius;
  final bool hasGradient;
  final List<Color>? gradientColors;
  final bool hasBorder;
  final Color? borderColor;
  final double borderWidth;
  
  // 新增样式选项
  final QRTemplate template;
  final bool hasBackgroundPattern;
  final QRBackgroundPattern backgroundPattern;
  final List<Color>? patternColors;
  final bool hasFrame;
  final QRFrameStyle frameStyle;
  final Color? frameColor;
  final bool hasShadow;
  final Color shadowColor;
  final double shadowBlur;
  final Offset shadowOffset;
  final bool hasCornerDots;
  final QRCornerDotStyle cornerDotStyle;
  final Color? cornerDotColor;
  
  const QRStyle({
    this.backgroundColor = Colors.white,
    this.foregroundColor = Colors.black,
    this.dotScale = 1.0,
    this.shapeType = QRShapeType.square,
    this.hasLogo = false,
    this.eyeColor,
    this.eyeShape = QREyeShape.square,
    this.borderRadius = 0,
    this.hasGradient = false,
    this.gradientColors,
    this.hasBorder = false,
    this.borderColor,
    this.borderWidth = 2.0,
    // 新增参数
    this.template = QRTemplate.classic,
    this.hasBackgroundPattern = false,
    this.backgroundPattern = QRBackgroundPattern.none,
    this.patternColors,
    this.hasFrame = false,
    this.frameStyle = QRFrameStyle.none,
    this.frameColor,
    this.hasShadow = false,
    this.shadowColor = Colors.black26,
    this.shadowBlur = 4.0,
    this.shadowOffset = const Offset(0, 2),
    this.hasCornerDots = false,
    this.cornerDotStyle = QRCornerDotStyle.none,
    this.cornerDotColor,
  });
  
  QRStyle copyWith({
    Color? backgroundColor,
    Color? foregroundColor,
    double? dotScale,
    QRShapeType? shapeType,
    bool? hasLogo,
    Color? eyeColor,
    QREyeShape? eyeShape,
    double? borderRadius,
    bool? hasGradient,
    List<Color>? gradientColors,
    bool? hasBorder,
    Color? borderColor,
    double? borderWidth,
    QRTemplate? template,
    bool? hasBackgroundPattern,
    QRBackgroundPattern? backgroundPattern,
    List<Color>? patternColors,
    bool? hasFrame,
    QRFrameStyle? frameStyle,
    Color? frameColor,
    bool? hasShadow,
    Color? shadowColor,
    double? shadowBlur,
    Offset? shadowOffset,
    bool? hasCornerDots,
    QRCornerDotStyle? cornerDotStyle,
    Color? cornerDotColor,
  }) {
    return QRStyle(
      backgroundColor: backgroundColor ?? this.backgroundColor,
      foregroundColor: foregroundColor ?? this.foregroundColor,
      dotScale: dotScale ?? this.dotScale,
      shapeType: shapeType ?? this.shapeType,
      hasLogo: hasLogo ?? this.hasLogo,
      eyeColor: eyeColor ?? this.eyeColor,
      eyeShape: eyeShape ?? this.eyeShape,
      borderRadius: borderRadius ?? this.borderRadius,
      hasGradient: hasGradient ?? this.hasGradient,
      gradientColors: gradientColors ?? this.gradientColors,
      hasBorder: hasBorder ?? this.hasBorder,
      borderColor: borderColor ?? this.borderColor,
      borderWidth: borderWidth ?? this.borderWidth,
      template: template ?? this.template,
      hasBackgroundPattern: hasBackgroundPattern ?? this.hasBackgroundPattern,
      backgroundPattern: backgroundPattern ?? this.backgroundPattern,
      patternColors: patternColors ?? this.patternColors,
      hasFrame: hasFrame ?? this.hasFrame,
      frameStyle: frameStyle ?? this.frameStyle,
      frameColor: frameColor ?? this.frameColor,
      hasShadow: hasShadow ?? this.hasShadow,
      shadowColor: shadowColor ?? this.shadowColor,
      shadowBlur: shadowBlur ?? this.shadowBlur,
      shadowOffset: shadowOffset ?? this.shadowOffset,
      hasCornerDots: hasCornerDots ?? this.hasCornerDots,
      cornerDotStyle: cornerDotStyle ?? this.cornerDotStyle,
      cornerDotColor: cornerDotColor ?? this.cornerDotColor,
    );
  }
  
  /// 预设样式模板
  static const QRStyle classic = QRStyle(
    template: QRTemplate.classic,
  );
  
  static const QRStyle modern = QRStyle(
    template: QRTemplate.modern,
    backgroundColor: Color(0xFFF8F9FA),
    foregroundColor: Color(0xFF1A1A1A),
    dotScale: 0.9,
    borderRadius: 4,
    hasBorder: true,
    borderColor: Color(0xFFE9ECEF),
    borderWidth: 1.0,
    hasShadow: true,
    shadowColor: Color(0x1A000000),
    shadowBlur: 8.0,
    shadowOffset: Offset(0, 4),
  );
  
  static const QRStyle colorful = QRStyle(
    template: QRTemplate.colorful,
    backgroundColor: Colors.white,
    hasGradient: true,
    gradientColors: [Color(0xFF667EEA), Color(0xFF764BA2)],
    dotScale: 0.95,
    borderRadius: 8,
    eyeColor: Color(0xFF667EEA),
    eyeShape: QREyeShape.circle,
    hasFrame: true,
    frameStyle: QRFrameStyle.rounded,
    frameColor: Color(0xFF667EEA),
  );
  
  static const QRStyle minimal = QRStyle(
    template: QRTemplate.minimal,
    backgroundColor: Colors.transparent,
    foregroundColor: Color(0xFF2D3748),
    dotScale: 0.8,
    shapeType: QRShapeType.circle,
    borderRadius: 12,
  );
  
  static const QRStyle neon = QRStyle(
    template: QRTemplate.neon,
    backgroundColor: Color(0xFF0A0A0A),
    foregroundColor: Color(0xFF00FF88),
    dotScale: 0.9,
    shapeType: QRShapeType.circle,
    eyeColor: Color(0xFF00FFFF),
    eyeShape: QREyeShape.circle,
    hasBorder: true,
    borderColor: Color(0xFF00FF88),
    borderWidth: 2.0,
    hasShadow: true,
    shadowColor: Color(0x8800FF88),
    shadowBlur: 12.0,
  );
  
  static const QRStyle cute = QRStyle(
    template: QRTemplate.cute,
    backgroundColor: Color(0xFFFFF0F5),
    foregroundColor: Color(0xFFFF69B4),
    dotScale: 0.85,
    shapeType: QRShapeType.circle,
    eyeColor: Color(0xFFFF1493),
    eyeShape: QREyeShape.circle,
    hasBackgroundPattern: true,
    backgroundPattern: QRBackgroundPattern.hearts,
    patternColors: [Color(0xFFFFB6C1), Color(0xFFFF69B4)],
    hasCornerDots: true,
    cornerDotStyle: QRCornerDotStyle.hearts,
    cornerDotColor: Color(0xFFFF1493),
    borderRadius: 16,
  );
  
  static const QRStyle business = QRStyle(
    template: QRTemplate.business,
    backgroundColor: Color(0xFF1E293B),
    foregroundColor: Color(0xFFE2E8F0),
    dotScale: 0.9,
    shapeType: QRShapeType.roundedSquare,
    eyeColor: Color(0xFF3B82F6),
    eyeShape: QREyeShape.roundedSquare,
    hasFrame: true,
    frameStyle: QRFrameStyle.card,
    frameColor: Color(0xFF475569),
    hasShadow: true,
    shadowColor: Color(0x40000000),
    shadowBlur: 16.0,
    shadowOffset: Offset(0, 8),
  );
  
  static const QRStyle artistic = QRStyle(
    template: QRTemplate.artistic,
    backgroundColor: Color(0xFFFFF8DC),
    hasGradient: true,
    gradientColors: [Color(0xFFFF6B35), Color(0xFFFF8E53), Color(0xFFFF6B9D)],
    dotScale: 0.8,
    shapeType: QRShapeType.circle,
    eyeColor: Color(0xFF8B0000),
    eyeShape: QREyeShape.circle,
    hasBackgroundPattern: true,
    backgroundPattern: QRBackgroundPattern.geometric,
    patternColors: [Color(0xFFFFA07A), Color(0xFFFF69B4)],
    borderRadius: 20,
    hasShadow: true,
  );
  
  static const QRStyle festival = QRStyle(
    template: QRTemplate.festival,
    backgroundColor: Color(0xFFFFF9C4),
    hasGradient: true,
    gradientColors: [Color(0xFFFF9800), Color(0xFFFF5722), Color(0xFFE91E63)],
    dotScale: 0.9,
    shapeType: QRShapeType.circle,
    eyeColor: Color(0xFFD32F2F),
    eyeShape: QREyeShape.circle,
    hasBackgroundPattern: true,
    backgroundPattern: QRBackgroundPattern.stars,
    patternColors: [Color(0xFFFFEB3B), Color(0xFFFF9800)],
    hasFrame: true,
    frameStyle: QRFrameStyle.decorative,
    frameColor: Color(0xFFFF5722),
    hasCornerDots: true,
    cornerDotStyle: QRCornerDotStyle.stars,
    cornerDotColor: Color(0xFFFFD700),
  );
  
  static const QRStyle nature = QRStyle(
    template: QRTemplate.nature,
    backgroundColor: Color(0xFFF1F8E9),
    foregroundColor: Color(0xFF2E7D32),
    dotScale: 0.85,
    shapeType: QRShapeType.circle,
    eyeColor: Color(0xFF388E3C),
    eyeShape: QREyeShape.circle,
    hasBackgroundPattern: true,
    backgroundPattern: QRBackgroundPattern.flowers,
    patternColors: [Color(0xFF81C784), Color(0xFF4CAF50)],
    borderRadius: 12,
    hasFrame: true,
    frameStyle: QRFrameStyle.rounded,
    frameColor: Color(0xFF4CAF50),
  );
  
  static const QRStyle tech = QRStyle(
    template: QRTemplate.tech,
    backgroundColor: Color(0xFF0D1117),
    hasGradient: true,
    gradientColors: [Color(0xFF00D4AA), Color(0xFF00A8FF)],
    dotScale: 0.9,
    shapeType: QRShapeType.square,
    eyeColor: Color(0xFF00D4AA),
    eyeShape: QREyeShape.square,
    hasBackgroundPattern: true,
    backgroundPattern: QRBackgroundPattern.grid,
    patternColors: [Color(0xFF1A1A1A), Color(0xFF00D4AA)],
    hasBorder: true,
    borderColor: Color(0xFF00D4AA),
    borderWidth: 2.0,
    hasShadow: true,
    shadowColor: Color(0x6600D4AA),
    shadowBlur: 16.0,
  );
  
  static const QRStyle retro = QRStyle(
    template: QRTemplate.retro,
    backgroundColor: Color(0xFFFFF3E0),
    foregroundColor: Color(0xFFBF360C),
    dotScale: 0.9,
    shapeType: QRShapeType.roundedSquare,
    eyeColor: Color(0xFFFF5722),
    eyeShape: QREyeShape.roundedSquare,
    hasBackgroundPattern: true,
    backgroundPattern: QRBackgroundPattern.lines,
    patternColors: [Color(0xFFFFCC02), Color(0xFFFF5722)],
    hasFrame: true,
    frameStyle: QRFrameStyle.stamp,
    frameColor: Color(0xFFD84315),
    borderRadius: 8,
  );
  
  /// 获取所有预设样式
  static List<QRStyle> get presetStyles => [
    classic,
    modern,
    colorful,
    minimal,
    neon,
    cute,
    business,
    artistic,
    festival,
    nature,
    tech,
    retro,
  ];
  
  /// 获取样式名称
  String get name {
    switch (template) {
      case QRTemplate.classic: return '经典';
      case QRTemplate.modern: return '现代';
      case QRTemplate.colorful: return '彩色';
      case QRTemplate.minimal: return '极简';
      case QRTemplate.neon: return '霓虹';
      case QRTemplate.cute: return '可爱';
      case QRTemplate.business: return '商务';
      case QRTemplate.artistic: return '艺术';
      case QRTemplate.festival: return '节日';
      case QRTemplate.nature: return '自然';
      case QRTemplate.tech: return '科技';
      case QRTemplate.retro: return '复古';
    }
  }
  
  /// 获取样式描述
  String get description {
    switch (template) {
      case QRTemplate.classic: return '简洁经典的黑白样式';
      case QRTemplate.modern: return '现代简约的灰色调';
      case QRTemplate.colorful: return '彩色渐变的活泼样式';
      case QRTemplate.minimal: return '极简透明的清爽样式';
      case QRTemplate.neon: return '霓虹发光的酷炫样式';
      case QRTemplate.cute: return '粉色爱心的可爱样式';
      case QRTemplate.business: return '专业商务的深色样式';
      case QRTemplate.artistic: return '艺术渐变的创意样式';
      case QRTemplate.festival: return '节日彩色的欢乐样式';
      case QRTemplate.nature: return '绿色花卉的自然样式';
      case QRTemplate.tech: return '科技蓝绿的未来样式';
      case QRTemplate.retro: return '复古橙色的怀旧样式';
    }
  }
  
  /// 转换为Map
  Map<String, dynamic> toMap() {
    return {
      'backgroundColor': backgroundColor.toARGB32(),
      'foregroundColor': foregroundColor.toARGB32(),
      'dotScale': dotScale,
      'shapeType': shapeType.index,
      'hasLogo': hasLogo,
      'eyeColor': eyeColor?.toARGB32(),
      'eyeShape': eyeShape.index,
      'borderRadius': borderRadius,
      'hasGradient': hasGradient,
      'gradientColors': gradientColors?.map((c) => c.toARGB32()).toList(),
      'hasBorder': hasBorder,
      'borderColor': borderColor?.toARGB32(),
      'borderWidth': borderWidth,
      'template': template.index,
      'hasBackgroundPattern': hasBackgroundPattern,
      'backgroundPattern': backgroundPattern.index,
      'patternColors': patternColors?.map((c) => c.toARGB32()).toList(),
      'hasFrame': hasFrame,
      'frameStyle': frameStyle.index,
      'frameColor': frameColor?.toARGB32(),
      'hasShadow': hasShadow,
      'shadowColor': shadowColor.toARGB32(),
      'shadowBlur': shadowBlur,
      'shadowOffsetDx': shadowOffset.dx,
      'shadowOffsetDy': shadowOffset.dy,
      'hasCornerDots': hasCornerDots,
      'cornerDotStyle': cornerDotStyle.index,
      'cornerDotColor': cornerDotColor?.toARGB32(),
    };
  }
  
  /// 从Map创建
  factory QRStyle.fromMap(Map<String, dynamic> map) {
    return QRStyle(
      backgroundColor: Color(map['backgroundColor'] ?? Colors.white.toARGB32()),
      foregroundColor: Color(map['foregroundColor'] ?? Colors.black.toARGB32()),
      dotScale: map['dotScale'] ?? 1.0,
      shapeType: QRShapeType.values[map['shapeType'] ?? 0],
      hasLogo: map['hasLogo'] ?? false,
      eyeColor: map['eyeColor'] != null ? Color(map['eyeColor']) : null,
      eyeShape: QREyeShape.values[map['eyeShape'] ?? 0],
      borderRadius: map['borderRadius'] ?? 0.0,
      hasGradient: map['hasGradient'] ?? false,
      gradientColors: map['gradientColors'] != null
          ? (map['gradientColors'] as List).map((c) => Color(c)).toList()
          : null,
      hasBorder: map['hasBorder'] ?? false,
      borderColor: map['borderColor'] != null ? Color(map['borderColor']) : null,
      borderWidth: map['borderWidth'] ?? 2.0,
      template: QRTemplate.values[map['template'] ?? 0],
      hasBackgroundPattern: map['hasBackgroundPattern'] ?? false,
      backgroundPattern: QRBackgroundPattern.values[map['backgroundPattern'] ?? 0],
      patternColors: map['patternColors'] != null
          ? (map['patternColors'] as List).map((c) => Color(c)).toList()
          : null,
      hasFrame: map['hasFrame'] ?? false,
      frameStyle: QRFrameStyle.values[map['frameStyle'] ?? 0],
      frameColor: map['frameColor'] != null ? Color(map['frameColor']) : null,
      hasShadow: map['hasShadow'] ?? false,
      shadowColor: Color(map['shadowColor'] ?? Colors.black26.toARGB32()),
      shadowBlur: map['shadowBlur'] ?? 4.0,
      shadowOffset: Offset(
        map['shadowOffsetDx'] ?? 0.0,
        map['shadowOffsetDy'] ?? 2.0,
      ),
      hasCornerDots: map['hasCornerDots'] ?? false,
      cornerDotStyle: QRCornerDotStyle.values[map['cornerDotStyle'] ?? 0],
      cornerDotColor: map['cornerDotColor'] != null ? Color(map['cornerDotColor']) : null,
    );
  }
}

/// QR码形状类型
enum QRShapeType {
  square,
  circle,
  roundedSquare,
}

/// QR码眼部形状
enum QREyeShape {
  square,
  circle,
  roundedSquare,
}

/// QR码模板类型
enum QRTemplate {
  classic,
  modern,
  colorful,
  minimal,
  neon,
  cute,
  business,
  artistic,
  festival,
  nature,
  tech,
  retro,
}

/// 背景图案类型
enum QRBackgroundPattern {
  none,
  dots,
  lines,
  grid,
  waves,
  hearts,
  stars,
  flowers,
  geometric,
}

/// 边框样式
enum QRFrameStyle {
  none,
  simple,
  rounded,
  decorative,
  bubble,
  badge,
  stamp,
  card,
}

/// 角落装饰样式
enum QRCornerDotStyle {
  none,
  dots,
  stars,
  hearts,
  diamonds,
}