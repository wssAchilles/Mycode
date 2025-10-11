# 🔌 API 参考

欢迎使用 ML Platform API 文档。本文档提供了平台核心 API 的详细说明。

## 📚 API 概述

ML Platform 提供以下主要 API 模块:

- **算法可视化 API** - 控制算法动画和数据结构操作
- **操作系统模拟器 API** - 进程调度、内存管理、死锁检测
- **机器学习服务 API** - 模型训练、预测、数据处理
- **用户管理 API** - 认证、个人资料、学习进度
- **数据存储 API** - Firestore 数据库操作

## 🎯 快速开始

### 初始化

```dart
import 'package:ml_platform/ml_platform.dart';

void main() async {
  // 初始化 Firebase
  await Firebase.initializeApp();
  
  // 初始化服务
  final algorithmService = AlgorithmService();
  final osService = OSSimulatorService();
  final mlService = MLService();
  
  runApp(MyApp());
}
```

## 🔢 算法可视化 API

### AlgorithmVisualizer

基础的算法可视化类。

```dart
abstract class AlgorithmVisualizer {
  /// 初始化算法
  void init();
  
  /// 执行一步
  Future<void> step();
  
  /// 重置算法
  void reset();
  
  /// 获取当前状态
  AlgorithmState getState();
}
```

### 排序算法

#### BubbleSortVisualizer

冒泡排序可视化。

```dart
class BubbleSortVisualizer extends AlgorithmVisualizer {
  BubbleSortVisualizer({
    required List<int> array,
    double speed = 1.0,
  });
  
  /// 开始排序动画
  Future<void> start();
  
  /// 暂停动画
  void pause();
  
  /// 恢复动画
  void resume();
  
  /// 停止动画
  void stop();
}
```

**示例**:

```dart
final visualizer = BubbleSortVisualizer(
  array: [64, 34, 25, 12, 22, 11, 90],
  speed: 1.5,
);

// 监听状态变化
visualizer.stateStream.listen((state) {
  print('Current state: ${state.currentStep}');
});

// 开始排序
await visualizer.start();
```

#### QuickSortVisualizer

快速排序可视化。

```dart
class QuickSortVisualizer extends AlgorithmVisualizer {
  QuickSortVisualizer({
    required List<int> array,
    PivotStrategy strategy = PivotStrategy.median,
  });
}
```

### 数据结构

#### StackVisualizer

栈数据结构可视化。

```dart
class StackVisualizer<T> {
  /// 压栈
  Future<void> push(T value);
  
  /// 出栈
  Future<T?> pop();
  
  /// 查看栈顶
  T? peek();
  
  /// 判断是否为空
  bool get isEmpty;
  
  /// 获取栈大小
  int get size;
}
```

**示例**:

```dart
final stack = StackVisualizer<int>();

await stack.push(1);
await stack.push(2);
await stack.push(3);

final top = await stack.pop(); // 3
```

## 💻 操作系统模拟器 API

### ProcessScheduler

进程调度器。

```dart
class ProcessScheduler {
  ProcessScheduler({
    required SchedulingAlgorithm algorithm,
  });
  
  /// 添加进程
  void addProcess(Process process);
  
  /// 开始调度
  Future<void> start();
  
  /// 暂停调度
  void pause();
  
  /// 获取当前运行的进程
  Process? get currentProcess;
  
  /// 获取就绪队列
  List<Process> get readyQueue;
}
```

**调度算法**:

```dart
enum SchedulingAlgorithm {
  fcfs,      // 先来先服务
  sjf,       // 最短作业优先
  priority,  // 优先级调度
  roundRobin,// 时间片轮转
}
```

**示例**:

```dart
final scheduler = ProcessScheduler(
  algorithm: SchedulingAlgorithm.roundRobin,
);

// 添加进程
scheduler.addProcess(Process(
  pid: 1,
  arrivalTime: 0,
  burstTime: 5,
  priority: 2,
));

// 监听调度事件
scheduler.eventStream.listen((event) {
  print('Process ${event.pid} ${event.type}');
});

// 开始调度
await scheduler.start();
```

### MemoryManager

内存管理器。

```dart
class MemoryManager {
  MemoryManager({
    required int totalMemory,
    required AllocationStrategy strategy,
  });
  
  /// 分配内存
  Future<MemoryBlock?> allocate(int size, int processId);
  
  /// 释放内存
  Future<void> deallocate(int processId);
  
  /// 获取内存使用情况
  MemoryStatus getStatus();
  
  /// 内存碎片整理
  Future<void> compact();
}
```

## 🤖 机器学习服务 API

### MLModel

机器学习模型基类。

```dart
abstract class MLModel {
  /// 训练模型
  Future<TrainingResult> train({
    required Dataset dataset,
    required HyperParameters params,
  });
  
  /// 预测
  Future<Prediction> predict(List<double> features);
  
  /// 评估模型
  Future<Evaluation> evaluate(Dataset testSet);
  
  /// 保存模型
  Future<void> save(String path);
  
  /// 加载模型
  Future<void> load(String path);
}
```

### LinearRegressionModel

线性回归模型。

```dart
class LinearRegressionModel extends MLModel {
  LinearRegressionModel({
    double learningRate = 0.01,
    int maxIterations = 1000,
  });
}
```

**示例**:

