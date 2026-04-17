/// CSV 列数据类型
enum ColumnType {
  numeric,    // 数值型
  integer,    // 整数型
  categorical,// 分类型 (字符串或有限整数)
  string      // 文本型
}

/// CSV 文件信息
class CSVInfo {
  final List<String> headers;
  final List<List<String>> data;  // 预览数据
  final int totalRows;
  final Map<String, ColumnType> columnTypes;
  
  CSVInfo({
    required this.headers,
    required this.data,
    required this.totalRows,
    required this.columnTypes,
  });
}

/// 机器学习实验配置模型
class ExperimentConfig {
  String datasetUrl;
  String taskType;
  String modelName;
  Map<String, dynamic> hyperparameters;
  List<String> featureColumns;
  String? targetColumn;
  String? userId;
  String missingStrategy;

  ExperimentConfig({
    required this.datasetUrl,
    required this.taskType,
    required this.modelName,
    required this.hyperparameters,
    required this.featureColumns,
    this.targetColumn,
    this.userId,
    this.missingStrategy = 'mean',
  });

  Map<String, dynamic> toJson() {
    return {
      'dataset_url': datasetUrl,
      'task_type': taskType,
      'model_config': {
        'model_name': modelName,
        'hyperparameters': hyperparameters,
      },
      'feature_columns': featureColumns,
      'target_column': targetColumn,
      'user_id': userId ?? 'anonymous',
      'missing_strategy': missingStrategy,
    };
  }

  ExperimentConfig copyWith({
    String? datasetUrl,
    String? taskType,
    String? modelName,
    Map<String, dynamic>? hyperparameters,
    List<String>? featureColumns,
    String? targetColumn,
    String? userId,
    String? missingStrategy,
  }) {
    return ExperimentConfig(
      datasetUrl: datasetUrl ?? this.datasetUrl,
      taskType: taskType ?? this.taskType,
      modelName: modelName ?? this.modelName,
      hyperparameters: hyperparameters ?? this.hyperparameters,
      featureColumns: featureColumns ?? this.featureColumns,
      targetColumn: targetColumn ?? this.targetColumn,
      userId: userId ?? this.userId,
      missingStrategy: missingStrategy ?? this.missingStrategy,
    );
  }
}

/// 模型类型枚举
enum TaskType {
  classification,
  regression,
  clustering,
}

/// 模型选项
class ModelOption {
  final String name;
  final String displayName;
  final TaskType taskType;
  final Map<String, HyperParameter> hyperParameters;

  const ModelOption({
    required this.name,
    required this.displayName,
    required this.taskType,
    required this.hyperParameters,
  });
}

/// 超参数定义
class HyperParameter {
  final String name;
  final String displayName;
  final dynamic defaultValue;
  final ParameterType type;
  final dynamic min;
  final dynamic max;
  final List<dynamic>? options;
  final String? description;

  const HyperParameter({
    required this.name,
    required this.displayName,
    required this.defaultValue,
    required this.type,
    this.min,
    this.max,
    this.options,
    this.description,
  });
}

/// 参数类型
enum ParameterType {
  integer,
  double,
  boolean,
  select,
  string,
}

/// 预定义的模型配置
class MLModels {
  // --- 自动选择模型 ---
  static const autoSelectionClassification = ModelOption(
    name: 'AutoSelection',
    displayName: '⚡️ 自动优选 (AutoML)',
    taskType: TaskType.classification,
    hyperParameters: {}, // 自动选择通常没有暴露给用户的超参数，或者有高级配置
  );
  
  static const autoSelectionRegression = ModelOption(
    name: 'AutoSelection',
    displayName: '⚡️ 自动优选 (AutoML)',
    taskType: TaskType.regression,
    hyperParameters: {},
  );

  // --- 高级模型 (LightGBM / XGBoost) ---
  static const lgbmClassifier = ModelOption(
    name: 'LGBMClassifier',
    displayName: 'LightGBM 分类器',
    taskType: TaskType.classification,
    hyperParameters: {
      'n_estimators': HyperParameter(name: 'n_estimators', displayName: '树的数量', defaultValue: 100, type: ParameterType.integer, min: 10, max: 1000),
      'learning_rate': HyperParameter(name: 'learning_rate', displayName: '学习率', defaultValue: 0.1, type: ParameterType.double, min: 0.001, max: 1.0),
      'num_leaves': HyperParameter(name: 'num_leaves', displayName: '叶子节点数', defaultValue: 31, type: ParameterType.integer, min: 2, max: 255),
    },
  );
  
