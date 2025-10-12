---
layout: home

hero:
  name: "ML Platform"
  text: "计算�?08可视化学习平�?
  tagline: 让抽象的理论变得具象,让枯燥的学习变得有趣
  image:
    src: https://img.shields.io/badge/Flutter-3.10+-blue?logo=flutter
    alt: ML Platform
  actions:
    - theme: brand
      text: 快速开�?
      link: /guide/getting-started
    - theme: alt
      text: 在线演示
      link: https://experiment-platform-cc91e.web.app
    - theme: alt
      text: GitHub
      link: https://github.com/wssAchilles/Mycode

features:
  - icon: 🎨
    title: 算法可视�?
    details: 10+ 种排序算法的动态可视化,支持暂停、单步执行、速度调节。深入理解算法的执行过程和时间复杂度�?
  
  - icon: 🖥�?
    title: 操作系统模拟�?
    details: 进程调度、内存管理、死锁检测等经典算法的交互式模拟。通过甘特图和动画理解系统原理�?
  
  - icon: 🤖
    title: 机器学习平台
    details: 云端训练、实时可视化。支持监督学习、无监督学习多种算法,完整�?ML 工作流体验�?
  
  - icon: 🚀
    title: 跨平台支�?
    details: 基于 Flutter 构建,一次开�?全平台运行。支�?Web、Android、iOS、Windows 等多个平台�?
  
  - icon: �?
    title: 高性能动画
    details: 使用 CustomPaint 底层绘制,60FPS 流畅动画。支�?1000+ 数据规模的可视化渲染�?
  
  - icon: ☁️
    title: 云端架构
    details: Firebase 云服务支�?无需服务器维护。Cloud Functions 提供强大的后端计算能力�?
---

## 🎯 为什么选择 ML Platform?

<div class="features-grid">

### 📚 全面覆盖
涵盖计算机考研 408 核心知识�?数据结构、算法、操作系统、机器学�?形成完整的学习体系�?

### 🎓 考研利器
通过可视化加深理论理�?在面试中展示技术实力。不仅是学习工具,更是能力证明�?

### 🏗�?工程实践
真实的全栈项目经�?Flutter + Firebase 现代化技术栈,大型项目架构设计能力培养�?

### 🌟 开源教�?
免费开�?任何人都可以使用、学习和贡献。推动计算机科学教育的现代化�?

</div>

## 🚀 快速体�?

::::code-group

```bash [克隆项目]
git clone https://github.com/wssAchilles/Mycode.git
cd ml_platform
```

```bash [安装依赖]
flutter pub get
```

```bash [运行应用]
flutter run -d chrome
```

::::

## 📊 项目亮点

<div class="stats">

<div class="stat-item">
  <div class="stat-number">30+</div>
  <div class="stat-label">算法实现</div>
</div>

<div class="stat-item">
  <div class="stat-number">60 FPS</div>
  <div class="stat-label">流畅动画</div>
</div>

<div class="stat-item">
  <div class="stat-number">10,000+</div>
  <div class="stat-label">代码行数</div>
</div>

<div class="stat-item">
  <div class="stat-number">5</div>
  <div class="stat-label">支持平台</div>
</div>

</div>

## 🎬 功能演示

### 算法可视�?

观看排序算法的执行过�?理解时间复杂度和空间复杂�?

- 🔄 **实时动画**: 元素比较和交换过程动态展�?
- 📊 **性能对比**: 多种算法同时运行对比
- 🎮 **交互控制**: 播放、暂停、单步、调�?

### 操作系统模拟

模拟经典的操作系统算�?

- 📅 **进程调度**: FCFS、SJF、RR、优先级�?
- 💾 **内存管理**: 首次适应、最佳适应、LRU、FIFO
- 🔒 **死锁处理**: 银行家算法安全性检�?

### 机器学习实验

完整�?ML 实验流程:

- 📤 **数据上传**: 支持 CSV 格式数据�?
- ⚙️ **参数调优**: 交互式调整超参数
- ☁️ **云端训练**: Firebase Functions 后端计算
- 📈 **结果可视�?*: 实时图表和性能指标

## 💡 学习路径

```mermaid
graph LR
    A[基础排序算法] --> B[高级数据结构]
    B --> C[操作系统原理]
    C --> D[机器学习算法]
    D --> E[项目实战]
```

## 🤝 参与贡献

这是一个开放的教育项目,欢迎所有人参与!

- 🐛 **报告 Bug**: [提交 Issue](https://github.com/wssAchilles/Mycode/issues)
- �?**贡献代码**: [创建 Pull Request](https://github.com/wssAchilles/Mycode/pulls)
- 📝 **改进文档**: 帮助完善文档
- 💬 **技术讨�?*: [参与讨论](https://github.com/wssAchilles/Mycode/discussions)

## 📞 联系我们

- **GitHub**: [@wssAchilles](https://github.com/wssAchilles)
- **Email**: xzqnbcj666@gmail.com
- **在线 Demo**: [experiment-platform-cc91e.web.app](https://experiment-platform-cc91e.web.app)

---

<div class="footer-cta">

### 准备好开始了�?

[快速开�?→](/guide/getting-started){ .button }
[查看源码 →](https://github.com/wssAchilles/Mycode){ .button .secondary }

</div>

<style>
.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 2rem;
  margin: 2rem 0;
}

.features-grid h3 {
  margin-top: 0;
}

.stats {
  display: flex;
  justify-content: space-around;
  flex-wrap: wrap;
  margin: 3rem 0;
  gap: 2rem;
}

.stat-item {
  text-align: center;
  padding: 1.5rem;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}

.stat-number {
  font-size: 2.5rem;
  font-weight: bold;
  color: var(--vp-c-brand);
  margin-bottom: 0.5rem;
}

.stat-label {
  font-size: 1rem;
  color: var(--vp-c-text-2);
}

.footer-cta {
  text-align: center;
  margin: 4rem 0;
  padding: 2rem;
  background: var(--vp-c-bg-soft);
  border-radius: 12px;
}

.footer-cta h3 {
  margin-bottom: 1.5rem;
}

.button {
  display: inline-block;
  padding: 0.75rem 1.5rem;
  margin: 0 0.5rem;
  background: var(--vp-c-brand);
  color: white;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 500;
  transition: all 0.3s;
}

.button:hover {
  background: var(--vp-c-brand-dark);
  transform: translateY(-2px);
}

.button.secondary {
  background: var(--vp-c-bg-mute);
  color: var(--vp-c-text-1);
}

.button.secondary:hover {
  background: var(--vp-c-gray-light-2);
}
</style>
