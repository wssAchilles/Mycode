import 'dart:io';
import 'dart:typed_data';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import 'package:data_table_2/data_table_2.dart';
import 'package:go_router/go_router.dart';
import '../services/ml_service.dart';
import '../models/experiment_config.dart';
import 'experiment_config_screen.dart';

/// 数据上传页面
class DataUploadScreen extends StatefulWidget {
  const DataUploadScreen({Key? key}) : super(key: key);

  @override
  State<DataUploadScreen> createState() => _DataUploadScreenState();
}

class _DataUploadScreenState extends State<DataUploadScreen> {
  final MLService _mlService = MLService();
  
  // Web兼容的文件数据
  Uint8List? _fileBytes;
  String? _fileName;
  int? _fileSize;
  CSVInfo? _csvInfo;
  bool _isLoading = false;
  bool _isUploading = false;
  String? _uploadedDatasetUrl;
  
  // 选中的列
  final Set<String> _selectedFeatures = {};
  String? _selectedTarget;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('数据上传'),
        elevation: 0,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                // 文件选择区域
                _buildFileSelector(),
                
                // CSV预览区域
                if (_csvInfo != null) ...[
                  _buildColumnSelector(),
                  Expanded(child: _buildDataPreview()),
                ],
                
                // 操作按钮
                if (_csvInfo != null) _buildActionButtons(),
              ],
            ),
    );
  }

  /// 构建文件选择区域
  Widget _buildFileSelector() {
    return Card(
      margin: const EdgeInsets.all(16),
      child: InkWell(
        onTap: _pickFile,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                _fileName != null ? Icons.check_circle : Icons.upload_file,
                size: 64,
                color: _fileName != null ? Colors.green : Colors.blue,
              ),
              const SizedBox(height: 16),
              Text(
                _fileName != null
                    ? '已选择: $_fileName'
                    : '点击选择CSV文件',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              if (_fileSize != null) ...[
                const SizedBox(height: 8),
                Text(
                  '文件大小: ${(_fileSize! / 1024).toStringAsFixed(2)} KB',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  /// 构建列选择器
  Widget _buildColumnSelector() {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '列选择',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              '共 ${_csvInfo!.headers.length} 列，${_csvInfo!.totalRows} 行数据',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 16),
            
            // 特征列选择
            Text(
              '选择特征列 (Features):',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _csvInfo!.headers.map((header) {
                final isSelected = _selectedFeatures.contains(header);
                final isTarget = _selectedTarget == header;
                final columnType = _csvInfo!.columnTypes[header];
                
                return FilterChip(
                  label: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(header),
                      const SizedBox(width: 4),
                      _buildColumnTypeIcon(columnType!),
                    ],
                  ),
                  selected: isSelected,
                  onSelected: isTarget ? null : (selected) {
                    setState(() {
                      if (selected) {
                        _selectedFeatures.add(header);
                      } else {
                        _selectedFeatures.remove(header);
                      }
                    });
                  },
                  backgroundColor: isTarget ? Colors.orange.shade100 : null,
                );
              }).toList(),
            ),
            const SizedBox(height: 16),
            
            // 目标列选择
            Text(
              '选择目标列 (Target) - 可选:',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                // 无目标列选项（用于聚类）
                ChoiceChip(
                  label: const Text('无 (聚类任务)'),
                  selected: _selectedTarget == null,
                  onSelected: (selected) {
                    if (selected) {
                      setState(() {
                        _selectedTarget = null;
                      });
                    }
                  },
                ),
                // 各个列选项
                ..._csvInfo!.headers.map((header) {
                  final isFeature = _selectedFeatures.contains(header);
                  final columnType = _csvInfo!.columnTypes[header];
                  
                  return ChoiceChip(
                    label: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(header),
                        const SizedBox(width: 4),
                        _buildColumnTypeIcon(columnType!),
                      ],
                    ),
                    selected: _selectedTarget == header,
                    onSelected: isFeature ? null : (selected) {
                      setState(() {
                        if (selected) {
                          _selectedTarget = header;
                        }
                      });
                    },
                    backgroundColor: isFeature ? Colors.blue.shade100 : null,
                  );
                }).toList(),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// 构建列类型图标
  Widget _buildColumnTypeIcon(ColumnType type) {
    IconData icon;
    Color color;
    String tooltip;
    
    switch (type) {
      case ColumnType.numeric:
        icon = Icons.functions;
        color = Colors.blue;
        tooltip = '数值型';
        break;
      case ColumnType.integer:
        icon = Icons.looks_one;
        color = Colors.green;
        tooltip = '整数型';
        break;
      case ColumnType.categorical:
        icon = Icons.category;
        color = Colors.orange;
        tooltip = '分类型';
        break;
      case ColumnType.string:
        icon = Icons.text_fields;
        color = Colors.purple;
        tooltip = '字符串型';
        break;
    }
    
    return Tooltip(
      message: tooltip,
      child: Icon(icon, size: 16, color: color),
    );
  }

  /// 构建数据预览
  Widget _buildDataPreview() {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              '数据预览 (前100行)',
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
          Expanded(
            child: DataTable2(
              columnSpacing: 12,
              horizontalMargin: 12,
              minWidth: 600,
              columns: _csvInfo!.headers.map((header) {
                final isFeature = _selectedFeatures.contains(header);
                final isTarget = _selectedTarget == header;
                
                return DataColumn2(
                  label: Container(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Text(
                      header,
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: isTarget
                            ? Colors.orange
                            : isFeature
                                ? Colors.blue
                                : null,
                      ),
                    ),
                  ),
                  size: ColumnSize.L,
                );
              }).toList(),
              rows: _csvInfo!.data.map((row) {
                return DataRow2(
                  cells: row.map((cell) {
                    return DataCell(
                      Text(
                        cell,
                        overflow: TextOverflow.ellipsis,
                      ),
                    );
                  }).toList(),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }

  /// 构建操作按钮
  Widget _buildActionButtons() {
    final canProceed = _selectedFeatures.isNotEmpty;
    
    return Container(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          // 重新选择按钮
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _isUploading ? null : _resetSelection,
              icon: const Icon(Icons.refresh),
              label: const Text('重新选择'),
            ),
          ),
          const SizedBox(width: 16),
          // 下一步按钮
          Expanded(
            flex: 2,
            child: FilledButton.icon(
              onPressed: canProceed && !_isUploading ? _proceedToConfiguration : null,
              icon: _isUploading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.arrow_forward),
              label: Text(_isUploading ? '上传中...' : '下一步: 配置实验'),
            ),
          ),
        ],
      ),
    );
  }

  /// 选择文件（Web兼容）
  Future<void> _pickFile() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['csv'],
        withData: true,  // 对Web平台必须为true
        withReadStream: false,
      );

      if (result != null && result.files.single.bytes != null) {
        final file = result.files.single;
        final bytes = file.bytes!;
        
        setState(() {
          _isLoading = true;
        });

        // 将字节转换为字符串
        final content = utf8.decode(bytes);
        
        // 解析CSV内容
        final csvInfo = await _mlService.parseCSVContent(content);
        
        setState(() {
          _fileBytes = bytes;
          _fileName = file.name;
          _fileSize = bytes.length;
          _csvInfo = csvInfo;
          _isLoading = false;
          _selectedFeatures.clear();
          _selectedTarget = null;
        });
      }
    } catch (e) {
      setState(() {
        _isLoading = false;
      });
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('文件选择失败: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  /// 重置选择
  void _resetSelection() {
    setState(() {
      _fileBytes = null;
      _fileName = null;
      _fileSize = null;
      _csvInfo = null;
      _selectedFeatures.clear();
      _selectedTarget = null;
      _uploadedDatasetUrl = null;
    });
  }

  /// 进入配置页面
  Future<void> _proceedToConfiguration() async {
    if (_fileBytes == null || _fileName == null || _selectedFeatures.isEmpty) return;

    setState(() {
      _isUploading = true;
    });

    try {
      // 上传数据集到Firebase Storage（Web兼容）
      final datasetUrl = await _mlService.uploadDataset(_fileBytes!, _fileName!);
      _uploadedDatasetUrl = datasetUrl;

      if (!mounted) return;

      // 生成临时实验ID
      final experimentId = DateTime.now().millisecondsSinceEpoch.toString();
      
      // 使用 GoRouter 导航，并通过 extra 传递参数
      context.goNamed(
        'experiment-config',
        pathParameters: {'experimentId': experimentId},
        extra: {
          'datasetUrl': datasetUrl,
          'csvHeaders': _csvInfo?.headers ?? [],
          'totalRows': _csvInfo?.totalRows ?? 0,
        },
      );
      
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('上传失败: $e'),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isUploading = false;
        });
      }
    }
  }
}
