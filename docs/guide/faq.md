# 常见问题

## 安装问题

### Flutter Doctor 检查失败怎么办?

**问题**: 运行 `flutter doctor` 时出现错误

**解决方案**:

1. **Android toolchain 问题**
   ```powershell
   # 安装 Android SDK
   # 在 Android Studio 中安装 SDK Tools
   flutter doctor --android-licenses
   ```

2. **Visual Studio 问题** (Windows)
   ```powershell
   # 安装 Visual Studio 2022
   # 勾选 "使用C++的桌面开发"
   ```

3. **Chrome 未检测到**
   ```powershell
   # 设置 Chrome 路径
   $env:CHROME_EXECUTABLE = "C:\Program Files\Google\Chrome\Application\chrome.exe"
   ```

### Firebase 配置失败

**问题**: `flutterfire configure` 命令失败

**解决方案**:

```powershell
# 1. 确保已登录
firebase login

# 2. 检查 Firebase CLI 版本
firebase --version

# 3. 如果版本太旧,更新
npm install -g firebase-tools

# 4. 重新配置
flutterfire configure
```

### 依赖安装失败

**问题**: `flutter pub get` 报错

**解决方案**:

```powershell
# 1. 清理缓存
flutter clean
flutter pub cache repair

# 2. 删除 pubspec.lock
rm pubspec.lock

# 3. 重新获取依赖
flutter pub get
```

## 运行问题

### Web 版本无法加载

**问题**: 运行 Web 版时页面空白或报错

**解决方案**:

1. **检查浏览器控制台**
   - 按 F12 查看错误信息
   - 常见错误是 CORS 问题

2. **使用正确的运行命令**
   ```powershell
   flutter run -d chrome --web-renderer html
   ```

3. **清理并重新构建**
   ```powershell
   flutter clean
   flutter pub get
   flutter run -d chrome
   ```

### Android 应用崩溃

**问题**: Android 应用启动后立即崩溃

**可能原因**:

1. **Firebase 配置错误**
   - 检查 `android/app/google-services.json` 是否存在
   - 确认包名是否匹配

2. **依赖冲突**
   ```powershell
   cd android
   ./gradlew clean
   cd ..
   flutter clean
   flutter run
   ```

3. **查看日志**
   ```powershell
   flutter logs
   ```

### Windows 桌面版编译失败

**问题**: Windows 版本无法编译

**解决方案**:

```powershell
# 确保安装了 Visual Studio 2022
# 包含 C++ 桌面开发工具

# 清理并重新构建
flutter clean
flutter pub get
flutter build windows
```

## 功能问题

### 算法可视化卡顿

**问题**: 动画不流畅,掉帧严重

**优化建议**:

1. **减少数据规模**
   - 从 50 个元素开始测试
   - 逐步增加到 100-200

2. **降低动画速度**
   - 使用速度调节器
   - 给系统更多渲染时间

3. **关闭调试模式**
   ```powershell
   # 使用 release 模式
   flutter run --release
   ```

### Firebase 连接超时

**问题**: 上传数据集或训练模型时超时

**解决方案**:

1. **检查网络连接**
   ```powershell
   ping firebase.google.com
   ```

2. **检查 Firebase 配置**
   - 确认项目 ID 正确
   - 检查 Firestore 规则

3. **使用国内镜像** (如果需要)
   ```powershell
   # 设置 pub 镜像
   $env:PUB_HOSTED_URL = "https://pub.flutter-io.cn"
   $env:FLUTTER_STORAGE_BASE_URL = "https://storage.flutter-io.cn"
   ```

### ML 模型训练失败

**问题**: Cloud Function 返回错误

**常见原因**:

1. **数据格式错误**
   - 确保 CSV 格式正确
   - 检查是否有缺失值
   - 数值特征需要是数字类型

2. **超时问题**
   - 数据集太大(> 10MB)
   - 选择更快的算法
   - 减少训练参数

3. **权限问题**
   - 检查 Firebase 认证状态
   - 确认 Firestore 规则允许写入

## 部署问题

### GitHub Pages 部署失败

**问题**: Actions 运行失败

**检查清单**:

1. **确认 Actions 权限**
   - Settings → Actions → General
   - Workflow permissions → Read and write

2. **检查分支名称**
   - 确认是 `main` 还是 `master`
   - 修改 `.github/workflows/deploy-docs.yml`

3. **查看构建日志**
   - 在 Actions 标签页查看详细错误
   - 根据错误信息调整配置

### Firebase Hosting 部署问题

**问题**: `firebase deploy` 失败

**解决方案**:

