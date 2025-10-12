# API 参考

欢迎来到 ML Platform 的 API 文档。本节提供了项目中各个模块的 API 参考。

## 📚 模块概览

### 算法可视化 API

提供排序算法、数据结构操作的可视化接口。

- [算法 API 详情](./algorithms.md)

### 操作系统模拟器 API

提供进程调度、内存管理等操作系统算法的模拟接口。

- [OS 模拟器 API 详情](./os-simulator.md)

### 机器学习服务 API

提供机器学习模型训练和预测的云端服务接口。

- [ML 服务 API 详情](./ml-service.md)

## 🔧 使用指南

所有 API 都基于 Flutter 的服务层实现,通过依赖注入的方式使用。

### 基本用法

```dart
// 1. 导入服务
import 'package:ml_platform/services/algorithm_service.dart';

// 2. 获取服务实例
final algorithmService = AlgorithmService();

// 3. 调用方法
final result = await algorithmService.sortArray(
  data: [5, 2, 8, 1, 9],
  algorithm: SortAlgorithm.quickSort,
);
```

## 📖 文档约定

### 参数类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `List<int>` | 整数列表 | `[1, 2, 3]` |
| `SortAlgorithm` | 排序算法枚举 | `SortAlgorithm.quickSort` |
| `Future<T>` | 异步返回值 | `Future<List<int>>` |
| `Stream<T>` | 数据流 | `Stream<SortStep>` |

### 返回值

所有异步方法返回 `Future`,需要使用 `await` 或 `.then()` 处理。

### 错误处理

所有方法都可能抛出异常,建议使用 `try-catch` 包裹:

```dart
try {
  final result = await service.someMethod();
} catch (e) {
  print('Error: $e');
}
```

## 🚀 快速导航

- [算法 API](./algorithms.md) - 排序、搜索、数据结构
- [OS 模拟器 API](./os-simulator.md) - 进程调度、内存管理
- [ML 服务 API](./ml-service.md) - 模型训练、预测

---

::: tip 提示
API 文档正在持续完善中,欢迎贡献!
:::
