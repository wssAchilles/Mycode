# 🎯 ML Platform - 计算机408可视化学习平台

<div align="center">

![Platform Banner](https://img.shields.io/badge/Flutter-3.10+-blue?logo=flutter)
![Firebase](https://img.shields.io/badge/Firebase-Latest-orange?logo=firebase)
![License](https://img.shields.io/badge/License-MIT-green)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

**将计算机考研核心理论转化为生动的可视化体验**

[🌐 在线演示](https://experiment-platform-cc91e.web.app) • [📱 Android APK](https://github.com/wssAchilles/Mycode/releases) • [📚 完整文档](https://wssachilles.github.io/Mycode/) • [💬 技术交流](https://github.com/wssAchilles/Mycode/discussions)

</div>

---

## 📖 项目背景与愿景

### 🎓 为什么创建这个项目?

作为一名计算机专业考研学生,我深刻体会到**理论知识的抽象性**给学习带来的挑战:
- 📚 数据结构的算法执行过程难以在脑海中具象化
- 🖥️ 操作系统的进程调度、内存管理等机制过于抽象
- 🤖 机器学习算法的数学原理与实际效果难以关联
- 📊 缺乏直观的工具来验证和理解理论知识

**ML Platform** 诞生于这样的思考:

> "如果能将课本上的每一个算法、每一个系统原理都变成可以'看见'、可以'触摸'、可以'实验'的动画,学习效率会提升多少倍?"

### 💡 项目核心价值

这不仅仅是一个可视化工具,更是:

1. **学习加速器** ⚡
   - 通过动画和交互,将学习时间缩短50%
   - 复杂算法一目了然,深化理论理解

2. **考研利器** 🎯
   - 覆盖408考研核心知识点
   - 在研究生面试中展示技术实力和学习能力

3. **工程实践范例** 🏗️
   - Flutter + Firebase现代化全栈开发
   - 真实的大型项目架构和工程经验

4. **开源教育资源** 📚
   - 为其他学习者提供免费优质的学习工具
   - 推动计算机科学教育的现代化

---

## ⭐ 项目独特优势

### 🏆 与同类项目的核心差异

#### 1. 深度与广度的完美平衡

| 对比维度 | ML Platform | 一般可视化工具 |
|---------|------------|--------------|
| **知识覆盖** | 408四大核心+机器学习 | 通常只专注单一领域 |
| **理论深度** | 深入算法本质和系统原理 | 停留在表面演示 |
| **技术栈现代化** | Flutter+Firebase云端架构 | 多为传统Web技术 |
| **交互性** | 完全可控的参数调整 | 预设演示为主 |
| **工程价值** | 真实全栈项目经验 | Demo性质 |

#### 2. 三合一的学习工具矩阵

```text
┌─────────────────────────────────────────────────┐
│  模块一：算法与数据结构可视化                        │
│  ├─ 10+ 排序算法动画                              │
│  ├─ 树、图、链表等数据结构操作                     │
│  └─ 复杂度分析与性能对比                          │
├─────────────────────────────────────────────────┤
│  模块二：操作系统经典算法模拟器                      │
│  ├─ 进程调度算法 (6种+)                          │
│  ├─ 内存管理与页面置换                            │
│  └─ 死锁检测与银行家算法                          │
├─────────────────────────────────────────────────┤
│  模块三：机器学习模型实验平台                        │
│  ├─ 监督学习 (6种算法)                           │
│  ├─ 无监督学习 (5种算法)                         │
│  └─ 云端训练与结果可视化                          │
└─────────────────────────────────────────────────┘
```

#### 3. 考研面试的"杀手锏"

- ✅ **理论理解的证明**: 能做出算法可视化,说明你真正理解了算法
- ✅ **工程能力的展示**: 跨平台应用+云服务+动画性能优化
- ✅ **创新思维的体现**: 将理论教育与现代技术结合的创新尝试
- ✅ **持续学习的态度**: 涵盖前沿机器学习技术

#### 4. 技术实现的突破性

**高性能动画引擎**
```dart
// 支持1000+数据规模,60FPS流畅动画
- CustomPaint底层绘制优化
- 智能帧调度与重绘策略
- 异步计算与主线程分离
```

**云端计算架构**
```python
// 复杂ML算法在Firebase Cloud Functions中执行
- 前端轻量化,后端强计算
- Python科学计算生态完整支持
- 自动扩展,无需维护服务器
```

**跨平台一致性**
```text
一份代码 → Web + Android + iOS + Desktop
Flutter强大的跨平台能力保证体验统一
```

---

## 🎨 核心功能详解

### 模块一：算法与数据结构可视化 🔄

#### 排序算法可视化矩阵

| 算法类型 | 实现算法 | 可视化特性 |
|---------|---------|-----------|
| **基础排序** | 冒泡、选择、插入 | 逐步比较交换动画 |
| **高级排序** | 快速、归并、堆 | 递归过程树状展示 |
| **特殊排序** | 计数、桶、基数 | 桶分配过程可视化 |

**核心交互功能:**
- 🎮 播放/暂停/单步执行控制
- ⚡ 动画速度调节 (0.5x ~ 5x)
- 📊 实时性能指标展示
- 🎨 当前比较元素高亮标记
- 📝 算法步骤文字说明

#### 数据结构操作可视化

**线性结构**
```text
栈 (Stack)          队列 (Queue)         链表 (Linked List)
┌───┐              ┌───┬───┬───┐       ┌───┐  ┌───┐  ┌───┐
│ 3 │ ← top       │ 1 │ 2 │ 3 │       │ 1 │→│ 2 │→│ 3 │
├───┤              └───┴───┴───┘       └───┘  └───┘  └───┘
│ 2 │                ↑       ↑         
├───┤              front   rear        
│ 1 │                
└───┘                                  
```

**树形结构**
- 二叉搜索树 (BST): 插入/删除/查找动画
- AVL树: 左旋/右旋自平衡过程
- B树/B+树: 节点分裂/合并可视化
- 堆: 上浮/下沉调整动画

**图结构**
- 图的表示: 邻接矩阵 ⇄ 邻接表转换
- DFS/BFS: 遍历路径高亮显示
- 最短路径: Dijkstra/Floyd动态演示
- 最小生成树: Prim/Kruskal边权重标注

---

### 模块二：操作系统经典算法模拟器 🖥️

#### 进程调度可视化

```text
时间轴甘特图示例:
  0    5    10   15   20   25
  |────|────|────|────|────|
P1 [████████░░░░░░░░░░░░░░░]  完成
P2 [░░░░░░░░████████░░░░░░░]  运行中
P3 [░░░░░░░░░░░░░░░░████████]  等待

性能指标:
• 平均等待时间: 8.5ms
• 平均周转时间: 15.2ms
• CPU利用率: 95%
```

**支持的调度算法:**
1. **FCFS** (先来先服务) - 理解队列FIFO原理
2. **SJF** (最短作业优先) - 贪心策略的应用
3. **Priority** (优先级调度) - 优先级队列实现
4. **Round Robin** (时间片轮转) - 公平性保证
5. **多级队列** - 不同优先级分离
6. **多级反馈队列** - 动态优先级调整

#### 内存管理可视化

**连续内存分配**
```text
内存布局示意:
┌──────────────────────┐ 0x0000
│   操作系统 (固定)      │
├──────────────────────┤ 0x1000
│   进程A (50KB)        │
├──────────────────────┤
│   空闲 (20KB)  ← 空洞  │
├──────────────────────┤
│   进程B (80KB)        │
├──────────────────────┤
│   空闲 (100KB)        │
└──────────────────────┘
```

- **首次适应 (First Fit)**: 找到第一个足够大的空闲块
- **最佳适应 (Best Fit)**: 找最小的满足空闲块
- **最坏适应 (Worst Fit)**: 找最大的空闲块
- **伙伴系统 (Buddy)**: 2的幂次方分配

**页面置换算法**
```text
页面访问序列: 1,2,3,4,1,2,5,1,2,3,4,5

FIFO算法:
[1] [2] [3] [4] [1] [2] [5] ... 
 ↓   ↓   ↓   ↓
缺页 缺页 缺页 缺页 ...

LRU算法:
维护访问时间戳,淘汰最久未使用
```

#### 死锁检测与避免 - 银行家算法

```text
资源分配状态:
        Max   Allocation  Need  Available
    A B C  A B C      A B C    A B C
P0  7 5 3  0 1 0      7 4 3
P1  3 2 2  2 0 0      1 2 2    3 3 2
P2  9 0 2  3 0 2      6 0 0
P3  2 2 2  2 1 1      0 1 1
P4  4 3 3  0 0 2      4 3 1

安全序列检查: P1 → P3 → P4 → P0 → P2 ✓
```

---

### 模块三：机器学习模型实验平台 🤖

#### 完整的ML工作流

```text
数据上传 → 数据预处理 → 模型选择 → 参数调优 → 训练执行 → 结果分析
   ↓          ↓           ↓          ↓          ↓          ↓
 CSV文件   特征工程    算法库     超参数     Cloud      可视化
                                           Functions   图表
```

#### 监督学习算法库

| 算法 | 适用场景 | 可调参数 | 输出结果 |
|------|---------|---------|---------|
| **线性回归** | 连续值预测 | 学习率、正则化 | 拟合曲线、R²值 |
| **逻辑回归** | 二分类问题 | 迭代次数、正则化 | 决策边界、AUC |
| **决策树** | 分类/回归 | 最大深度、最小样本 | 树结构可视化 |
| **随机森林** | 集成学习 | 树数量、特征数 | 特征重要性图 |
| **SVM** | 复杂分类 | 核函数、C参数 | 支持向量展示 |
| **KNN** | 非参数方法 | K值、距离度量 | 邻居关系图 |

#### 无监督学习可视化

**K-Means聚类动画**
```text
迭代过程:
Step 1: 随机初始化K个中心点
Step 2: 分配数据点到最近中心
Step 3: 重新计算中心点位置
Step 4: 重复2-3直到收敛

可视化: 散点图 + 动态中心点移动轨迹
```

**降维可视化 (PCA/t-SNE)**
- 高维数据投影到2D/3D
- 实时交互旋转查看
- 聚类效果直观展示

#### 云端训练架构

```python
# Firebase Cloud Function (Python)
@functions_framework.http
def train_ml_model(request):
    # 1. 从Storage读取数据集
    dataset = load_from_storage(request.dataset_url)
    
    # 2. 数据预处理
    X_train, X_test, y_train, y_test = preprocess(dataset)
    
    # 3. 模型训练
    model = sklearn.ensemble.RandomForestClassifier()
    model.fit(X_train, y_train)
    
    # 4. 评估与可视化
    metrics = evaluate_model(model, X_test, y_test)
    visualization = generate_plots(model, X_test, y_test)
    
    # 5. 返回结果到前端
    return {
        'metrics': metrics,
        'plots': visualization,
        'model_info': model.get_params()
    }
```

---

## 🏗️ 技术架构深度解析

### 系统架构图

```text
┌─────────────────────────────────────────────────────────────┐
│                    前端层 (Flutter)                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  UI Layer (Material Design)                          │  │
│  │  - SortingScreen  - DataStructureScreen             │  │
│  │  - OSSimulator    - MLExperimentScreen               │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  State Management (Provider/Riverpod)                │  │
│  │  - VisualizationController                           │  │
│  │  - AlgorithmState  - ExperimentState                 │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  Custom Visualization Engine                         │  │
│  │  - AlgorithmPainter (CustomPaint)                    │  │
│  │  - AnimationController & Tweens                      │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  Service Layer                                       │  │
│  │  - FirebaseService  - AlgorithmService               │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────↕ HTTPS/WebSocket ───────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                Firebase 云服务层 (BaaS)                      │
│  ┌──────────────┬──────────────┬──────────────────────┐   │
│  │Authentication│  Firestore   │  Cloud Storage       │   │
│  │ 用户认证      │  NoSQL数据库  │  文件存储            │   │
│  │              │              │  /datasets/          │   │
│  │  - Email/PW  │  - users/    │  /results/           │   │
│  │  - Anonymous │  - exps/     │  /models/            │   │
│  └──────────────┴──────────────┴──────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Cloud Functions (Python + Node.js)           │  │
│  │  - trainMLModel()  - scheduleProcesses()             │  │
│  │  - analyzeComplexity()  - simulateOSAlgorithm()      │  │
│  │                                                       │  │
│  │  环境: Python 3.11 + scikit-learn + pandas           │  │
│  └────────────────────────────────────────────────���─────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 核心技术选型理由

#### ✅ Flutter - 为什么是最佳选择?

1. **跨平台优势**
   - ✨ 一次开发,全平台部署 (Web + Android + iOS + Desktop)
   - 🚀 接近原生性能 (60fps+ 流畅动画)
   - 💰 显著降低开发和维护成本

2. **强大的可视化能力**
   - 🎨 CustomPaint 提供底层绘制控制
   - ⚡ 硬件加速的Canvas API
   - 🎬 丰富的动画系统 (Tween, Curve, AnimationController)

3. **现代化开发体验**
   - 🔥 Hot Reload 实时预览
   - 📦 丰富的包生态系统
   - 🛡️ 强类型Dart语言,减少运行时错误

#### ✅ Firebase - 云端BaaS的完美搭档

1. **开发效率提升**
   - ⚡ 无需搭建服务器,专注业务逻辑
   - 🔐 内置认证系统,安全可靠
   - 📊 实时数据库,自动同步

2. **成本优化**
   - 💵 免费套餐慷慨 (适合开发和小规模使用)
   - 📈 按需付费,弹性扩展
   - 🎯 只为实际使用付费

3. **强大的计算能力**
   - 🐍 Cloud Functions支持Python
   - 📚 scikit-learn等ML库开箱即用
   - ⚙️ 自动扩容,无需运维

### 项目文件结构

```text
ml_platform/
├── lib/
│   ├── main.dart                    # 应用入口 + Firebase初始化
│   ├── models/                      # 数据模型
│   │   ├── algorithm_model.dart
│   │   ├── process_model.dart
│   │   └── ml_experiment_model.dart
│   ├── providers/                   # 状态管理
│   │   ├── visualization_provider.dart
│   │   └── experiment_provider.dart
│   ├── services/                    # 业务逻辑
│   │   ├── firebase_service.dart
│   │   ├── algorithm_service.dart
│   │   └── ml_service.dart
│   ├── widgets/                     # 可复用组件
│   │   ├── algorithm_visualizer.dart
│   │   ├── chart_widgets.dart
│   │   └── control_panel.dart
│   ├── screens/                     # 页面
│   │   ├── home_screen.dart
│   │   ├── sorting_screen.dart
│   │   ├── os_simulator_screen.dart
│   │   └── ml_experiment_screen.dart
│   └── utils/                       # 工具类
│       ├── animation_utils.dart
│       └── chart_helpers.dart
├── functions/                       # Cloud Functions
│   ├── python/                      # Python函数
│   │   ├── ml_train.py
│   │   └── requirements.txt
│   └── node/                        # Node.js函数
│       ├── os_simulator.js
│       └── package.json
├── android/                         # Android配置
│   └── app/
│       └── google-services.json     # Firebase配置
├── web/                             # Web配置
│   └── index.html                   # Firebase Web SDK
└── pubspec.yaml                     # Flutter依赖

## 📊 项目优势与价值

### 学术价值
- **理论与实践结合**：将抽象的计算机理论转化为直观的交互体验
- **知识系统化**：覆盖计算机考研核心知识点，形成完整学习体系
- **深度理解促进**：通过可视化加深对算法本质和系统原理的理解
- **研究能力培养**：实验设计与结果分析培养科研思维

### 技术价值
- **全栈能力展示**：前端动效、后端服务、云计算的综合应用
- **性能优化示范**：高效渲染与计算的技术实践
- **架构设计案例**：模块化设计与可扩展系统架构
- **工程实践探索**：大型Flutter项目的最佳实践与经验沉淀

### 教育价值
- **降低学习门槛**：复杂理论的可视化理解，减轻认知负担
- **提高学习效率**：交互式实验加速知识内化过程
- **激发学习兴趣**：生动的视觉体验提升学习动力
- **个性化学习路径**：基于进度和表现的智能推荐系统

---

## 🚀 快速开始

### 📋 环境要求

| 工具 | 最低版本 | 推荐版本 | 说明 |
|------|---------|---------|------|
| Flutter SDK | 3.10.0 | 3.16+ | 跨平台UI框架 |
| Dart | 3.0.0 | 3.2+ | 编程语言 |
| Firebase CLI | 11.0.0 | Latest | 云服务管理 |
| IDE | - | VS Code / Android Studio | 开发环境 |

### 🛠️ 安装与运行

#### 1. 克隆项目

```bash
git clone https://github.com/wssAchilles/Mycode.git
cd Mycode/ml_platform
```

#### 2. 安装依赖

```bash
# 获取Flutter依赖包
flutter pub get

# 验证Flutter环境
flutter doctor
```

#### 3. Firebase配置

```bash
# 登录Firebase
firebase login

# 关联Firebase项目 (项目ID: 408-experiment-platform)
flutterfire configure
```

#### 4. 运行应用

```bash
# Web版 (推荐用于快速预览)
flutter run -d chrome

# Android版 (需要模拟器或真机)
flutter run -d android

# Windows桌面版
flutter run -d windows
```

### ⚙️ Firebase手动配置 (可选)

如果自动配置失败,可以手动配置:

1. **Android配置**
   - 下载 `google-services.json`
   - 放置到 `android/app/` 目录

2. **Web配置**
   - 在 `web/index.html` 中添加Firebase配置
   - 参考项目中的配置示例

3. **Cloud Functions配置**
   - 进入 `functions/` 目录
   - 运行 `firebase deploy --only functions`

### 🎮 使用指南

#### 算法可视化模块

1. 选择"排序算法"菜单
2. 从下拉列表选择算法 (如:快速排序)
3. 调整数据规模 (建议从50开始)
4. 点击"开始可视化"观看动画
5. 使用控制面板调整速度/暂停/单步执行

#### 操作系统模拟器

1. 选择"进程调度"模块
2. 添加进程 (设置到达时间、服务时间)
3. 选择调度算法 (如:SJF)
4. 查看甘特图和性能指标

#### 机器学习实验

1. 上传CSV数据集
2. 选择算法 (如:K-Means)
3. 调整超参数
4. 点击"开始训练"
5. 等待Cloud Function返回结果
6. 查看可视化图表

---

## � 项目价值与成果

### 🎓 学术价值

1. **理论深度证明**
   - 能实现算法可视化 = 深刻理解算法本质
   - 系统模拟展现计算机系统思维
   - 机器学习实践体现前沿技术跟踪

2. **研究能力培养**
   - 文献调研 → 理论学习 → 工程实现 → 效果评估
   - 完整的科研流程训练

3. **知识体系构建**
   - 将408四大核心课程串联成完整知识网络
   - 理论与实践深度融合

### 💼 工程价值

1. **全栈开发能力**
   - 前端: Flutter UI + 动画系统
   - 后端: Firebase + Cloud Functions
   - 数据: Firestore + Storage

2. **性能优化经验**
   - 60FPS动画渲染优化
   - 大规模数据处理
   - 异步编程实践

3. **项目管理经验**
   - 需求分析与架构设计
   - 模块化开发与版本控制
   - 测试与持续集成

### 🏆 展示价值

**在考研复试中的亮点:**

- ✨ **视觉冲击**: 动态可视化比PPT更有说服力
- 🎯 **技术深度**: 跨平台 + 云服务 + 机器学习的技术广度
- 💡 **创新思维**: 将传统教育与现代技术结合
- 📈 **成长潜力**: 持续学习和技术探索的证明

**可量化的成果指标:**

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 支持算法数量 | 20+ | 覆盖考研核心算法 |
| 代码规模 | 10,000+ 行 | 体现工程量 |
| 性能指标 | 60FPS | 流畅动画体验 |
| GitHub Star | 100+ | 社区认可度 |
| 技术博客 | 5+ 篇 | 技术沉淀 |

---

## 📈 未来规划

### 🎯 短期目标 (3个月内)

- [ ] 完成10种排序算法可视化
- [ ] 实现5种进程调度算法模拟
- [ ] 集成6种监督学习算法
- [ ] 发布在线Demo版本
- [ ] 编写技术博客系列

### 🚀 中期目标 (6个月内)

- [ ] 添加计算机网络模块 (TCP/IP可视化)
- [ ] 扩展到编译原理 (词法/语法分析)
- [ ] 支持用户上传自定义算法
- [ ] 实现学习进度追踪系统
- [ ] 达成GitHub 100+ Star

### 🌟 长期愿景 (12个月)

- [ ] 构建完整的408知识可视化体系
- [ ] 引入AI辅助讲解功能
- [ ] 支持3D/VR沉浸式学习体验
- [ ] 建立开源社区和贡献者生态
- [ ] 探索商业化教育应用可能性

---

## 🤝 参与贡献

这是一个开放的教育项目,欢迎所有人参与!

### 贡献方式

1. **代码贡献**
   - Fork本项目
   - 创建feature分支 (`git checkout -b feature/AmazingFeature`)
   - 提交更改 (`git commit -m 'Add some AmazingFeature'`)
   - 推送到分支 (`git push origin feature/AmazingFeature`)
   - 开启Pull Request

2. **内容贡献**
   - 新增算法可视化
   - 优化现有动画效果
   - 编写技术文档
   - 制作教学视频

3. **反馈贡献**
   - 报告Bug (Issues)
   - 提出改进建议
   - 分享使用体验

### 贡献者名单

感谢所有为这个项目做出贡献的开发者! 🙏

<!-- ALL-CONTRIBUTORS-LIST:START -->
<!-- 自动生成贡献者列表 -->
<!-- ALL-CONTRIBUTORS-LIST:END -->

---

## 📞 联系方式

### 项目作者

- **姓名**: 许子祺 (Xu Ziqi)
- **学校**: czust
- **专业**: 计算机科学与技术
- **GitHub**: [@wssAchilles](https://github.com/wssAchilles)
- **邮箱**: xzqnbcj666@gmail.com

### 项目资源

- 📖 **在线文档**: [文档中心](https://wssachilles.github.io/Mycode/)
- 🎬 **视频演示**: [待录制]
- 💬 **讨论区**: [GitHub Discussions](https://github.com/wssAchilles/Mycode/discussions)
- 🐛 **问题反馈**: [GitHub Issues](https://github.com/wssAchilles/Mycode/issues)

---

## 📄 开源协议

本项目采用 **MIT License** 开源协议。

这意味着你可以:
- ✅ 商业使用
- ✅ 修改代码
- ✅ 分发软件
- ✅ 私人使用

但需要:
- 📝 保留版权声明
- 📝 包含许可证副本

详见 [LICENSE](LICENSE) 文件。

---

## � 致谢

### 技术框架
- [Flutter](https://flutter.dev/) - Google的开源UI框架
- [Firebase](https://firebase.google.com/) - Google的云服务平台
- [scikit-learn](https://scikit-learn.org/) - Python机器学习库

### 灵感来源
- [VisuAlgo](https://visualgo.net/) - 算法可视化先驱
- [Algorithm Visualizer](https://algorithm-visualizer.org/) - 开源可视化项目
- 所有开源教育项目的贡献者

### 特别鸣谢
- 感谢所有给予建议和支持的老师、同学和朋友
- 感谢开源社区的无私奉献精神

---

<div align="center">

## 💡 项目理念

**"让抽象的理论变得具象,让枯燥的学习变得有趣"**

这不仅是一个技术项目,更是对计算机科学教育的一次探索与创新。

如果这个项目对你有帮助,请给个 ⭐ Star 支持一下!

**🚀 一起让计算机学习变得更有趣!**

</div>

---

<div align="center">
<sub>Built with ❤️ by <a href="https://github.com/wssAchilles">Xu Ziqi</a> for CS learners worldwide</sub>
</div>
