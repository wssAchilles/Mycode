# 🚀 发布流程

本文档描述了 ML Platform 的版本管理和发布流程。

## 📋 版本号规范

我们遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范:

```
主版本号.次版本号.修订号 (MAJOR.MINOR.PATCH)
```

例如: `1.2.3`

### 版本号递增规则

- **主版本号 (MAJOR)**: 不兼容的 API 修改
- **次版本号 (MINOR)**: 向下兼容的功能性新增
- **修订号 (PATCH)**: 向下兼容的问题修正

### 预发布版本

```
1.0.0-alpha.1    # Alpha 版本
1.0.0-beta.2     # Beta 版本
1.0.0-rc.1       # Release Candidate
```

## 🔄 发布周期

### 常规发布

- **主版本**: 每年 1-2 次
- **次版本**: 每月 1 次
- **修订版本**: 根据需要随时发布

### 紧急修复

严重 Bug 或安全漏洞可立即发布 Hotfix 版本。

## 📝 发布清单

### 1. 准备阶段

- [ ] 确认所有 Issue 已关闭或移至下个版本
- [ ] 确认所有 PR 已合并
- [ ] 更新依赖到最新稳定版
- [ ] 运行完整测试套件
- [ ] 检查代码覆盖率 (>80%)

### 2. 版本更新

#### 2.1 更新版本号

```yaml
# pubspec.yaml
name: ml_platform
version: 1.2.3+4  # version+buildNumber
```

#### 2.2 更新 CHANGELOG

```markdown
# Changelog

## [1.2.3] - 2024-01-15

### 🎉 新功能
- 添加归并排序可视化 (#123)
- 支持自定义动画速度 (#145)

### 🐛 Bug 修复
- 修复内存泄漏问题 (#156)
- 解决死锁检测误报 (#167)

### 📝 文档
- 更新 API 文档
- 添加部署教程

### ⚡ 性能优化
- 优化排序算法动画性能
- 减少包体积 20%

### 🔧 其他
- 更新依赖版本
- 改进 CI/CD 流程
```

#### 2.3 更新文档

- README.md
- API 文档
- 用户指南

### 3. 测试阶段

#### 3.1 自动化测试

```bash
# 单元测试
flutter test

# Widget 测试
flutter test --coverage

# 集成测试
flutter drive --target=test_driver/app.dart
```

#### 3.2 手动测试

测试矩阵:

| 平台 | 版本 | 测试人员 | 状态 |
|------|------|----------|------|
| Web | Chrome 120 | @user1 | ✅ |
| Web | Firefox 121 | @user2 | ✅ |
| Android | 13 | @user3 | ✅ |
| iOS | 17 | @user4 | ✅ |
| Windows | 11 | @user5 | ✅ |

核心功能测试:

- [ ] 用户注册/登录
- [ ] 算法可视化播放
- [ ] 数据持久化
- [ ] 主题切换
- [ ] 搜索功能
- [ ] 成就系统

### 4. 构建阶段

#### 4.1 Web 版本

```bash
# 构建生产版本
flutter build web --release

# 优化输出
cd build/web
gzip -9 -r .

# 测试构建产物
python -m http.server 8000
```

#### 4.2 Android 版本

```bash
# 构建 APK
flutter build apk --release --split-per-abi

# 构建 AAB (Google Play)
flutter build appbundle --release

# 签名检查
keytool -printcert -jarfile build/app/outputs/bundle/release/app-release.aab
```

#### 4.3 iOS 版本

```bash
# 构建 iOS
flutter build ios --release

# 归档
xcodebuild -workspace ios/Runner.xcworkspace \
  -scheme Runner \
  -configuration Release \
  -archivePath build/Runner.xcarchive \
  archive
```

#### 4.4 Windows 版本

```bash
# 构建 Windows
flutter build windows --release

# 创建安装包
# 使用 Inno Setup 或 MSIX
```

### 5. 部署阶段

#### 5.1 Web 部署

```bash
# 部署到 Firebase Hosting
firebase deploy --only hosting

# 验证部署
curl https://ml-platform.web.app
```

#### 5.2 Android 部署

```bash
# 上传到 Google Play Console
# 使用 Web 界面或 fastlane

# 设置发布轨道
# - 内部测试 (Internal Testing)
# - 封闭测试 (Closed Testing)
# - 开放测试 (Open Testing)
# - 正式发布 (Production)
```

#### 5.3 iOS 部署

```bash
# 上传到 App Store Connect
xcrun altool --upload-app \
  -t ios \
  -f build/Runner.xcarchive \
  -u username \
  -p password

# 使用 Transporter 应用上传
```

