# 🤖 机器学习服务 API

机器学习服务提供了模型训练、预测和数据处理的完整 API。

## 📋 模块概述

- **模型训练** - 监督学习、无监督学习
- **数据处理** - 预处理、特征工程
- **模型评估** - 性能指标、可视化
- **模型部署** - 模型保存、加载、推理

## 🧠 机器学习模型 API

### MLModel

机器学习模型基类。

```dart
abstract class MLModel {
  /// 训练模型
  Future<TrainingResult> train({
    required Dataset dataset,
    required HyperParameters params,
    ProgressCallback? onProgress,
  });
  
  /// 预测
  Future<Prediction> predict(List<double> features);
  
  /// 批量预测
  Future<List<Prediction>> predictBatch(List<List<double>> features);
  
  /// 评估模型
  Future<Evaluation> evaluate(Dataset testSet);
  
  /// 保存模型
  Future<void> save(String path);
  
  /// 加载模型
  Future<void> load(String path);
  
  /// 获取模型信息
  ModelInfo get info;
}
```

### LinearRegressionModel

线性回归模型。

```dart
class LinearRegressionModel extends MLModel {
  final double learningRate;
  final int maxIterations;
  final double tolerance;
  
  LinearRegressionModel({
    this.learningRate = 0.01,
    this.maxIterations = 1000,
    this.tolerance = 1e-6,
  });
  
  /// 获取模型参数
  List<double> get weights;
  double get bias;
}
```

**示例 - 线性回归**:

```dart
// 创建模型
final model = LinearRegressionModel(
  learningRate: 0.01,
  maxIterations: 1000,
);

// 准备数据
final dataset = Dataset.fromCSV('housing.csv');
final split = dataset.split(trainRatio: 0.8);

// 训练模型
final result = await model.train(
  dataset: split.train,
  params: HyperParameters(
    learningRate: 0.01,
    batchSize: 32,
  ),
  onProgress: (epoch, loss) {
    print('Epoch $epoch: Loss = $loss');
  },
);

// 评估
final eval = await model.evaluate(split.test);
print('R² Score: ${eval.r2Score}');
print('MSE: ${eval.mse}');

// 预测
final prediction = await model.predict([3.0, 2.0, 1500.0]);
print('Predicted price: \$${prediction.value}');
```

### LogisticRegressionModel

逻辑回归模型(分类)。

```dart
class LogisticRegressionModel extends MLModel {
  final double learningRate;
  final int maxIterations;
  final RegularizationType regularization;
  
  LogisticRegressionModel({
    this.learningRate = 0.01,
    this.maxIterations = 1000,
    this.regularization = RegularizationType.l2,
  });
}
```

### DecisionTreeModel

决策树模型。

```dart
class DecisionTreeModel extends MLModel {
  final int maxDepth;
  final int minSamplesSplit;
  final SplitCriterion criterion;
  
  DecisionTreeModel({
    this.maxDepth = 10,
    this.minSamplesSplit = 2,
    this.criterion = SplitCriterion.gini,
  });
  
  /// 获取决策树结构
  TreeNode get root;
  
  /// 可视化决策树
  Future<String> visualize();
}
```

### KMeansModel

K-Means 聚类模型。

```dart
class KMeansModel extends MLModel {
  final int numClusters;
  final int maxIterations;
  final String initMethod;
  
  KMeansModel({
    required this.numClusters,
    this.maxIterations = 100,
    this.initMethod = 'k-means++',
  });
  
  /// 获取聚类中心
  List<List<double>> get centroids;
  
  /// 获取聚类标签
  List<int> get labels;
}
```

**示例 - K-Means 聚类**:

```dart
final model = KMeansModel(
  numClusters: 3,
  maxIterations: 100,
);

// 训练
await model.train(
  dataset: dataset,
  params: HyperParameters(),
);

// 获取聚类结果
final centroids = model.centroids;
final labels = model.labels;

print('Cluster centers:');
for (var i = 0; i < centroids.length; i++) {
  print('Cluster $i: ${centroids[i]}');
}
```

### NeuralNetworkModel

神经网络模型。

```dart
class NeuralNetworkModel extends MLModel {
  final List<int> layers;
  final ActivationFunction activation;
  final Optimizer optimizer;
  
  NeuralNetworkModel({
    required this.layers,
    this.activation = ActivationFunction.relu,
    this.optimizer = Optimizer.adam,
  });
  
  /// 添加层
  void addLayer(Layer layer);
  
  /// 获取网络结构
  List<Layer> get architecture;
  
  /// 获取训练历史
  TrainingHistory get history;
}
```

**示例 - 神经网络**:

