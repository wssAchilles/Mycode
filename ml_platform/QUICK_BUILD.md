# 🚀 5分钟快速构建 Android APK

## 最快方式 (测试用)

### 1. 构建 APK

打开 PowerShell,在项目目录执行:

```powershell
flutter build apk --release
```

### 2. 找到 APK 文件

```
build\app\outputs\flutter-apk\app-release.apk
```

### 3. 传输到手机

- 通过 USB 传输
- 或发送到 QQ/微信
- 或上传到网盘

### 4. 安装

在手机上:
1. 打开 APK 文件
2. 允许"安装未知应用"
3. 点击安装

✅ **完成!**

---

## 使用构建脚本 (推荐)

### 运行脚本

```powershell
.\build-android.ps1
```

### 菜单选项

```
请选择构建选项:

  1. 构建 Debug APK (用于测试)
  2. 构建 Release APK (单个文件)
  3. 构建 Release APK (分架构,推荐)  ← 推荐
  4. 构建 AAB (Google Play)
  5. 清理构建缓存
  6. 查看构建产物
  7. 安装到设备/模拟器
  0. 退出
```

**选择 3** 获得最小的 APK 文件!

---

## 常见问题

### ❌ 构建失败?

**清理后重试:**
```powershell
flutter clean
flutter pub get
flutter build apk --release
```

### ❌ 手机无法安装?

**检查:**
1. 设置 → 安全 → 允许安装未知应用
2. 卸载旧版本后重新安装

### ❌ APK 太大?

**使用分架构构建:**
```powershell
flutter build apk --split-per-abi
```

会生成 3 个文件,选择对应设备的:
- `app-arm64-v8a-release.apk` ← 大部分手机用这个
- `app-armeabi-v7a-release.apk` ← 老手机
- `app-x86_64-release.apk` ← 模拟器

---

## 发布到应用商店?

查看完整指南: [ANDROID_DEPLOYMENT.md](ANDROID_DEPLOYMENT.md)

- 🔐 生成签名密钥
- 📦 配置发布构建
- 🏪 上传到应用商店
- 🤖 GitHub Actions 自动构建

---

## 需要帮助?

- 📧 Email: xzqnbcj666@gmail.com
- 🐛 Issues: https://github.com/wssAchilles/Mycode/issues
- 📚 完整文档: [README.md](README.md)

---

<div align="center">

**🎉 开始构建您的第一个 APK 吧!**

</div>