```powershell
# 1. 重新登录
firebase logout
firebase login

# 2. 检查项目配置
firebase projects:list
firebase use <project-id>

# 3. 构建并部署
flutter build web
firebase deploy --only hosting
```

## 性能优化

### 如何提升应用性能?

**优化技巧**:

1. **使用 Release 模式**
   ```powershell
   flutter run --release
   flutter build web --release
   ```

2. **启用 Tree Shaking**
   - Release 模式自动启用
   - 减少最终包大小

3. **优化图片资源**
   - 使用 WebP 格式
   - 压缩图片大小
   - 使用适当的分辨率

4. **懒加载模块**
   - 按需加载页面
   - 延迟加载大型数据

### 如何减少应用体积?

**方法**:

1. **分析包大小**
   ```powershell
   flutter build apk --analyze-size
   ```

2. **移除未使用的包**
   - 检查 `pubspec.yaml`
   - 删除不需要的依赖

3. **使用代码分割**
   - 按功能模块划分
   - 动态导入

## 学习建议

### 我是初学者,应该从哪里开始?

**学习路径**:

1. **第1周**: 熟悉基本排序算法
   - 冒泡排序
   - 选择排序
   - 插入排序

2. **第2周**: 进阶排序算法
   - 快速排序
   - 归并排序
   - 堆排序

3. **第3周**: 数据结构
   - 栈和队列
   - 链表
   - 二叉树

4. **第4周**: 操作系统
   - 进程调度
   - 内存管理
   - 死锁处理

5. **第5-6周**: 机器学习
   - 线性回归
   - 分类算法
   - 聚类算法

### 如何用这个项目准备考研?

**备考策略**:

1. **理论学习 → 可视化验证**
   - 看完一个算法后立即用平台验证
   - 观察执行过程加深理解

2. **做题 → 模拟演示**
   - 遇到不理解的题目
   - 在平台中构造类似场景

3. **总结归纳**
   - 对比不同算法的特点
   - 使用平台的性能对比功能

4. **面试准备**
   - 能讲解算法执行过程
   - 展示项目体现技术能力

## 贡献相关

### 如何参与项目开发?

**步骤**:

1. **Fork 项目**
   - 在 GitHub 上 Fork 仓库

2. **克隆到本地**
   ```powershell
   git clone https://github.com/your-username/ml_platform.git
   cd ml_platform
   ```

3. **创建特性分支**
   ```powershell
   git checkout -b feature/your-feature-name
   ```

4. **开发并测试**
   ```powershell
   # 开发完成后测试
   flutter test
   flutter run
   ```

5. **提交代码**
   ```powershell
   git add .
   git commit -m "feat: add your feature"
   git push origin feature/your-feature-name
   ```

6. **创建 Pull Request**
   - 在 GitHub 上创建 PR
   - 描述你的改动

### 我可以贡献什么内容?

**欢迎的贡献**:

- 🐛 **Bug 修复**: 发现并修复问题
- ✨ **新功能**: 添加新的算法或可视化
- 📝 **文档**: 改进文档说明
- 🎨 **UI/UX**: 优化用户界面
- 🌍 **国际化**: 添加多语言支持
- ⚡ **性能优化**: 提升运行效率
- 🧪 **测试**: 增加测试覆盖率

## 联系方式

### 如何获取帮助?

1. **GitHub Issues**
   - 报告 Bug
   - 提出功能建议
   - 寻求技术支持

2. **GitHub Discussions**
   - 技术讨论
   - 经验分享
   - 问答交流

3. **邮件联系**
   - xzqnbcj666@gmail.com
   - 详细描述问题和环境信息

### 反馈问题时应该提供什么信息?

**问题报告模板**:

```markdown
**问题描述**
简要描述遇到的问题

**复现步骤**
1. 进入 xx 页面
2. 点击 xx 按钮
3. 出现 xx 错误

**预期行为**
描述预期的正确行为

**实际行为**
描述实际发生的情况

**环境信息**
- 操作系统: Windows 11
- Flutter 版本: 3.16.0
- 浏览器: Chrome 120

**截图/日志**
如果有截图或错误日志,请附上

**其他信息**
其他相关信息
```

---

## 💡 更多资源

- 📖 [Flutter 官方文档](https://flutter.dev/docs)
- 🔥 [Firebase 文档](https://firebase.google.com/docs)
- 📚 [VitePress 文档](https://vitepress.dev)
- 🎓 [408 考研资料](https://github.com/wssAchilles/Mycode)

---

<div align="center">

**问题没有解决?** 

[提交 Issue](https://github.com/wssAchilles/Mycode/issues) | [查看讨论](https://github.com/wssAchilles/Mycode/discussions)

</div>