```dart
// 创建网络
final model = NeuralNetworkModel(
  layers: [64, 32, 16, 1],
  activation: ActivationFunction.relu,
  optimizer: Optimizer.adam,
);

// 训练
final result = await model.train(
  dataset: dataset,
  params: HyperParameters(
    learningRate: 0.001,
    batchSize: 32,
    epochs: 100,
  ),
  onProgress: (epoch, loss) {
    print('Epoch $epoch/$100 - Loss: $loss');
  },
);

// 可视化训练历史
final history = model.history;
print('Training loss: ${history.loss}');
print('Validation loss: ${history.valLoss}');
```

## 📊 数据处理 API

### Dataset

数据集类。

```dart
class Dataset {
  final List<List<double>> features;
  final List<dynamic> labels;
  
  Dataset({
    required this.features,
    required this.labels,
  });
  
  /// 从 CSV 加载
  factory Dataset.fromCSV(String path);
  
  /// 从 JSON 加载
  factory Dataset.fromJSON(String path);
  
  /// 数据分割
  DatasetSplit split({
    double trainRatio = 0.8,
    bool shuffle = true,
  });
  
  /// 归一化
  void normalize({
    NormalizationType type = NormalizationType.minMax,
  });
  
  /// 标准化
  void standardize();
  
  /// 获取统计信息
  DatasetStatistics get stats;
}
```

**示例 - 数据处理**:

```dart
// 加载数据
var dataset = Dataset.fromCSV('data.csv');

// 查看统计信息
print('Dataset size: ${dataset.features.length}');
print('Features: ${dataset.stats.numFeatures}');
print('Mean: ${dataset.stats.mean}');
print('Std: ${dataset.stats.std}');

// 归一化
dataset.normalize(type: NormalizationType.minMax);

// 分割数据集
final split = dataset.split(
  trainRatio: 0.8,
  shuffle: true,
);

print('Train set: ${split.train.features.length}');
print('Test set: ${split.test.features.length}');
```

### DataPreprocessor

数据预处理器。

```dart
class DataPreprocessor {
  /// 缺失值处理
  static Dataset handleMissingValues(
    Dataset dataset, {
    MissingValueStrategy strategy = MissingValueStrategy.mean,
  });
  
  /// 异常值检测
  static List<int> detectOutliers(
    Dataset dataset, {
    OutlierMethod method = OutlierMethod.iqr,
  });
  
  /// 特征缩放
  static Dataset scaleFeatures(
    Dataset dataset, {
    ScalingMethod method = ScalingMethod.standard,
  });
  
  /// 特征编码
  static Dataset encodeFeatures(
    Dataset dataset, {
    EncodingMethod method = EncodingMethod.oneHot,
  });
}
```

### FeatureExtractor

特征工程。

```dart
class FeatureExtractor {
  /// 多项式特征
  static List<double> polynomialFeatures(
    List<double> features, {
    int degree = 2,
  });
  
  /// 特征选择
  static List<int> selectFeatures(
    Dataset dataset, {
    SelectionMethod method = SelectionMethod.variance,
    int numFeatures = 10,
  });
  
  /// PCA 降维
  static Dataset pca(
    Dataset dataset, {
    int numComponents = 2,
  });
}
```

## 📈 模型评估 API

### Evaluation

评估结果。

```dart
class Evaluation {
  // 回归指标
  final double? mse;           // 均方误差
  final double? rmse;          // 均方根误差
  final double? mae;           // 平均绝对误差
  final double? r2Score;       // R² 分数
  
  // 分类指标
  final double? accuracy;      // 准确率
  final double? precision;     // 精确率
  final double? recall;        // 召回率
  final double? f1Score;       // F1 分数
  final List<List<int>>? confusionMatrix;  // 混淆矩阵
  
  // 聚类指标
  final double? silhouetteScore;  // 轮廓系数
  final double? daviesBouldinIndex;  // DB 指数
  
  Evaluation({
    this.mse,
    this.rmse,
    this.mae,
    this.r2Score,
    this.accuracy,
    this.precision,
    this.recall,
    this.f1Score,
    this.confusionMatrix,
    this.silhouetteScore,
    this.daviesBouldinIndex,
  });
}
```

### CrossValidator

交叉验证。

```dart
class CrossValidator {
  final int numFolds;
  final bool shuffle;
  
  CrossValidator({
    this.numFolds = 5,
    this.shuffle = true,
  });
  
  /// K 折交叉验证
  Future<CrossValidationResult> validate({
    required MLModel model,
    required Dataset dataset,
    required HyperParameters params,
  });
}
```

**示例 - 交叉验证**:

