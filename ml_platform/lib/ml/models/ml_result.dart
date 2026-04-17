/// 机器学习实验结果模型
class MLResult {
  final String status;
  final Map<String, dynamic> metrics;
  final Map<String, dynamic> visualizationData;
  final ModelInfo modelInfo;
  final String? experimentId;
  final String? errorMessage;

  MLResult({
    required this.status,
    required this.metrics,
    required this.visualizationData,
    required this.modelInfo,
    this.experimentId,
    this.errorMessage,
  });

  factory MLResult.fromJson(Map<String, dynamic> json) {
    return MLResult(
      status: json['status'] ?? 'error',
      metrics: json['metrics'] ?? {},
      visualizationData: json['visualization_data'] ?? {},
      modelInfo: ModelInfo.fromJson(json['model_info'] ?? {}),
      experimentId: json['experiment_id'],
      errorMessage: json['message'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'status': status,
      'metrics': metrics,
      'visualization_data': visualizationData,
      'model_info': modelInfo.toJson(),
      if (experimentId != null) 'experiment_id': experimentId,
      if (errorMessage != null) 'message': errorMessage,
    };
  }

  bool get isSuccess => status == 'success';
}

/// 模型信息
class ModelInfo {
  final String modelName;
  final Map<String, dynamic> hyperparameters;
  final String taskType;
  final int nFeatures;
  final int nSamples;

  ModelInfo({
    required this.modelName,
    required this.hyperparameters,
    required this.taskType,
    required this.nFeatures,
    required this.nSamples,
  });

  factory ModelInfo.fromJson(Map<String, dynamic> json) {
    return ModelInfo(
      modelName: json['model_name'] ?? 'Unknown',
      hyperparameters: json['hyperparameters'] ?? {},
      taskType: json['task_type'] ?? 'classification',
      nFeatures: json['n_features'] ?? 0,
      nSamples: json['n_samples'] ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'model_name': modelName,
      'hyperparameters': hyperparameters,
      'task_type': taskType,
      'n_features': nFeatures,
      'n_samples': nSamples,
    };
  }
}
