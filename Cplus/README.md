# C++ 算法与数据结构学习项目

这个项目包含了C++算法与数据结构的学习实现，主要涵盖线性遍历、前缀和算法、STL标准库等重要概念。

## 📁 项目结构

```
Cplus/
├── Linear Traversal/          # 线性遍历算法
│   └── example.cpp           # 线性遍历示例代码
├── Prefix Sum/               # 前缀和算法
│   └── example.cpp           # 前缀和详细实现与应用
├── STL/                      # C++ STL 标准库
│   └── 1.cpp                # STL基础模板
├── CppProperties.json        # VS Code C++配置文件
└── README.md                 # 项目说明文档
```

## 🚀 功能特性

### 1. 线性遍历算法 (Linear Traversal)
- **最大元素查找**: 遍历数组找到最大值
- **条件计数**: 统计满足条件的元素个数
- **元素搜索**: 线性搜索特定元素
- **数组求和**: 计算所有元素的总和

**关键特点**:
- 时间复杂度: O(n)
- 空间复杂度: O(1)
- 适用于无序数组的基本操作

### 2. 前缀和算法 (Prefix Sum)
一个功能完整的前缀和算法实现，包含多种应用场景：

#### 核心功能:
- **一维前缀和**: 快速区间求和查询
- **二维前缀和**: 子矩阵求和查询
- **差分数组**: 区间批量更新操作
- **应用实例**: 最大子数组和等经典问题

#### 算法复杂度:
- **预处理时间**: O(n) 或 O(m×n)
- **查询时间**: O(1)
- **空间复杂度**: O(n) 或 O(m×n)

#### 主要类和方法:
```cpp
class PrefixSum {
    PrefixSum(const vector<int>& nums);     // 构造函数
    int rangeSum(int left, int right);      // 区间查询
    void printPrefixSum();                  // 调试输出
};

class PrefixSum2D {
    PrefixSum2D(const vector<vector<int>>& matrix);
    int rangeSum(int row1, int col1, int row2, int col2);
};
```

### 3. STL 标准库 (STL)
- 提供STL学习的基础模板文件
- 包含常用头文件引入

## 📚 学习要点

### 线性遍历核心概念:
1. **遍历策略**: 顺序访问每个元素
2. **时间优化**: 单次遍历完成多个任务
3. **边界处理**: 正确处理空数组和边界情况
4. **现代C++**: 使用范围for循环提高代码可读性

### 前缀和算法精要:
1. **基本原理**: `prefixSum[i] = nums[0] + nums[1] + ... + nums[i-1]`
2. **区间查询**: `sum(l,r) = prefixSum[r+1] - prefixSum[l]`
3. **二维扩展**: 利用容斥原理计算子矩阵和
4. **差分数组**: 前缀和的逆运算，支持高效区间更新
5. **应用场景**: 频繁的区间查询、子数组问题、动态规划优化

## 🛠️ 编译与运行

### 环境要求
- C++11 或更高版本
- 支持C++11的编译器 (GCC, Clang, MSVC)

### 编译命令
```bash
# 编译线性遍历示例
g++ -std=c++11 -o linear_traversal "Linear Traversal/example.cpp"

# 编译前缀和示例
g++ -std=c++11 -o prefix_sum "Prefix Sum/example.cpp"

# 运行程序
./linear_traversal
./prefix_sum
```

### VS Code 配置
项目包含 `CppProperties.json` 配置文件，支持：
- IntelliSense 智能提示
- 语法高亮
- 错误检测
- 代码格式化

## 🎯 实际应用场景

### 线性遍历适用场景:
- 数据统计分析
- 数组预处理
- 简单搜索任务
- 基础算法的构建块

### 前缀和适用场景:
- **区间查询密集型应用**: 多次查询数组区间和
- **二维数据分析**: 图像处理、矩阵计算
- **动态规划优化**: 降低状态转移复杂度
- **实时数据分析**: 滑动窗口统计

## 📊 算法复杂度对比

| 算法类型 | 预处理时间 | 查询时间 | 空间复杂度 | 适用场景 |
|---------|-----------|----------|-----------|----------|
| 线性遍历 | - | O(n) | O(1) | 单次查询 |
| 前缀和 | O(n) | O(1) | O(n) | 多次区间查询 |
| 二维前缀和 | O(m×n) | O(1) | O(m×n) | 二维区间查询 |

## 🔍 代码示例

### 快速上手 - 前缀和基本用法:
```cpp
#include <iostream>
#include <vector>
using namespace std;

// 使用项目中的PrefixSum类
vector<int> nums = {1, 3, 5, 7, 9, 2, 4};
PrefixSum ps(nums);

// 查询区间 [1, 3] 的和 (即 3+5+7 = 15)
cout << ps.rangeSum(1, 3) << endl;  // 输出: 15
```

## 🧪 测试用例

### 线性遍历测试:
- 空数组处理
- 单元素数组
- 重复元素情况
- 边界值测试

### 前缀和测试:
- 正数数组
- 包含负数的数组
- 全零数组
- 二维矩阵边界情况

## 🤝 学习建议

1. **循序渐进**: 先掌握线性遍历，再学习前缀和
2. **动手实践**: 运行代码，观察输出结果
3. **举一反三**: 尝试修改参数，测试不同场景
4. **算法分析**: 理解时间和空间复杂度的权衡
5. **应用拓展**: 思考算法在实际项目中的应用

## 📖 相关资源

- [C++ STL官方文档](https://en.cppreference.com/w/cpp/container)
- [算法导论 - 前缀和相关章节](https://mitpress.mit.edu/books/introduction-algorithms)
- [LeetCode 前缀和专题](https://leetcode.com/tag/prefix-sum/)

---

**项目目标**: 通过实践加深对C++基础算法的理解，为更复杂的数据结构和算法学习打下坚实基础。