  static const xgbClassifier = ModelOption(
    name: 'XGBClassifier',
    displayName: 'XGBoost 分类器',
    taskType: TaskType.classification,
    hyperParameters: {
      'n_estimators': HyperParameter(name: 'n_estimators', displayName: '树的数量', defaultValue: 100, type: ParameterType.integer, min: 10, max: 1000),
      'learning_rate': HyperParameter(name: 'learning_rate', displayName: '学习率', defaultValue: 0.1, type: ParameterType.double, min: 0.001, max: 1.0),
      'max_depth': HyperParameter(name: 'max_depth', displayName: '最大深度', defaultValue: 6, type: ParameterType.integer, min: 1, max: 20),
    },
  );

  static const lgbmRegressor = ModelOption(
    name: 'LGBMRegressor',
    displayName: 'LightGBM 回归器',
    taskType: TaskType.regression,
    hyperParameters: {
      'n_estimators': HyperParameter(name: 'n_estimators', displayName: '树的数量', defaultValue: 100, type: ParameterType.integer, min: 10, max: 1000),
      'learning_rate': HyperParameter(name: 'learning_rate', displayName: '学习率', defaultValue: 0.1, type: ParameterType.double, min: 0.001, max: 1.0),
      'num_leaves': HyperParameter(name: 'num_leaves', displayName: '叶子节点数', defaultValue: 31, type: ParameterType.integer, min: 2, max: 255),
    },
  );

  static const xgbRegressor = ModelOption(
    name: 'XGBRegressor',
    displayName: 'XGBoost 回归器',
    taskType: TaskType.regression,
    hyperParameters: {
      'n_estimators': HyperParameter(name: 'n_estimators', displayName: '树的数量', defaultValue: 100, type: ParameterType.integer, min: 10, max: 1000),
      'learning_rate': HyperParameter(name: 'learning_rate', displayName: '学习率', defaultValue: 0.1, type: ParameterType.double, min: 0.001, max: 1.0),
      'max_depth': HyperParameter(name: 'max_depth', displayName: '最大深度', defaultValue: 6, type: ParameterType.integer, min: 1, max: 20),
    },
  );

  // 分类模型
  static const logisticRegression = ModelOption(
    name: 'LogisticRegression',
    displayName: '逻辑回归',
    taskType: TaskType.classification,
    hyperParameters: {
      'max_iter': HyperParameter(
        name: 'max_iter',
        displayName: '最大迭代次数',
        defaultValue: 100,
        type: ParameterType.integer,
        min: 10,
        max: 1000,
      ),
      'C': HyperParameter(
        name: 'C',
        displayName: '正则化强度倒数',
        defaultValue: 1.0,
        type: ParameterType.double,
        min: 0.01,
        max: 100.0,
      ),
      'solver': HyperParameter(
        name: 'solver',
        displayName: '优化算法',
        defaultValue: 'lbfgs',
        type: ParameterType.select,
        options: ['lbfgs', 'liblinear', 'newton-cg', 'sag', 'saga'],
      ),
    },
  );

  static const randomForestClassifier = ModelOption(
    name: 'RandomForestClassifier',
    displayName: '随机森林分类器',
    taskType: TaskType.classification,
    hyperParameters: {
      'n_estimators': HyperParameter(
        name: 'n_estimators',
        displayName: '决策树数量',
        defaultValue: 100,
        type: ParameterType.integer,
        min: 10,
        max: 500,
      ),
      'max_depth': HyperParameter(
        name: 'max_depth',
        displayName: '最大深度',
        defaultValue: 10,
        type: ParameterType.integer,
        min: 1,
        max: 50,
      ),
      'min_samples_split': HyperParameter(
        name: 'min_samples_split',
        displayName: '节点分裂最小样本数',
        defaultValue: 2,
        type: ParameterType.integer,
        min: 2,
        max: 20,
      ),
      'criterion': HyperParameter(
        name: 'criterion',
        displayName: '分裂标准',
        defaultValue: 'gini',
        type: ParameterType.select,
        options: ['gini', 'entropy'],
      ),
    },
  );

  static const svm = ModelOption(
    name: 'SVC',
    displayName: '支持向量机',
    taskType: TaskType.classification,
    hyperParameters: {
      'C': HyperParameter(
        name: 'C',
        displayName: '惩罚参数',
        defaultValue: 1.0,
        type: ParameterType.double,
        min: 0.01,
        max: 100.0,
      ),
      'kernel': HyperParameter(
        name: 'kernel',
        displayName: '核函数',
        defaultValue: 'rbf',
        type: ParameterType.select,
        options: ['linear', 'poly', 'rbf', 'sigmoid'],
      ),
      'gamma': HyperParameter(
        name: 'gamma',
        displayName: '核函数系数',
        defaultValue: 'scale',
        type: ParameterType.select,
        options: ['scale', 'auto'],
      ),
    },
  );