```dart
final validator = CrossValidator(numFolds: 5);

final result = await validator.validate(
  model: LinearRegressionModel(),
  dataset: dataset,
  params: HyperParameters(),
);

print('Mean R²: ${result.meanScore}');
print('Std R²: ${result.stdScore}');
print('Scores: ${result.scores}');
```

## 🎯 超参数调优 API

### GridSearch

网格搜索。

```dart
class GridSearch {
  /// 执行网格搜索
  Future<GridSearchResult> search({
    required MLModel model,
    required Dataset dataset,
    required Map<String, List<dynamic>> paramGrid,
    int cvFolds = 5,
  });
}
```

**示例 - 网格搜索**:

```dart
final gridSearch = GridSearch();

final result = await gridSearch.search(
  model: LinearRegressionModel(),
  dataset: dataset,
  paramGrid: {
    'learningRate': [0.001, 0.01, 0.1],
    'maxIterations': [100, 500, 1000],
  },
  cvFolds: 5,
);

print('Best parameters: ${result.bestParams}');
print('Best score: ${result.bestScore}');
```

### RandomSearch

随机搜索。

```dart
class RandomSearch {
  final int numIterations;
  
  RandomSearch({this.numIterations = 10});
  
  /// 执行随机搜索
  Future<RandomSearchResult> search({
    required MLModel model,
    required Dataset dataset,
    required Map<String, Distribution> paramDistributions,
  });
}
```

## 📦 模型部署 API

### ModelRegistry

模型注册表。

```dart
class ModelRegistry {
  /// 注册模型
  Future<void> register({
    required String name,
    required MLModel model,
    required Map<String, dynamic> metadata,
  });
  
  /// 获取模型
  Future<MLModel?> get(String name);
  
  /// 列出所有模型
  Future<List<ModelInfo>> list();
  
  /// 删除模型
  Future<void> delete(String name);
}
```

### ModelServer

模型服务器。

```dart
class ModelServer {
  /// 启动服务器
  Future<void> start({
    required int port,
    required MLModel model,
  });
  
  /// 停止服务器
  Future<void> stop();
  
  /// 处理预测请求
  Future<Prediction> handleRequest(PredictionRequest request);
}
```

## 📊 数据类型

### HyperParameters

超参数。

```dart
class HyperParameters {
  final double learningRate;
  final int batchSize;
  final int epochs;
  final double dropout;
  final double regularization;
  
  HyperParameters({
    this.learningRate = 0.01,
    this.batchSize = 32,
    this.epochs = 100,
    this.dropout = 0.0,
    this.regularization = 0.0,
  });
}
```

### TrainingResult

训练结果。

```dart
class TrainingResult {
  final double finalLoss;
  final double bestLoss;
  final int epochs;
  final Duration trainingTime;
  final TrainingHistory history;
  
  TrainingResult({
    required this.finalLoss,
    required this.bestLoss,
    required this.epochs,
    required this.trainingTime,
    required this.history,
  });
}
```

### Prediction

预测结果。

```dart
class Prediction {
  final dynamic value;
  final double confidence;
  final Map<String, double>? probabilities;
  
  Prediction({
    required this.value,
    this.confidence = 1.0,
    this.probabilities,
  });
}
```

## 🔧 工具函数

### Metrics

评估指标计算。

```dart
class Metrics {
  /// 计算 MSE
  static double mse(List<double> yTrue, List<double> yPred);
  
  /// 计算 R² 分数
  static double r2Score(List<double> yTrue, List<double> yPred);
  
  /// 计算准确率
  static double accuracy(List<int> yTrue, List<int> yPred);
  
  /// 计算混淆矩阵
  static List<List<int>> confusionMatrix(
    List<int> yTrue,
    List<int> yPred,
    int numClasses,
  );
}
```

## 📚 使用示例

### 完整的机器学习工作流

```dart
// 1. 加载和预处理数据
var dataset = Dataset.fromCSV('data.csv');
dataset.normalize();
final split = dataset.split(trainRatio: 0.8);

// 2. 创建模型
final model = LinearRegressionModel(
  learningRate: 0.01,
  maxIterations: 1000,
);

// 3. 训练模型
final result = await model.train(
  dataset: split.train,
  params: HyperParameters(),
  onProgress: (epoch, loss) {
    print('Epoch $epoch: $loss');
  },
);

// 4. 评估模型
final eval = await model.evaluate(split.test);
print('R² Score: ${eval.r2Score}');

// 5. 保存模型
await model.save('model.json');

// 6. 预测
final prediction = await model.predict([1.0, 2.0, 3.0]);
print('Prediction: ${prediction.value}');
```

## 📚 相关文档

- [API 概述](./index.md)
- [算法 API](./algorithms.md)
- [OS 模拟器 API](./os-simulator.md)

---

*持续更新中*
