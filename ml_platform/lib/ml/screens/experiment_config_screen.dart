import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/experiment_config.dart';
import '../services/ml_service.dart';
import '../models/ml_result.dart';
import 'results_screen.dart';

/// 实验配置页面
class ExperimentConfigScreen extends StatefulWidget {
  final ExperimentConfig initialConfig;
  final CSVInfo csvInfo;

  const ExperimentConfigScreen({
    Key? key,
    required this.initialConfig,
    required this.csvInfo,
  }) : super(key: key);

  @override
  State<ExperimentConfigScreen> createState() => _ExperimentConfigScreenState();
}

class _ExperimentConfigScreenState extends State<ExperimentConfigScreen> {
  late ExperimentConfig _config;
  final MLService _mlService = MLService();
  bool _isTraining = false;
  
  // 当前选择的任务类型
  late TaskType _selectedTaskType;
  
  // 当前选择的模型
  ModelOption? _selectedModel;
  
  // 超参数控制器
  final Map<String, TextEditingController> _paramControllers = {};

  @override
  void initState() {
    super.initState();
    _config = widget.initialConfig;
    
    // 初始化任务类型
    _selectedTaskType = _config.targetColumn == null 
        ? TaskType.clustering 
        : TaskType.classification;
    
    // 获取默认模型
    final models = MLModels.getModelsByTaskType(_selectedTaskType);
    if (models.isNotEmpty) {
      _selectedModel = models.first;
      _config = _config.copyWith(
        modelName: _selectedModel!.name,
        hyperparameters: _getDefaultHyperparameters(_selectedModel!),
      );
    }
  }

  @override
  void dispose() {
    // 清理控制器
    _paramControllers.forEach((_, controller) {
      controller.dispose();
    });
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('实验配置'),
        elevation: 0,
      ),
      body: _isTraining
          ? _buildTrainingProgress()
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // 数据集信息
                  _buildDatasetInfo(),
                  const SizedBox(height: 24),
                  
                  // 任务类型选择
                  _buildTaskTypeSelector(),
                  const SizedBox(height: 24),
                  
                  // 模型选择
                  if (_selectedTaskType != null)
                    _buildModelSelector(),
                  const SizedBox(height: 24),
                  
                  // 超参数配置
                  if (_selectedModel != null)
                    _buildHyperparametersConfig(),
                  const SizedBox(height: 32),
                  
