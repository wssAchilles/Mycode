import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:ml_platform/config/app_theme.dart';
import 'package:ml_platform/widgets/common/responsive_container.dart';
import '../models/experiment_config.dart';
import '../services/ml_service.dart';
import '../models/ml_result.dart';
import '../../services/firebase_service.dart';


/// 实验配置页面
class ExperimentConfigScreen extends StatefulWidget {
  final String? experimentId;
  final String? datasetUrl;
  final ExperimentConfig? initialConfig;
  final List<String>? initialSelectedFeatures;
  final String? initialSelectedTarget;
  final CSVInfo? csvInfo;

  const ExperimentConfigScreen({
    Key? key,
    this.experimentId,
    this.datasetUrl,
    this.initialConfig,
    this.csvInfo,
    this.initialSelectedFeatures,
    this.initialSelectedTarget,
  }) : super(key: key);

  @override
  State<ExperimentConfigScreen> createState() => _ExperimentConfigScreenState();
}

class _ExperimentConfigScreenState extends State<ExperimentConfigScreen> {
  late ExperimentConfig _config;
  final MLService _mlService = MLService();
  bool _isTraining = false;
  double _trainingProgress = 0.0;
  
  // 当前选择的任务类型
  TaskType _selectedTaskType = TaskType.clustering;
  
  // 当前选择的模型
  ModelOption? _selectedModel;
  
  // 预处理配置
  String _missingStrategy = 'mean';
  final List<String> _missingStrategies = ['mean', 'median', 'constant', 'drop'];
  
  // 超参数控制器
  final Map<String, TextEditingController> _paramControllers = {};

  @override
  void initState() {
    super.initState();
    
    // 初始化配置
    if (widget.initialConfig != null) {
      _config = widget.initialConfig!;
    } else {
      // 从参数构建默认配置
      final headers = widget.csvInfo?.headers ?? <String>[];
      final features = widget.initialSelectedFeatures ?? headers;
      
      _config = ExperimentConfig(
        datasetUrl: widget.datasetUrl ?? '',
        taskType: 'clustering', // 后续逻辑会再次覆盖
        modelName: '',
        hyperparameters: {},
        featureColumns: features,
        targetColumn: widget.initialSelectedTarget,
      );
    }
    
    // 初始化任务类型
    _selectedTaskType = _config.targetColumn == null 
        ? TaskType.clustering 
        : TaskType.classification;
    
    // 获取默认模型
    final models = MLModels.getModelsByTaskType(_selectedTaskType);
    if (models.isNotEmpty) {
      _selectedModel = models.first;
      _initHyperparameters(_selectedModel!);
    }
  }
  
  void _initHyperparameters(ModelOption model) {
    _paramControllers.clear();
    for (var entry in model.hyperParameters.entries) {
      _paramControllers[entry.key] = TextEditingController(
        text: entry.value.defaultValue.toString(),
      );
    }
  }
  
  Map<String, dynamic> _getDefaultHyperparameters(ModelOption model) {
    final params = <String, dynamic>{};
    for (var entry in model.hyperParameters.entries) {
      params[entry.key] = entry.value.defaultValue;
    }
    return params;
  }