```dart
final model = LinearRegressionModel(
  learningRate: 0.01,
  maxIterations: 1000,
);

// 准备数据
final dataset = Dataset.fromCSV('data.csv');

// 训练模型
final result = await model.train(
  dataset: dataset,
  params: HyperParameters(
    learningRate: 0.01,
    batchSize: 32,
  ),
);

print('Loss: ${result.finalLoss}');
print('Accuracy: ${result.accuracy}');

// 预测
final prediction = await model.predict([1.5, 2.3, 0.8]);
print('Prediction: ${prediction.value}');
```

## 👤 用户管理 API

### AuthService

用户认证服务。

```dart
class AuthService {
  /// 登录
  Future<User> signIn({
    required String email,
    required String password,
  });
  
  /// 注册
  Future<User> signUp({
    required String email,
    required String password,
    required String displayName,
  });
  
  /// 登出
  Future<void> signOut();
  
  /// 重置密码
  Future<void> resetPassword(String email);
  
  /// 获取当前用户
  User? get currentUser;
  
  /// 监听认证状态
  Stream<User?> get authStateChanges;
}
```

**示例**:

```dart
final authService = AuthService();

// 登录
try {
  final user = await authService.signIn(
    email: 'user@example.com',
    password: 'password123',
  );
  print('Welcome ${user.displayName}!');
} on AuthException catch (e) {
  print('Error: ${e.message}');
}

// 监听状态
authService.authStateChanges.listen((user) {
  if (user != null) {
    print('User logged in');
  } else {
    print('User logged out');
  }
});
```

### UserProfileService

用户个人资料服务。

```dart
class UserProfileService {
  /// 获取用户资料
  Future<UserProfile> getProfile(String userId);
  
  /// 更新用户资料
  Future<void> updateProfile(UserProfile profile);
  
  /// 上传头像
  Future<String> uploadAvatar(File imageFile);
  
  /// 获取学习进度
  Future<LearningProgress> getProgress(String userId);
  
  /// 更新学习进度
  Future<void> updateProgress(LearningProgress progress);
}
```

## 💾 数据存储 API

### FirestoreService

Firestore 数据库服务。

```dart
class FirestoreService<T> {
  FirestoreService({
    required String collection,
    required T Function(Map<String, dynamic>) fromJson,
    required Map<String, dynamic> Function(T) toJson,
  });
  
  /// 创建文档
  Future<String> create(T data);
  
  /// 读取文档
  Future<T?> read(String id);
  
  /// 更新文档
  Future<void> update(String id, T data);
  
  /// 删除文档
  Future<void> delete(String id);
  
  /// 查询文档
  Future<List<T>> query({
    String? where,
    dynamic isEqualTo,
    int? limit,
  });
  
  /// 实时监听
  Stream<List<T>> listen();
}
```

**示例**:

```dart
final service = FirestoreService<User>(
  collection: 'users',
  fromJson: (json) => User.fromJson(json),
  toJson: (user) => user.toJson(),
);

// 创建
final userId = await service.create(User(
  name: 'John Doe',
  email: 'john@example.com',
));

// 读取
final user = await service.read(userId);

// 查询
final activeUsers = await service.query(
  where: 'isActive',
  isEqualTo: true,
  limit: 10,
);

// 实时监听
service.listen().listen((users) {
  print('${users.length} users online');
});
```

## 📊 数据模型

### 常用数据类

```dart
// 用户
class User {
  final String id;
  final String email;
  final String displayName;
  final String? photoURL;
  
  User({
    required this.id,
    required this.email,
    required this.displayName,
    this.photoURL,
  });
}

// 学习进度
class LearningProgress {
  final String userId;
  final Map<String, int> completedLessons;
  final int totalPoints;
  final List<Achievement> achievements;
  
  LearningProgress({
    required this.userId,
    required this.completedLessons,
    required this.totalPoints,
    required this.achievements,
  });
}

// 算法状态
class AlgorithmState {
  final int currentStep;
  final List<int> array;
  final List<int> highlightedIndices;
  final String description;
  
  AlgorithmState({
    required this.currentStep,
    required this.array,
    required this.highlightedIndices,
    required this.description,
  });
}
```

## 🔔 事件系统

### EventBus

全局事件总线。

```dart
class EventBus {
  /// 发布事件
  void publish(Event event);
  
  /// 订阅事件
  StreamSubscription<T> on<T extends Event>(
    void Function(T) handler,
  );
}
```

**示例**:

```dart
// 定义事件
class AlgorithmCompleteEvent extends Event {
  final String algorithmName;
  final Duration duration;
  
  AlgorithmCompleteEvent(this.algorithmName, this.duration);
}

// 订阅事件
EventBus.instance.on<AlgorithmCompleteEvent>((event) {
  print('${event.algorithmName} completed in ${event.duration}');
});

// 发布事件
EventBus.instance.publish(
  AlgorithmCompleteEvent('BubbleSort', Duration(seconds: 5)),
);
```

## ⚙️ 配置

### AppConfig

应用配置。

```dart
class AppConfig {
  static const String apiEndpoint = 'https://api.ml-platform.com';
  static const Duration animationDuration = Duration(milliseconds: 300);
  static const int maxArraySize = 1000;
  static const double defaultSpeed = 1.0;
}
```

## 🔐 安全

### 认证 Token

所有 API 请求需要包含认证 Token:

```dart
final token = await AuthService().getIdToken();

final response = await http.get(
  Uri.parse('$apiEndpoint/user/profile'),
  headers: {
    'Authorization': 'Bearer $token',
  },
);
```

## 📚 相关资源

- [快速开始](../guide/getting-started.md)
- [核心功能](../guide/features.md)
- [开发文档](../development/)

---

*API 文档持续更新中,如有疑问请提交 Issue*