### 6. 发布阶段

#### 6.1 创建 Git Tag

```bash
# 创建带注释的标签
git tag -a v1.2.3 -m "Release version 1.2.3"

# 推送标签
git push origin v1.2.3

# 推送所有标签
git push origin --tags
```

#### 6.2 创建 GitHub Release

1. 访问 GitHub Releases 页面
2. 点击 "Create a new release"
3. 填写发布信息:

```markdown
## ML Platform v1.2.3

### ✨ 亮点

这个版本带来了全新的归并排序可视化和性能优化!

### 🎉 新功能

- **归并排序可视化**: 完整的动画演示和代码讲解 (#123)
- **自定义速度**: 支持 0.5x-10x 播放速度 (#145)
- **主题定制**: 新增 5 个配色方案

### 🐛 修复

- 修复内存泄漏导致的卡顿 (#156)
- 解决死锁检测误报 (#167)
- 修正深色模式下的显示问题 (#178)

### ⚡ 性能

- 动画性能提升 40%
- 包体积减小 20%
- 启动时间缩短 15%

### 📦 下载

- [Web 版本](https://ml-platform.web.app)
- [Android APK](链接)
- [Windows 安装包](链接)

### 📝 完整更新日志

查看 [CHANGELOG.md](CHANGELOG.md)

### 🙏 致谢

感谢所有贡献者的辛勤工作!

---

**升级指南**: [查看文档](升级文档链接)
**已知问题**: [Issue #189](链接)
```

4. 上传构建产物
5. 发布 Release

#### 6.3 更新文档网站

```bash
# 更新文档版本
cd docs
npm run docs:build

# 部署文档
git add .
git commit -m "docs: update for v1.2.3"
git push origin main
```

### 7. 公告阶段

#### 7.1 社交媒体

- Twitter: 发布更新公告
- Reddit: 在相关社区分享
- Discord: 通知社区成员

#### 7.2 邮件通知

向订阅用户发送更新邮件:

```
主题: ML Platform v1.2.3 发布 - 全新归并排序可视化!

Hi,

我们很高兴地宣布 ML Platform v1.2.3 正式发布!

🎉 主要更新:
- 归并排序可视化
- 性能提升 40%
- 新增主题定制

🔗 立即体验: https://ml-platform.web.app

📝 完整更新日志: [链接]

感谢你的支持!

ML Platform Team
```

#### 7.3 更新网站

- 首页横幅
- 更新日志页面
- 下载页面

### 8. 监控阶段

#### 8.1 错误监控

```dart
// 配置 Firebase Crashlytics
FirebaseCrashlytics.instance.setCustomKey('version', '1.2.3');

// 监控关键指标
FirebaseAnalytics.instance.logEvent(
  name: 'app_version',
  parameters: {'version': '1.2.3'},
);
```

#### 8.2 性能监控

- 启动时间
- 页面加载时间
- API 响应时间
- 内存使用

#### 8.3 用户反馈

- GitHub Issues
- 应用商店评论
- 社区讨论
- 用户调查

## 🔥 Hotfix 流程

### 紧急修复流程

1. **创建 Hotfix 分支**

```bash
git checkout -b hotfix/1.2.4 v1.2.3
```

2. **修复问题并测试**

3. **更新版本号** (只增加 PATCH)

4. **快速发布**

```bash
git tag -a v1.2.4 -m "Hotfix: critical bug"
git push origin hotfix/1.2.4
git push origin v1.2.4
```

5. **合并回主分支**

```bash
git checkout main
git merge hotfix/1.2.4
git push origin main
```

## 📊 发布后分析

### 收集数据

- 下载量
- 活跃用户数
- 崩溃率
- 用户评分
- 性能指标

### 复盘会议

1. **做得好的地方**
2. **需要改进的地方**
3. **下个版本的计划**

## 🛠️ 自动化脚本

### release.sh

```bash
#!/bin/bash

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: ./release.sh <version>"
  exit 1
fi

echo "📦 Preparing release $VERSION..."

# 运行测试
flutter test
if [ $? -ne 0 ]; then
  echo "❌ Tests failed"
  exit 1
fi

# 更新版本号
# 构建应用
# 创建标签
# 部署

echo "✅ Release $VERSION completed!"
```

## 📚 相关文档

- [版本历史](../CHANGELOG.md)
- [升级指南](./upgrading.md)
- [贡献指南](./contributing.md)

---

**记住**: 发布是一个团队协作的过程,沟通很重要!