  @override
  void dispose() {
    for (var controller in _paramControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('实验配置'),
        elevation: 0,
      ),
      body: _isTraining
          ? _buildTrainingProgress()
          : SingleChildScrollView(
              child: ResponsiveContainer(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (widget.csvInfo != null) _buildDatasetInfo(),
                    if (widget.csvInfo != null) const SizedBox(height: 24),
                    _buildTaskTypeSelector(),
                    const SizedBox(height: 24),
                    _buildPreprocessingConfig(),
                    const SizedBox(height: 24),
                    if (widget.csvInfo != null) _buildFeatureSelector(),
                    if (widget.csvInfo != null) const SizedBox(height: 24),
                    if (_selectedModel != null) _buildModelSelector(),
                    const SizedBox(height: 24),
                    if (_selectedModel != null) _buildHyperparametersConfig(),
                    const SizedBox(height: 32),
                    _buildTrainButton(),
                  ],
                ),
              ),
            ),
    );
  }

  /// 构建数据集信息卡片
  Widget _buildDatasetInfo() {
    final csvInfo = widget.csvInfo!;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '数据集信息',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            _buildInfoRow('特征数量', '${csvInfo.headers.length}'),
            _buildInfoRow('样本数量', '${csvInfo.totalRows}'),
            const SizedBox(height: 8),
            Text(
              '列: ${csvInfo.headers.take(5).join(", ")}${csvInfo.headers.length > 5 ? "…" : ""}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: AppTheme.textSecondary,
                  ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label),
          Text(
            value,
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }

  /// 构建任务类型选择器
  Widget _buildTaskTypeSelector() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '任务类型',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 12),
        SegmentedButton<TaskType>(
          segments: const [
            ButtonSegment(
              value: TaskType.classification,
              label: Text('分类'),
              icon: Icon(Icons.category),
            ),
            ButtonSegment(
              value: TaskType.regression,
              label: Text('回归'),
              icon: Icon(Icons.trending_up),
            ),
            ButtonSegment(
              value: TaskType.clustering,
              label: Text('聚类'),
              icon: Icon(Icons.bubble_chart),
            ),
          ],
          selected: {_selectedTaskType},
          onSelectionChanged: (Set<TaskType> newSelection) {
            setState(() {
              _selectedTaskType = newSelection.first;
              // 更新可用模型
              final models = MLModels.getModelsByTaskType(_selectedTaskType);
              if (models.isNotEmpty) {
                _selectedModel = models.first;
                _initHyperparameters(_selectedModel!);
              }
            });
          },
        ),
      ],
    );
  }

  /// 构建预处理配置
  Widget _buildPreprocessingConfig() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '预处理配置',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(
                  label: '缺失值填充策略',
                  child: DropdownButtonFormField<String>(
                    value: _missingStrategy,
                    decoration: const InputDecoration(
                      labelText: '缺失值填充策略',
                      border: OutlineInputBorder(),
                      helperText: '选择如何处理数据中的缺失值',
                    ),
                    items: const [
                      DropdownMenuItem(value: 'mean', child: Text('均值填充 (Mean)')),
                      DropdownMenuItem(value: 'median', child: Text('中位数填充 (Median)')),
                      DropdownMenuItem(value: 'constant', child: Text('常数填充 (0)')),
                      DropdownMenuItem(value: 'drop', child: Text('丢弃缺失行 (Drop)')),
                    ],
                    onChanged: (value) {
                      if (value != null) {
                        setState(() {
                          _missingStrategy = value;
                        });
                      }
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// 构建特征选择器 (允许微调)
  Widget _buildFeatureSelector() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '特征微调 (可选)',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                 Text(
                  '已选 ${_config.featureColumns.length} 个特征用于训练',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppTheme.textSecondary,
                      ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: widget.csvInfo!.headers.map((header) {
                     // 如果是目标列，不显示在特征选择中(或者禁用)
                     if (header == _config.targetColumn) return const SizedBox.shrink();
                     
                     final isSelected = _config.featureColumns.contains(header);
                     return FilterChip(
                       label: Text(header),
                       selected: isSelected,
                       onSelected: (selected) {
                         setState(() {
                           final newFeatures = List<String>.from(_config.featureColumns);
                           if (selected) {
                             newFeatures.add(header);
                           } else {
                             newFeatures.remove(header);
                           }
                           _config = _config.copyWith(featureColumns: newFeatures);
                         });
                       },
                       visualDensity: VisualDensity.compact,
                       selectedColor: AppTheme.primary.withOpacity(0.2),
                       checkmarkColor: AppTheme.primary,
                     );
                  }).toList(),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// 构建模型选择器
  Widget _buildModelSelector() {
    final models = MLModels.getModelsByTaskType(_selectedTaskType);
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '选择模型',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: models.map((model) {
            final isSelected = _selectedModel?.name == model.name;
            return ChoiceChip(
              label: Text(model.displayName),
              selected: isSelected,
              onSelected: (selected) {
                if (selected) {
                  setState(() {
                    _selectedModel = model;
                    _initHyperparameters(model);
                  });
                }
              },
              selectedColor: AppTheme.primary.withOpacity(0.2),
            );
          }).toList(),
        ),
      ],
    );
  }

  /// 构建超参数配置
  Widget _buildHyperparametersConfig() {
    if (_selectedModel == null) return const SizedBox.shrink();
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '超参数配置',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: _selectedModel!.hyperParameters.entries.map((entry) {
                return _buildParameterInput(entry.key, entry.value);
              }).toList(),
            ),
          ),
        ),
      ],
    );
  }
  
  Widget _buildParameterInput(String key, HyperParameter param) {
    final controller = _paramControllers[key];
    
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Expanded(
            flex: 2,
            child: Text(param.displayName),
          ),
          Expanded(
            flex: 3,
            child: param.type == ParameterType.select
                ? Semantics(
                    label: param.displayName,
                    child: DropdownButtonFormField<String>(
                      value: controller?.text ?? param.defaultValue.toString(),
                      items: param.options?.map((opt) {
                        return DropdownMenuItem(
                          value: opt.toString(),
                          child: Text(opt.toString()),
                        );
                      }).toList(),
                      onChanged: (value) {
                        controller?.text = value ?? '';
                      },
                      decoration: const InputDecoration(
                        isDense: true,
                        border: OutlineInputBorder(),
                      ),
                    ),
                  )
                : param.type == ParameterType.boolean
                    ? Semantics(
                        label: param.displayName,
                        child: Switch(
                          value: controller?.text == 'true',
                          onChanged: (value) {
                            setState(() {
                              controller?.text = value.toString();
                            });
                          },
                        ),
                      )
                    : Semantics(
                        label: param.displayName,
                        child: TextFormField(
                          controller: controller,
                          keyboardType: param.type == ParameterType.integer
                              ? TextInputType.number
                              : param.type == ParameterType.double
                                  ? const TextInputType.numberWithOptions(decimal: true)
                                  : TextInputType.text,
                          inputFormatters: param.type == ParameterType.integer
                              ? [FilteringTextInputFormatter.digitsOnly]
                              : null,
                          decoration: InputDecoration(
                            isDense: true,
                            border: const OutlineInputBorder(),
                            hintText: '${param.min ?? ""} - ${param.max ?? ""}',
                          ),
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  /// 构建训练按钮
  Widget _buildTrainButton() {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: _isTraining ? null : _startTraining,
        icon: const Icon(Icons.play_arrow),
        label: const Text('开始训练'),
        style: ElevatedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 16),
        ),
      ),
    );
  }

  /// 构建训练进度
  Widget _buildTrainingProgress() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 24),
          Text(
            '正在训练模型…',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            '${(_trainingProgress * 100).toStringAsFixed(0)}%',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
        ],
      ),
    );
  }

  /// 开始训练
  Future<void> _startTraining() async {
    // 验证：分类/回归任务需要目标列
    if ((_selectedTaskType == TaskType.classification || 
         _selectedTaskType == TaskType.regression) && 
        _config.targetColumn == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('${_selectedTaskType == TaskType.classification ? '分类' : '回归'}任务需要选择目标列！请返回上一页选择 Target 列。'),
          backgroundColor: AppTheme.warning,
          duration: const Duration(seconds: 4),
        ),
      );
      return;
    }
    
    setState(() {
      _isTraining = true;
      _trainingProgress = 0.0;
    });

    try {
      // 收集超参数
      final hyperparams = <String, dynamic>{};
      for (var entry in _paramControllers.entries) {
        final param = _selectedModel?.hyperParameters[entry.key];
        if (param != null) {
          switch (param.type) {
            case ParameterType.integer:
              hyperparams[entry.key] = int.tryParse(entry.value.text) ?? param.defaultValue;
              break;
            case ParameterType.double:
              hyperparams[entry.key] = double.tryParse(entry.value.text) ?? param.defaultValue;
              break;
            case ParameterType.boolean:
              hyperparams[entry.key] = entry.value.text == 'true';
              break;
            default:
              hyperparams[entry.key] = entry.value.text;
          }
        }
      }
      
      // 构建配置
      final config = ExperimentConfig(
        datasetUrl: widget.datasetUrl ?? '',
        taskType: _selectedTaskType.name,
        modelName: _selectedModel?.name ?? '',
        hyperparameters: hyperparams,
        featureColumns: _config.featureColumns, // 使用用户选择的特征
        targetColumn: _config.targetColumn,
        userId: FirebaseService().currentUser?.uid, // 注入真实用户ID
        missingStrategy: _missingStrategy,
      );
      
      // 调用训练服务
      final result = await _mlService.trainModel(config);
      
      if (!mounted) return;
      
      if (result.isSuccess) {
        // 导航到结果页面
        context.goNamed(
          'experiment-results',
          pathParameters: {'experimentId': widget.experimentId ?? 'temp'},
          extra: {
            'metrics': result.metrics,
            'visualizationData': result.visualizationData,
            'taskType': config.taskType,
            'modelName': config.modelName,
            'featureColumns': config.featureColumns,
          },
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('训练失败: ${result.errorMessage}'),
            backgroundColor: AppTheme.error,
          ),
        );
        setState(() {
          _isTraining = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('训练出错: $e'),
          backgroundColor: AppTheme.error,
        ),
      );
      setState(() {
        _isTraining = false;
      });
    }
  }
}
