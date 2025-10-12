# 快速开始

## 环境准备

### 1. 安装Flutter SDK

访问 [Flutter官网](https://flutter.dev/docs/get-started/install) 下载对应系统的SDK。

最低版本要求: Flutter 3.10.0+

### 2. 验证环境

```bash
flutter doctor
```

确保所有检查项都通过。

## 克隆项目

```bash
git clone https://github.com/wssAchilles/Mycode.git
cd ml_platform
```

## 安装依赖

```bash
flutter pub get
```

## 配置Firebase

### 自动配置(推荐)

```bash
# 登录Firebase
firebase login

# 配置项目
flutterfire configure
```

### 手动配置

1. 在[Firebase Console](https://console.firebase.google.com/)创建项目
2. 下载配置文件:
   - Android: `google-services.json` → `android/app/`
   - iOS: `GoogleService-Info.plist` → `ios/Runner/`
   - Web: 在 `web/index.html` 中添加配置

## 运行应用

### Web版(推荐快速预览)

```bash
flutter run -d chrome
```

### Android版

```bash
flutter run -d android
```

### Windows桌面版

```bash
flutter run -d windows
```

## 下一步

- [探索核心功能](./features.md)
- [查看架构设计](../development/architecture.md)
- [参与项目开发](../development/contributing.md)
