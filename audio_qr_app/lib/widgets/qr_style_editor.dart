import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../models/qr_style.dart';
import '../widgets/animated_card.dart';

/// QR码样式编辑器
class QRStyleEditor extends StatefulWidget {
  final String qrData;
  final QRStyle initialStyle;
  final Function(QRStyle) onStyleChanged;
  
  const QRStyleEditor({
    super.key,
    required this.qrData,
    required this.initialStyle,
    required this.onStyleChanged,
  });

  @override
  State<QRStyleEditor> createState() => _QRStyleEditorState();
}

class _QRStyleEditorState extends State<QRStyleEditor>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  late QRStyle _currentStyle;
  
  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _currentStyle = widget.initialStyle;
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  void _updateStyle(QRStyle newStyle) {
    setState(() {
      _currentStyle = newStyle;
    });
    widget.onStyleChanged(newStyle);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('自定义QR码样式'),
        actions: [
          IconButton(
            icon: Icon(PhosphorIcons.arrowClockwise()),
            onPressed: _resetToDefault,
            tooltip: '重置为默认',
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: '预设'),
            Tab(text: '颜色'),
            Tab(text: '形状'),
          ],
        ),
      ),
      body: Column(
        children: [
          // QR码预览
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              border: Border(
                bottom: BorderSide(
                  color: Theme.of(context).colorScheme.outline.withOpacity(0.2),
                ),
              ),
            ),
            child: Column(
              children: [
                Text(
                  '预览',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 16),
                _buildQRPreview(),
              ],
            ),
          ),
          
          // 编辑选项
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _buildPresetTab(),
                _buildColorTab(),
                _buildShapeTab(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildQRPreview() {
    return AnimatedCard(
      padding: const EdgeInsets.all(16),
      child: Container(
        decoration: BoxDecoration(
          color: _currentStyle.backgroundColor,
          borderRadius: BorderRadius.circular(_currentStyle.borderRadius),
          border: _currentStyle.hasBorder
              ? Border.all(
                  color: _currentStyle.borderColor ?? Colors.grey,
                  width: _currentStyle.borderWidth,
                )
              : null,
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(_currentStyle.borderRadius),
          child: QrImageView(
            data: widget.qrData,
            version: QrVersions.auto,
            size: 200,
            backgroundColor: _currentStyle.backgroundColor,
            foregroundColor: _currentStyle.hasGradient && _currentStyle.gradientColors != null
                ? _currentStyle.gradientColors!.first
                : _currentStyle.foregroundColor,
            eyeStyle: QrEyeStyle(
              eyeShape: _getQrEyeShape(_currentStyle.eyeShape),
              color: _currentStyle.eyeColor ?? _currentStyle.foregroundColor,
            ),
            dataModuleStyle: QrDataModuleStyle(
              dataModuleShape: _getQrDataModuleShape(_currentStyle.shapeType),
              color: _currentStyle.foregroundColor,
            ),
            gapless: false,
            errorCorrectionLevel: QrErrorCorrectLevel.M,
          ),
        ),
      ),
    );
  }

  Widget _buildPresetTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          '选择预设样式',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 16),
        ...QRStyle.presetStyles.map((style) => _buildPresetOption(style)),
      ],
    );
  }

  Widget _buildPresetOption(QRStyle style) {
    final isSelected = _isSameStyle(style, _currentStyle);
    
    return AnimatedCard(
      margin: const EdgeInsets.only(bottom: 12),
      padding: EdgeInsets.zero,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _updateStyle(style),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: isSelected
                ? Border.all(
                    color: Theme.of(context).colorScheme.primary,
                    width: 2,
                  )
                : null,
          ),
          child: Row(
            children: [
              Container(
                width: 60,
                height: 60,
                decoration: BoxDecoration(
                  color: style.backgroundColor,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: Theme.of(context).colorScheme.outline.withOpacity(0.3),
                  ),
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: QrImageView(
                    data: 'DEMO',
                    size: 60,
                    backgroundColor: style.backgroundColor,
                    foregroundColor: style.foregroundColor,
                    eyeStyle: QrEyeStyle(
                      eyeShape: _getQrEyeShape(style.eyeShape),
                      color: style.eyeColor ?? style.foregroundColor,
                    ),
                    dataModuleStyle: QrDataModuleStyle(
                      dataModuleShape: _getQrDataModuleShape(style.shapeType),
                      color: style.foregroundColor,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      style.name,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _getStyleDescription(style),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              if (isSelected)
                Icon(
                  PhosphorIcons.checkCircle(),
                  color: Theme.of(context).colorScheme.primary,
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildColorTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildColorSection('背景颜色', _currentStyle.backgroundColor, (color) {
          _updateStyle(_currentStyle.copyWith(backgroundColor: color));
        }),
        const SizedBox(height: 24),
        _buildColorSection('前景颜色', _currentStyle.foregroundColor, (color) {
          _updateStyle(_currentStyle.copyWith(foregroundColor: color));
        }),
        const SizedBox(height: 24),
        _buildColorSection('眼部颜色', _currentStyle.eyeColor ?? _currentStyle.foregroundColor, (color) {
          _updateStyle(_currentStyle.copyWith(eyeColor: color));
        }),
        const SizedBox(height: 24),
        _buildBorderSection(),
      ],
    );
  }

  Widget _buildColorSection(String title, Color currentColor, Function(Color) onColorChanged) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: _getColorOptions().map((color) {
            final isSelected = color.value == currentColor.value;
            return GestureDetector(
              onTap: () => onColorChanged(color),
              child: Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: color,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(
                    color: isSelected
                        ? Theme.of(context).colorScheme.primary
                        : Theme.of(context).colorScheme.outline.withOpacity(0.3),
                    width: isSelected ? 3 : 1,
                  ),
                ),
                child: isSelected
                    ? Icon(
                        PhosphorIcons.check(),
                        color: _getContrastColor(color),
                        size: 20,
                      )
                    : null,
              ),
            );
          }).toList(),
        ),
      ],
    );
  }

  Widget _buildBorderSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                '边框',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Switch(
              value: _currentStyle.hasBorder,
              onChanged: (value) {
                _updateStyle(_currentStyle.copyWith(hasBorder: value));
              },
            ),
          ],
        ),
        if (_currentStyle.hasBorder) ...[
          const SizedBox(height: 12),
          _buildColorSection('边框颜色', _currentStyle.borderColor ?? Colors.grey, (color) {
            _updateStyle(_currentStyle.copyWith(borderColor: color));
          }),
          const SizedBox(height: 16),
          Text(
            '边框宽度: ${_currentStyle.borderWidth.toStringAsFixed(1)}',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          Slider(
            value: _currentStyle.borderWidth,
            min: 0.5,
            max: 10.0,
            divisions: 19,
            onChanged: (value) {
              _updateStyle(_currentStyle.copyWith(borderWidth: value));
            },
          ),
        ],
      ],
    );
  }

  Widget _buildShapeTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildShapeSection(),
        const SizedBox(height: 24),
        _buildEyeShapeSection(),
        const SizedBox(height: 24),
        _buildBorderRadiusSection(),
        const SizedBox(height: 24),
        _buildDotScaleSection(),
      ],
    );
  }

  Widget _buildShapeSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '点形状',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 12,
          children: QRShapeType.values.map((shape) {
            final isSelected = shape == _currentStyle.shapeType;
            return ChoiceChip(
              label: Text(_getShapeTypeName(shape)),
              selected: isSelected,
              onSelected: (selected) {
                if (selected) {
                  _updateStyle(_currentStyle.copyWith(shapeType: shape));
                }
              },
            );
          }).toList(),
        ),
      ],
    );
  }

  Widget _buildEyeShapeSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '眼部形状',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 12,
          children: QREyeShape.values.map((shape) {
            final isSelected = shape == _currentStyle.eyeShape;
            return ChoiceChip(
              label: Text(_getEyeShapeName(shape)),
              selected: isSelected,
              onSelected: (selected) {
                if (selected) {
                  _updateStyle(_currentStyle.copyWith(eyeShape: shape));
                }
              },
            );
          }).toList(),
        ),
      ],
    );
  }

  Widget _buildBorderRadiusSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '圆角: ${_currentStyle.borderRadius.toStringAsFixed(1)}',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w600,
          ),
        ),
        Slider(
          value: _currentStyle.borderRadius,
          min: 0,
          max: 20,
          divisions: 20,
          onChanged: (value) {
            _updateStyle(_currentStyle.copyWith(borderRadius: value));
          },
        ),
      ],
    );
  }

  Widget _buildDotScaleSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '点大小: ${(_currentStyle.dotScale * 100).toStringAsFixed(0)}%',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w600,
          ),
        ),
        Slider(
          value: _currentStyle.dotScale,
          min: 0.5,
          max: 1.0,
          divisions: 10,
          onChanged: (value) {
            _updateStyle(_currentStyle.copyWith(dotScale: value));
          },
        ),
      ],
    );
  }

  List<Color> _getColorOptions() {
    return [
      Colors.black,
      Colors.white,
      Colors.red,
      Colors.pink,
      Colors.purple,
      Colors.deepPurple,
      Colors.indigo,
      Colors.blue,
      Colors.lightBlue,
      Colors.cyan,
      Colors.teal,
      Colors.green,
      Colors.lightGreen,
      Colors.lime,
      Colors.yellow,
      Colors.amber,
      Colors.orange,
      Colors.deepOrange,
      Colors.brown,
      Colors.grey,
    ];
  }

  Color _getContrastColor(Color color) {
    final luminance = color.computeLuminance();
    return luminance > 0.5 ? Colors.black : Colors.white;
  }

  QrEyeShape _getQrEyeShape(QREyeShape eyeShape) {
    switch (eyeShape) {
      case QREyeShape.square:
        return QrEyeShape.square;
      case QREyeShape.circle:
        return QrEyeShape.circle;
      case QREyeShape.roundedSquare:
        return QrEyeShape.square;
    }
  }

  QrDataModuleShape _getQrDataModuleShape(QRShapeType shapeType) {
    switch (shapeType) {
      case QRShapeType.square:
        return QrDataModuleShape.square;
      case QRShapeType.circle:
        return QrDataModuleShape.circle;
      case QRShapeType.roundedSquare:
        return QrDataModuleShape.square;
    }
  }

  String _getShapeTypeName(QRShapeType type) {
    switch (type) {
      case QRShapeType.square:
        return '方形';
      case QRShapeType.circle:
        return '圆形';
      case QRShapeType.roundedSquare:
        return '圆角方形';
    }
  }

  String _getEyeShapeName(QREyeShape shape) {
    switch (shape) {
      case QREyeShape.square:
        return '方形';
      case QREyeShape.circle:
        return '圆形';
      case QREyeShape.roundedSquare:
        return '圆角方形';
    }
  }

  String _getStyleDescription(QRStyle style) {
    if (style == QRStyle.classic) return '传统黑白样式，简洁明了';
    if (style == QRStyle.modern) return '现代设计，优雅边框';
    if (style == QRStyle.colorful) return '渐变色彩，时尚动感';
    if (style == QRStyle.minimal) return '极简设计，去除背景';
    if (style == QRStyle.neon) return '霓虹效果，科技感十足';
    return '个性化自定义样式';
  }

  bool _isSameStyle(QRStyle style1, QRStyle style2) {
    return style1.backgroundColor.value == style2.backgroundColor.value &&
           style1.foregroundColor.value == style2.foregroundColor.value &&
           style1.dotScale == style2.dotScale &&
           style1.shapeType == style2.shapeType &&
           style1.eyeShape == style2.eyeShape;
  }

  void _resetToDefault() {
    _updateStyle(QRStyle.classic);
    _tabController.animateTo(0);
  }
}