                  // 训练按钮
                  _buildTrainButton(),
                ],
              ),
            ),
    );
  }

  /// 构建数据集信息卡片
  Widget _buildDatasetInfo() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.dataset, color: Theme.of(context).primaryColor),
                const SizedBox(width: 8),
                Text(
                  '数据集信息',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
            const SizedBox(height: 16),
            _buildInfoRow('样本数', '${widget.csvInfo.totalRows}'),
            _buildInfoRow('特征数', '${_config.featureColumns.length}'),
            _buildInfoRow(
              '目标变量',
              _config.targetColumn ?? '无 (聚类任务)',
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 4,
              runSpacing: 4,
              children: [
                const Text('特征列: ', style: TextStyle(fontWeight: FontWeight.bold)),
                ..._config.featureColumns.map((col) => Chip(
                  label: Text(col, style: const TextStyle(fontSize: 12)),
                  visualDensity: VisualDensity.compact,
                )),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// 构建信息行
  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: const TextStyle(color: Colors.grey),
          ),
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
    // 如果没有目标列，只能选择聚类
    final canSelectTaskType = _config.targetColumn != null;
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.category, color: Theme.of(context).primaryColor),
                const SizedBox(width: 8),
                Text(
                  '任务类型',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (!canSelectTaskType)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.blue.shade50,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    Icon(Icons.info_outline, color: Colors.blue.shade700),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Text(
                        '由于未选择目标列，仅支持聚类任务',
                        style: TextStyle(fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),
            if (canSelectTaskType) ...[
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
                    icon: Icon(Icons.show_chart),
                  ),
                  ButtonSegment(
                    value: TaskType.clustering,
                    label: Text('聚类'),
                    icon: Icon(Icons.bubble_chart),
                  ),
                ],
                selected: {_selectedTaskType},
                onSelectionChanged: (Set<TaskType> selection) {
                  setState(() {
                    _selectedTaskType = selection.first;
                    _config = _config.copyWith(
                      taskType: _selectedTaskType.toString().split('.').last,
                    );
                    
                    // 重新选择模型
                    final models = MLModels.getModelsByTaskType(_selectedTaskType);
                    if (models.isNotEmpty) {
                      _selectedModel = models.first;
                      _config = _config.copyWith(
                        modelName: _selectedModel!.name,
                        hyperparameters: _getDefaultHyperparameters(_selectedModel!),
                      );
                    }
                  });
                },
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// 构建模型选择器
  Widget _buildModelSelector() {
    final models = MLModels.getModelsByTaskType(_selectedTaskType);
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.model_training, color: Theme.of(context).primaryColor),
                const SizedBox(width: 8),
                Text(
                  '选择模型',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
            const SizedBox(height: 16),
            ...models.map((model) {
              final isSelected = _selectedModel == model;
              
              return RadioListTile<ModelOption>(
                title: Text(model.displayName),
                subtitle: Text(
                  '参数数量: ${model.hyperParameters.length}',
                  style: const TextStyle(fontSize: 12),
                ),
                value: model,
                groupValue: _selectedModel,
                onChanged: (value) {
                  setState(() {
                    _selectedModel = value;
                    _config = _config.copyWith(
                      modelName: value!.name,
                      hyperparameters: _getDefaultHyperparameters(value),
                    );
                    
                    // 清理旧的控制器
                    _paramControllers.forEach((_, controller) {
                      controller.dispose();
                    });
                    _paramControllers.clear();
                  });
                },
                selected: isSelected,
                contentPadding: const EdgeInsets.symmetric(horizontal: 0),
              );
            }).toList(),
          ],
        ),
      ),
    );
  }

  /// 构建超参数配置
  Widget _buildHyperparametersConfig() {
    if (_selectedModel == null) return const SizedBox();
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.tune, color: Theme.of(context).primaryColor),
                const SizedBox(width: 8),
                Text(
                  '超参数配置',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
            const SizedBox(height: 16),
            ..._selectedModel!.hyperParameters.entries.map((entry) {
              final param = entry.value;
              return _buildParameterInput(param);
            }).toList(),
          ],
        ),
      ),
    );
  }

  /// 构建参数输入控件
  Widget _buildParameterInput(HyperParameter param) {
    Widget inputWidget;
    
    switch (param.type) {
      case ParameterType.integer:
      case ParameterType.double:
        final controller = _paramControllers.putIfAbsent(
          param.name,
          () => TextEditingController(
            text: (_config.hyperparameters[param.name] ?? param.defaultValue).toString(),
          ),
        );
        
        inputWidget = TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          inputFormatters: [
            if (param.type == ParameterType.integer)
              FilteringTextInputFormatter.digitsOnly,
            if (param.type == ParameterType.double)
              FilteringTextInputFormatter.allow(RegExp(r'^\d*\.?\d*')),
          ],
          decoration: InputDecoration(
            labelText: param.displayName,
            hintText: '${param.min} - ${param.max}',
            helperText: param.description,
            border: const OutlineInputBorder(),
            isDense: true,
          ),
          onChanged: (value) {
            final parsedValue = param.type == ParameterType.integer
                ? int.tryParse(value) ?? param.defaultValue
                : double.tryParse(value) ?? param.defaultValue;
            
            setState(() {
              _config.hyperparameters[param.name] = parsedValue;
            });
          },
        );
        break;
        
      case ParameterType.boolean:
        inputWidget = SwitchListTile(
          title: Text(param.displayName),
          subtitle: param.description != null ? Text(param.description!) : null,
          value: _config.hyperparameters[param.name] ?? param.defaultValue,
          onChanged: (value) {
            setState(() {
              _config.hyperparameters[param.name] = value;
            });
          },
          contentPadding: EdgeInsets.zero,
        );
        break;
        
      case ParameterType.select:
        inputWidget = DropdownButtonFormField<dynamic>(
          value: _config.hyperparameters[param.name] ?? param.defaultValue,
          decoration: InputDecoration(
            labelText: param.displayName,
            helperText: param.description,
            border: const OutlineInputBorder(),
            isDense: true,
          ),
          items: param.options!.map((option) {
            return DropdownMenuItem(
              value: option,
              child: Text(option.toString()),
            );
          }).toList(),
          onChanged: (value) {
            setState(() {
              _config.hyperparameters[param.name] = value;
            });
          },
        );
        break;
        
      case ParameterType.string:
        final controller = _paramControllers.putIfAbsent(
          param.name,
          () => TextEditingController(
            text: (_config.hyperparameters[param.name] ?? param.defaultValue).toString(),
          ),
        );
        
        inputWidget = TextField(
          controller: controller,
          decoration: InputDecoration(
            labelText: param.displayName,
            helperText: param.description,
            border: const OutlineInputBorder(),
            isDense: true,
          ),
          onChanged: (value) {
            setState(() {
              _config.hyperparameters[param.name] = value;
            });
          },
        );
        break;
    }
    
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: inputWidget,
    );
  }

  /// 构建训练按钮
  Widget _buildTrainButton() {
    return SizedBox(
      width: double.infinity,
      height: 56,
      child: FilledButton.icon(
        onPressed: _selectedModel != null ? _startTraining : null,
        icon: const Icon(Icons.rocket_launch),
        label: const Text('开始训练', style: TextStyle(fontSize: 16)),
      ),
    );
  }

  /// 构建训练进度界面
  Widget _buildTrainingProgress() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const CircularProgressIndicator(strokeWidth: 3),
          const SizedBox(height: 24),
          Text(
            '模型训练中...',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          Text(
            '${_selectedModel?.displayName ?? '未知模型'}',
            style: Theme.of(context).textTheme.bodyLarge,
          ),
          const SizedBox(height: 32),
          Container(
            padding: const EdgeInsets.all(16),
            margin: const EdgeInsets.symmetric(horizontal: 32),
            decoration: BoxDecoration(
              color: Colors.blue.shade50,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              children: [
                Icon(Icons.info_outline, color: Colors.blue.shade700),
                const SizedBox(height: 8),
                const Text(
                  '训练时间取决于数据集大小和模型复杂度\n请耐心等待...',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// 获取默认超参数
  Map<String, dynamic> _getDefaultHyperparameters(ModelOption model) {
    final params = <String, dynamic>{};
    model.hyperParameters.forEach((key, param) {
      params[param.name] = param.defaultValue;
    });
    return params;
  }

  /// 开始训练
  Future<void> _startTraining() async {
    setState(() {
      _isTraining = true;
    });

    try {
      // 调用ML服务训练模型
      final result = await _mlService.trainModel(_config);
      
      if (!mounted) return;
      
      if (result.isSuccess) {
        // 导航到结果页面
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (context) => ResultsScreen(
              result: result,
              config: _config,
            ),
          ),
        );
      } else {
        // 显示错误信息
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('训练失败: ${result.errorMessage}'),
            backgroundColor: Colors.red,
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
          backgroundColor: Colors.red,
        ),
      );
      setState(() {
        _isTraining = false;
      });
    }
  }
}