  static const knn = ModelOption(
    name: 'KNeighborsClassifier',
    displayName: 'K近邻分类器',
    taskType: TaskType.classification,
    hyperParameters: {
      'n_neighbors': HyperParameter(
        name: 'n_neighbors',
        displayName: '邻居数量',
        defaultValue: 5,
        type: ParameterType.integer,
        min: 1,
        max: 30,
      ),
      'weights': HyperParameter(
        name: 'weights',
        displayName: '权重函数',
        defaultValue: 'uniform',
        type: ParameterType.select,
        options: ['uniform', 'distance'],
      ),
      'algorithm': HyperParameter(
        name: 'algorithm',
        displayName: '计算算法',
        defaultValue: 'auto',
        type: ParameterType.select,
        options: ['auto', 'ball_tree', 'kd_tree', 'brute'],
      ),
    },
  );

  // 回归模型
  static const linearRegression = ModelOption(
    name: 'LinearRegression',
    displayName: '线性回归',
    taskType: TaskType.regression,
    hyperParameters: {
      'fit_intercept': HyperParameter(
        name: 'fit_intercept',
        displayName: '是否计算截距',
        defaultValue: true,
        type: ParameterType.boolean,
      ),
      'normalize': HyperParameter(
        name: 'normalize',
        displayName: '是否标准化',
        defaultValue: false,
        type: ParameterType.boolean,
      ),
    },
  );

  static const randomForestRegressor = ModelOption(
    name: 'RandomForestRegressor',
    displayName: '随机森林回归器',
    taskType: TaskType.regression,
    hyperParameters: {
      'n_estimators': HyperParameter(
        name: 'n_estimators',
        displayName: '决策树数量',
        defaultValue: 100,
        type: ParameterType.integer,
        min: 10,
        max: 500,
      ),
      'max_depth': HyperParameter(
        name: 'max_depth',
        displayName: '最大深度',
        defaultValue: 10,
        type: ParameterType.integer,
        min: 1,
        max: 50,
      ),
      'min_samples_split': HyperParameter(
        name: 'min_samples_split',
        displayName: '节点分裂最小样本数',
        defaultValue: 2,
        type: ParameterType.integer,
        min: 2,
        max: 20,
      ),
    },
  );

  // 聚类模型
  static const kMeans = ModelOption(
    name: 'KMeans',
    displayName: 'K-Means聚类',
    taskType: TaskType.clustering,
    hyperParameters: {
      'n_clusters': HyperParameter(
        name: 'n_clusters',
        displayName: '聚类数量',
        defaultValue: 3,
        type: ParameterType.integer,
        min: 2,
        max: 20,
      ),
      'init': HyperParameter(
        name: 'init',
        displayName: '初始化方法',
        defaultValue: 'k-means++',
        type: ParameterType.select,
        options: ['k-means++', 'random'],
      ),
      'n_init': HyperParameter(
        name: 'n_init',
        displayName: '运行次数',
        defaultValue: 10,
        type: ParameterType.integer,
        min: 1,
        max: 50,
      ),
      'max_iter': HyperParameter(
        name: 'max_iter',
        displayName: '最大迭代次数',
        defaultValue: 300,
        type: ParameterType.integer,
        min: 10,
        max: 1000,
      ),
    },
  );

  static const dbscan = ModelOption(
    name: 'DBSCAN',
    displayName: 'DBSCAN密度聚类',
    taskType: TaskType.clustering,
    hyperParameters: {
      'eps': HyperParameter(
        name: 'eps',
        displayName: '邻域半径',
        defaultValue: 0.5,
        type: ParameterType.double,
        min: 0.1,
        max: 5.0,
      ),
      'min_samples': HyperParameter(
        name: 'min_samples',
        displayName: '最小样本数',
        defaultValue: 5,
        type: ParameterType.integer,
        min: 2,
        max: 50,
      ),
      'algorithm': HyperParameter(
        name: 'algorithm',
        displayName: '计算算法',
        defaultValue: 'auto',
        type: ParameterType.select,
        options: ['auto', 'ball_tree', 'kd_tree', 'brute'],
      ),
    },
  );

  // 所有模型列表
  static const List<ModelOption> allModels = [
    // 分类
    autoSelectionClassification,
    logisticRegression,
    randomForestClassifier,
    lgbmClassifier,
    xgbClassifier,
    svm,
    knn,
    // 回归
    autoSelectionRegression,
    linearRegression,
    randomForestRegressor,
    lgbmRegressor,
    xgbRegressor,
    // 聚类
    kMeans,
    dbscan,
  ];

  // 根据任务类型获取模型
  static List<ModelOption> getModelsByTaskType(TaskType taskType) {
    return allModels.where((model) => model.taskType == taskType).toList();
  }

  // 根据名称获取模型
  static ModelOption? getModelByName(String name) {
    try {
      return allModels.firstWhere((model) => model.name == name);
    } catch (e) {
      return null;
    }
  }
}
