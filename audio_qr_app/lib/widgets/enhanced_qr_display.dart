import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../models/qr_style.dart' as qr_model;

class EnhancedQRDisplay extends StatefulWidget {
  final String data;
  final GlobalKey repaintKey;
  final VoidCallback? onSave;
  final VoidCallback? onShare;
  final qr_model.QRStyle? qrStyle;
  
  const EnhancedQRDisplay({
    super.key,
    required this.data,
    required this.repaintKey,
    this.onSave,
    this.onShare,
    this.qrStyle,
  });
  
  @override
  State<EnhancedQRDisplay> createState() => _EnhancedQRDisplayState();
}

class _EnhancedQRDisplayState extends State<EnhancedQRDisplay>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 800),
      vsync: this,
    );
    
    _scaleAnimation = Tween<double>(
      begin: 0.0,
      end: 1.0,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.elasticOut,
    ));
    
    _controller.forward();
  }
  
  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final style = widget.qrStyle ?? qr_model.QRStyle.classic;
    
    return Column(
      children: [
        // QR码显示区域
        AnimatedBuilder(
          animation: _scaleAnimation,
          builder: (context, child) {
            return Transform.scale(
              scale: _scaleAnimation.value,
              child: Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: style.backgroundColor,
                  borderRadius: BorderRadius.circular(style.borderRadius),
                  border: style.hasBorder
                      ? Border.all(
                          color: style.borderColor ?? Colors.grey,
                          width: style.borderWidth,
                        )
                      : null,
                  boxShadow: [
                    BoxShadow(
                      color: theme.colorScheme.primary.withOpacity(0.1),
                      blurRadius: 30,
                      offset: const Offset(0, 10),
                      spreadRadius: 0,
                    ),
                  ],
                ),
                child: RepaintBoundary(
                  key: widget.repaintKey,
                  child: _buildQRCode(style),
                ),
              ),
            );
          },
        ),
        
        const SizedBox(height: 24),
        
        // 操作按钮
        _buildActionButtons(),
        
        const SizedBox(height: 16),
        
        // 分享提示
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            children: [
              Row(
                children: [
                  Icon(
                    PhosphorIcons.lightbulb(),
                    size: 20,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '使用提示',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: theme.colorScheme.primary,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                '• 使用任何二维码扫描器扫描即可下载音频文件\n• 建议在光线充足的环境下扫描\n• 可将二维码保存到相册或直接分享给朋友',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
  
  Widget _buildQRCode(qr_model.QRStyle style) {
    Widget qrWidget = QrImageView(
      data: widget.data,
      version: QrVersions.auto,
      size: 240,
      backgroundColor: style.backgroundColor,
      foregroundColor: style.hasGradient && style.gradientColors != null
          ? style.gradientColors!.first
          : style.foregroundColor,
      eyeStyle: QrEyeStyle(
        eyeShape: _getQrEyeShape(style.eyeShape),
        color: style.eyeColor ?? style.foregroundColor,
      ),
      dataModuleStyle: QrDataModuleStyle(
        dataModuleShape: _getQrDataModuleShape(style.shapeType),
        color: style.foregroundColor,
      ),
      gapless: false,
      errorCorrectionLevel: QrErrorCorrectLevel.M,
    );
    
    // 如果有LOGO，添加中心图标
    if (style.hasLogo) {
      return Stack(
        alignment: Alignment.center,
        children: [
          qrWidget,
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.1),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Icon(
              PhosphorIcons.musicNote(),
              size: 28,
              color: Theme.of(context).colorScheme.primary,
            ),
          ),
        ],
      );
    }
    
    return qrWidget;
  }
  
  QrEyeShape _getQrEyeShape(qr_model.QREyeShape eyeShape) {
    switch (eyeShape) {
      case qr_model.QREyeShape.square:
        return QrEyeShape.square;
      case qr_model.QREyeShape.circle:
        return QrEyeShape.circle;
      case qr_model.QREyeShape.roundedSquare:
        return QrEyeShape.square;
    }
  }

  QrDataModuleShape _getQrDataModuleShape(qr_model.QRShapeType shapeType) {
    switch (shapeType) {
      case qr_model.QRShapeType.square:
        return QrDataModuleShape.square;
      case qr_model.QRShapeType.circle:
        return QrDataModuleShape.circle;
      case qr_model.QRShapeType.roundedSquare:
        return QrDataModuleShape.square;
    }
  }
  
  Widget _buildActionButtons() {
    return Row(
      children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: widget.onSave,
            icon: Icon(PhosphorIcons.downloadSimple()),
            label: const Text('保存到相册'),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 12),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: ElevatedButton.icon(
            onPressed: widget.onShare,
            icon: Icon(PhosphorIcons.share()),
            label: const Text('分享二维码'),
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 12),
            ),
          ),
        ),
      ],
    );
  }
}