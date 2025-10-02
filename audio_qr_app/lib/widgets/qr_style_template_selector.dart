import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../models/qr_style.dart';
import '../theme/enhanced_theme.dart';

/// QR样式模板选择器
class QRStyleTemplateSelector extends StatefulWidget {
  final String qrData;
  final QRStyle? selectedStyle;
  final Function(QRStyle) onStyleSelected;
  final VoidCallback? onCustomStyle;

  const QRStyleTemplateSelector({
    super.key,
    required this.qrData,
    this.selectedStyle,
    required this.onStyleSelected,
    this.onCustomStyle,
  });

  @override
  State<QRStyleTemplateSelector> createState() => _QRStyleTemplateSelectorState();
}

class _QRStyleTemplateSelectorState extends State<QRStyleTemplateSelector> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      appBar: AppBar(
        title: Text(
          '选择二维码样式',
          style: TextStyle(
            fontWeight: FontWeight.w600,
            color: EnhancedTheme.primaryColor,
          ),
        ),
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: Icon(PhosphorIcons.arrowLeft()),
          color: EnhancedTheme.primaryColor,
          onPressed: () => Navigator.of(context).pop(),
        ),
        actions: [
          if (widget.onCustomStyle != null)
            IconButton(
              icon: Icon(PhosphorIcons.palette()),
              color: EnhancedTheme.primaryColor,
              onPressed: widget.onCustomStyle,
              tooltip: '自定义样式',
            ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 提示文本
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    EnhancedTheme.primaryColor.withOpacity(0.1),
                    EnhancedTheme.accentColor.withOpacity(0.05),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: EnhancedTheme.primaryColor.withOpacity(0.2),
                ),
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: EnhancedTheme.primaryColor,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(
                      PhosphorIcons.palette(),
                      color: Colors.white,
                      size: 20,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '个性化二维码样式',
                          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w600,
                            color: EnhancedTheme.primaryColor,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '选择预设模板或自定义样式，让您的二维码更加独特',
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            
            const SizedBox(height: 24),
            
            // 样式模板网格
            Expanded(
              child: GridView.builder(
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 2,
                  childAspectRatio: 0.85,
                  crossAxisSpacing: 12,
                  mainAxisSpacing: 12,
                ),
                itemCount: QRStyle.presetStyles.length,
                itemBuilder: (context, index) {
                  final style = QRStyle.presetStyles[index];
                  final isSelected = widget.selectedStyle?.template == style.template;
                  
                  return _buildStyleCard(style, isSelected);
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStyleCard(QRStyle style, bool isSelected) {
    return GestureDetector(
      onTap: () {
        widget.onStyleSelected(style);
        Navigator.of(context).pop();
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        decoration: BoxDecoration(
          gradient: isSelected
              ? LinearGradient(
                  colors: [
                    EnhancedTheme.primaryColor.withOpacity(0.15),
                    EnhancedTheme.accentColor.withOpacity(0.08),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                )
              : LinearGradient(
                  colors: [
                    Colors.white,
                    Colors.grey.shade50,
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isSelected
                ? EnhancedTheme.primaryColor.withOpacity(0.5)
                : Colors.grey.withOpacity(0.2),
            width: isSelected ? 2.0 : 1.0,
          ),
          boxShadow: [
            BoxShadow(
              color: isSelected
                  ? EnhancedTheme.primaryColor.withOpacity(0.2)
                  : Colors.black.withOpacity(0.05),
              blurRadius: isSelected ? 12 : 8,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              // 二维码预览
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: style.backgroundColor,
                    borderRadius: BorderRadius.circular(12),
                    border: style.hasBorder
                        ? Border.all(
                            color: style.borderColor ?? Colors.grey,
                            width: style.borderWidth,
                          )
                        : null,
                    boxShadow: style.hasShadow
                        ? [
                            BoxShadow(
                              color: style.shadowColor,
                              blurRadius: style.shadowBlur,
                              offset: style.shadowOffset,
                            ),
                          ]
                        : null,
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: _buildQRPreview(style),
                  ),
                ),
              ),
              
              const SizedBox(height: 8),
              
              // 样式信息
              Column(
                children: [
                  Text(
                    style.name,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: isSelected
                          ? EnhancedTheme.primaryColor
                          : Theme.of(context).colorScheme.onSurface,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    style.description,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
              
              // 选中指示器
              if (isSelected)
                Container(
                  margin: const EdgeInsets.only(top: 8),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(
                    gradient: EnhancedTheme.primaryGradient.isNotEmpty
                        ? LinearGradient(colors: EnhancedTheme.primaryGradient)
                        : null,
                    color: EnhancedTheme.primaryGradient.isEmpty
                        ? EnhancedTheme.primaryColor
                        : null,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        PhosphorIcons.check(),
                        color: Colors.white,
                        size: 12,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '已选择',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Colors.white,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildQRPreview(QRStyle style) {
    try {
      return QrImageView(
        data: widget.qrData,
        version: QrVersions.auto,
        size: double.infinity,
        backgroundColor: style.backgroundColor,
        foregroundColor: style.hasGradient && style.gradientColors != null && style.gradientColors!.isNotEmpty
            ? style.gradientColors!.first
            : style.foregroundColor,
        eyeStyle: QrEyeStyle(
          eyeShape: _convertEyeShape(style.eyeShape),
          color: style.eyeColor ?? style.foregroundColor,
        ),
        dataModuleStyle: QrDataModuleStyle(
          dataModuleShape: _convertDataShape(style.shapeType),
          color: style.hasGradient && style.gradientColors != null && style.gradientColors!.isNotEmpty
              ? style.gradientColors!.first
              : style.foregroundColor,
        ),
        errorCorrectionLevel: QrErrorCorrectLevel.M,
      );
    } catch (e) {
      return Container(
        color: style.backgroundColor,
        child: Center(
          child: Icon(
            PhosphorIcons.qrCode(),
            color: style.foregroundColor,
            size: 32,
          ),
        ),
      );
    }
  }

  QrEyeShape _convertEyeShape(QREyeShape eyeShape) {
    switch (eyeShape) {
      case QREyeShape.square:
        return QrEyeShape.square;
      case QREyeShape.circle:
        return QrEyeShape.circle;
      case QREyeShape.roundedSquare:
        return QrEyeShape.square;
    }
  }

  QrDataModuleShape _convertDataShape(QRShapeType shapeType) {
    switch (shapeType) {
      case QRShapeType.square:
        return QrDataModuleShape.square;
      case QRShapeType.circle:
        return QrDataModuleShape.circle;
      case QRShapeType.roundedSquare:
        return QrDataModuleShape.square;
    }
  }
}