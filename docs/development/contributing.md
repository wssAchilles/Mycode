# 🤝 贡献指南

感谢你考虑为 ML Platform 做出贡献!本文档将指导你如何参与项目开发。

## 📋 目录

- [行为准则](#行为准则)
- [如何贡献](#如何贡献)
- [开发流程](#开发流程)
- [提交规范](#提交规范)
- [代码审查](#代码审查)

## 🌟 行为准则

### 我们的承诺

为了营造开放和友好的环境,我们承诺:

- ✅ 使用友好和包容的语言
- ✅ 尊重不同的观点和经验
- ✅ 优雅地接受建设性批评
- ✅ 关注对社区最有利的事情
- ✅ 对其他社区成员表现同理心

### 不被接受的行为

- ❌ 使用性暗示的语言或图像
- ❌ 骚扰、侮辱或贬损性评论
- ❌ 公开或私下的骚扰
- ❌ 未经许可发布他人的私人信息
- ❌ 其他不道德或不专业的行为

## 🎯 如何贡献

### 报告Bug

发现 Bug? 请帮我们提交 Issue:

1. **检查是否已存在**: 搜索 [Issues](https://github.com/wssAchilles/ml_platform/issues) 避免重复
2. **使用 Bug 模板**: 提供详细信息
3. **包含必要信息**:
   - Flutter 版本
   - 操作系统
   - 复现步骤
   - 预期行为 vs 实际行为
   - 截图或录屏

**Bug 报告示例**:

```markdown
**环境**
- Flutter 版本: 3.10.0
- 操作系统: Windows 11
- 浏览器: Chrome 120

**描述**
冒泡排序动画在数组长度>100时卡顿

**复现步骤**
1. 打开算法可视化页面
2. 选择冒泡排序
3. 设置数组长度为150
4. 点击开始

**预期**: 流畅动画
**实际**: 明显卡顿

**截图**
[附上截图]
```

### 提出新功能

有好想法? 欢迎提交 Feature Request:

1. **描述问题**: 这个功能解决什么问题?
2. **提出方案**: 你期望的解决方案
3. **备选方案**: 其他可能的实现方式
4. **附加信息**: 原型图、参考链接等

### 改进文档

文档同样重要!你可以:

- 修正拼写错误
- 改进表述
- 添加示例
- 翻译成其他语言
- 补充缺失内容

## 🔧 开发流程

### 1. Fork 项目

```bash
# 在 GitHub 上点击 Fork 按钮
# 然后克隆你的 fork
git clone https://github.com/YOUR_USERNAME/ml_platform.git
cd ml_platform
```

### 2. 创建分支

```bash
# 从 main 分支创建新分支
git checkout -b feature/your-feature-name

# 分支命名规范:
# - feature/xxx  - 新功能
# - bugfix/xxx   - Bug修复
# - docs/xxx     - 文档更新
# - refactor/xxx - 代码重构
# - test/xxx     - 测试相关
```

### 3. 设置开发环境

```bash
# 安装依赖
flutter pub get

# 配置 Firebase(如需要)
firebase login
flutterfire configure

# 运行项目
flutter run -d chrome
```

### 4. 进行开发

#### 代码风格

遵循 [Dart 官方风格指南](https://dart.dev/guides/language/effective-dart):

```dart
// ✅ 好的命名
class UserProfile { }
void calculateTotal() { }
final userName = 'John';

// ❌ 不好的命名
class userprofile { }
void calc() { }
final u_name = 'John';

// ✅ 好的注释
/// 计算数组的冒泡排序时间复杂度
/// 
/// [array] 待排序的整数数组
/// 返回 O(n²) 的详细分析
String analyzeBubbleSort(List<int> array) { }

// ❌ 不好的注释
// 排序
void sort() { }
```

#### 编写测试

每个新功能都应包含测试:

```dart
// test/algorithm/bubble_sort_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:ml_platform/algorithm/bubble_sort.dart';

void main() {
  group('BubbleSort', () {
    late BubbleSort sorter;
    
    setUp(() {
      sorter = BubbleSort();
    });
    
    test('sorts empty array', () {
      expect(sorter.sort([]), []);
    });
    
    test('sorts single element', () {
      expect(sorter.sort([1]), [1]);
    });
    
    test('sorts random array', () {
      final input = [3, 1, 4, 1, 5, 9, 2, 6];
      final expected = [1, 1, 2, 3, 4, 5, 6, 9];
      expect(sorter.sort(input), expected);
    });
  });
}
```

运行测试:

```bash
# 运行所有测试
flutter test

# 运行特定测试
flutter test test/algorithm/bubble_sort_test.dart

# 查看覆盖率
flutter test --coverage
genhtml coverage/lcov.info -o coverage/html
```

### 5. 提交代码

#### Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/):

```bash
# 格式: <type>(<scope>): <subject>

# 类型(type):
# - feat:     新功能
# - fix:      Bug修复
# - docs:     文档更新
# - style:    代码格式(不影响功能)
# - refactor: 重构
# - test:     测试相关
# - chore:    构建/工具相关

# 示例:
git commit -m "feat(algorithm): add merge sort visualization"
git commit -m "fix(os): resolve deadlock detection bug"
git commit -m "docs(readme): update installation guide"
git commit -m "test(algorithm): add unit tests for quick sort"
```

**好的 Commit 示例**:

```bash
feat(algorithm): implement binary search visualization

- Add interactive binary search animation
- Support step-by-step execution
- Display time complexity analysis
- Add comprehensive test coverage

Closes #123
```

**不好的 Commit 示例**:

```bash
# ❌ 太简短
git commit -m "fix bug"

# ❌ 没有类型
git commit -m "update code"

# ❌ 太笼统
git commit -m "feat: some changes"
```

### 6. 推送代码

```bash
# 推送到你的 fork
git push origin feature/your-feature-name
```

### 7. 创建 Pull Request

1. **在 GitHub 上打开你的 fork**
2. **点击 "New Pull Request"**
3. **填写 PR 描述**:

```markdown
## 📝 变更说明

简要描述这个 PR 的目的和实现方式

## 🎯 相关 Issue

Closes #123
Related to #456

## ✅ 变更类型

- [ ] Bug 修复
- [x] 新功能
- [ ] 代码重构
- [ ] 文档更新
- [ ] 测试完善

## 🧪 测试

- [x] 已添加单元测试
- [x] 已添加 Widget 测试
- [x] 已手动测试
- [x] 所有测试通过

## 📸 截图(如适用)

[附上截图或 GIF]

## 📋 检查清单

- [x] 代码遵循项目风格指南
- [x] 已自我审查代码
- [x] 已添加必要的注释
- [x] 文档已更新
- [x] 没有引入新的警告
- [x] 已添加测试
- [x] 所有测试通过
```

## 🔍 代码审查

### 审查流程

1. **自动检查**: CI 会自动运行测试和代码分析
2. **人工审查**: 维护者会审查你的代码
3. **反馈迭代**: 根据反馈修改代码
4. **合并**: 审查通过后合并到主分支

### 审查标准

代码审查将关注:

✅ **功能性**
- 代码是否实现了预期功能?
- 是否有边界情况未处理?
- 是否有潜在的 Bug?

✅ **可读性**
- 代码是否易于理解?
- 命名是否清晰?
- 是否有足够的注释?

✅ **可维护性**
- 代码是否遵循 DRY 原则?
- 是否有重复代码?
- 是否易于修改和扩展?

✅ **性能**
- 是否有性能问题?
- 算法复杂度是否合理?
- 是否有不必要的计算?

✅ **测试**
- 测试覆盖率是否足够?
- 测试是否有意义?
- 是否测试了边界情况?

### 响应反馈

收到审查反馈后:

```bash
# 在同一分支上修改
git add .
git commit -m "fix: address review comments"
git push origin feature/your-feature-name

# PR 会自动更新
```

## 🏗️ 项目结构

贡献代码前,了解项目结构很重要:

- `lib/` - 主要源代码
  - `screens/` - 页面
  - `widgets/` - 可复用组件
  - `services/` - 业务逻辑
  - `models/` - 数据模型
- `test/` - 测试文件
- `docs/` - 文档
- `functions/` - Cloud Functions

详见 [项目架构文档](./architecture.md)

## 📚 开发资源

### 学习资料

- [Flutter 官方文档](https://flutter.dev/docs)
- [Dart 语言指南](https://dart.dev/guides)
- [Firebase 文档](https://firebase.google.com/docs)
- [Material Design](https://material.io/)

### 工具推荐

- **IDE**: VS Code 或 Android Studio
- **插件**: Flutter、Dart、GitLens
- **调试**: Flutter DevTools
- **测试**: flutter test
- **格式化**: dart format

## 💡 提示与技巧

### 保持同步

定期同步上游仓库:

```bash
# 添加上游仓库
git remote add upstream https://github.com/wssAchilles/ml_platform.git

# 获取最新代码
git fetch upstream

# 合并到你的分支
git checkout main
git merge upstream/main
```

### 小步提交

- ✅ 每个 commit 只做一件事
- ✅ 保持 commit 原子性
- ✅ 编写清晰的 commit message

### 及时沟通

- 💬 有问题随时在 Issue 或 PR 中提问
- 💬 不确定的设计可以先讨论
- 💬 遇到困难可以寻求帮助

## 🎉 成为贡献者

你的贡献被合并后,你将:

- ✨ 出现在项目贡献者列表中
- ✨ 获得项目徽章
- ✨ 成为社区的一员

## 📞 联系方式

- GitHub Issues: [提交问题](https://github.com/wssAchilles/ml_platform/issues)
- Discussions: [参与讨论](https://github.com/wssAchilles/ml_platform/discussions)
- Email: your.email@example.com

## 🙏 致谢

感谢所有为 ML Platform 做出贡献的开发者!

[查看所有贡献者](https://github.com/wssAchilles/ml_platform/graphs/contributors)

---

**再次感谢你的贡献!** 🎉

每一个 PR,每一个 Issue,每一条建议,都让这个项目变得更好!
