# 📱 Android 应用部署指南

## 目录

- [构建测试版 APK](#构建测试版-apk)
- [生成签名密钥](#生成签名密钥)
- [配置签名](#配置签名)
- [构建发布版本](#构建发布版本)
- [发布到应用商店](#发布到应用商店)
- [GitHub Actions 自动构建](#github-actions-自动构建)

---

## 🚀 快速开始

### 1️⃣ 构建测试版 APK

最简单的方式,用于测试和分享:

```bash
# 构建 debug 版本 (用于测试)
flutter build apk --debug

# 构建 release 版本 (但使用 debug 签名)
flutter build apk --release
```

**生成位置**: `build/app/outputs/flutter-apk/app-release.apk`

**文件大小**: 约 40-60 MB

**安装方式**: 直接传输到 Android 设备安装

---

## 🔐 生成签名密钥

发布到 Google Play 或正式分发需要签名密钥。

### 步骤 1: 生成密钥库

在项目根目录运行:

```bash
# Windows PowerShell
keytool -genkey -v -keystore upload-keystore.jks -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 -alias upload

# 如果 keytool 不可用,使用 Java 路径
# "C:\Program Files\Java\jdk-17\bin\keytool.exe" -genkey -v -keystore upload-keystore.jks -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

### 步骤 2: 填写密钥信息

执行命令后会提示输入:

```
Enter keystore password: [输入密码,例如: yourpassword123]
Re-enter new password: [再次输入]
What is your first and last name?
  [Unknown]: 许子祺
What is the name of your organizational unit?
  [Unknown]: Development
What is the name of your organization?
  [Unknown]: ML Platform
What is the name of your City or Locality?
  [Unknown]: Beijing
What is the name of your State or Province?
  [Unknown]: Beijing
What is the two-letter country code for this unit?
  [Unknown]: CN
Is CN=许子祺, OU=Development, O=ML Platform, L=Beijing, ST=Beijing, C=CN correct?
  [no]: yes

Enter key password for <upload>
    (RETURN if same as keystore password): [直接回车使用相同密码]
```

### 步骤 3: 保存密钥信息

**⚠️ 重要**: 将密钥文件移到安全位置

```bash
# 移动密钥文件到 android/app 目录
Move-Item upload-keystore.jks android/app/
```

**记录以下信息** (妥善保管,不要提交到 Git):

- **密钥库路径**: `android/app/upload-keystore.jks`
- **密钥库密码**: `yourpassword123` (你设置的密码)
- **密钥别名**: `upload`
- **密钥密码**: (如果没单独设置,与密钥库密码相同)

---

## ⚙️ 配置签名

### 创建密钥属性文件

创建 `android/key.properties` 文件:

```bash
# 在 android 目录创建 key.properties
New-Item -Path android/key.properties -ItemType File
```

**编辑 `android/key.properties`**,添加以下内容:

```properties
storePassword=yourpassword123
keyPassword=yourpassword123
keyAlias=upload
storeFile=upload-keystore.jks
```

**⚠️ 安全提示**: 将 `key.properties` 添加到 `.gitignore`:

```bash
# 在项目根目录执行
Add-Content .gitignore "`nandroid/key.properties`nandroid/app/upload-keystore.jks"
```

### 修改 build.gradle.kts

编辑 `android/app/build.gradle.kts`,在 `android {` 块之前添加:

```kotlin
// 在文件顶部,android 块之前添加
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    // ... 现有配置

    // 在 buildTypes 之前添加签名配置
    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null
            storePassword keystoreProperties['storePassword']
        }
    }

    buildTypes {
        release {
            signingConfig signingConfigs.release  // 修改这一行
            // 移除: signingConfig = signingConfigs.getByName("debug")
        }
    }
}
```

---

## 📦 构建发布版本

### APK 格式 (通用格式)

```bash
# 构建单个通用 APK
flutter build apk --release

# 构建分架构 APK (更小,推荐)
flutter build apk --split-per-abi
```

**输出文件**:

- 单个 APK: `build/app/outputs/flutter-apk/app-release.apk` (~45MB)
- 分架构 APK:
  - `app-armeabi-v7a-release.apk` (~18MB) - 32位 ARM 设备
  - `app-arm64-v8a-release.apk` (~20MB) - 64位 ARM 设备
  - `app-x86_64-release.apk` (~22MB) - x86 设备

### AAB 格式 (Google Play 专用)

```bash
# 构建 Android App Bundle (推荐用于 Google Play)
flutter build appbundle --release
```

**输出文件**: `build/app/outputs/bundle/release/app-release.aab` (~25MB)

**优势**: Google Play 会自动为不同设备生成优化的 APK

---

## 🏪 发布到应用商店

### 方案 1: Google Play Store (官方)

#### 准备工作

1. **注册 Google Play 开发者账号**
   - 费用: $25 一次性注册费
   - 网址: https://play.google.com/console/signup

2. **准备应用资源**
   - 应用图标: 512x512 PNG
   - 功能图片: 1024x500 PNG
   - 应用截图: 至少 2 张 (手机/平板)
   - 隐私政策 URL
   - 应用描述 (简短+完整)

3. **构建 AAB 文件**
   ```bash
   flutter build appbundle --release
   ```

#### 上传步骤

1. 访问 [Google Play Console](https://play.google.com/console)
2. 创建新应用
3. 填写应用详情和分类
4. 上传 `app-release.aab`
5. 设置定价和分发国家
6. 提交审核 (通常 1-3 天)

---

### 方案 2: 第三方应用市场 (中国)

#### 国内主流应用商店

| 应用商店 | 市场份额 | 审核时间 | 备注 |
|---------|---------|---------|------|
| **华为应用市场** | 30% | 3-5 工作日 | 需要软著 |
| **小米应用商店** | 20% | 2-3 工作日 | 较快 |
| **OPPO软件商店** | 15% | 3-5 工作日 | 需要认证 |
| **vivo应用商店** | 15% | 3-5 工作日 | 需要认证 |
| **应用宝 (腾讯)** | 10% | 5-7 工作日 | 审核严格 |
| **360手机助手** | 5% | 2-3 工作日 | 较宽松 |

#### 共同要求

- ✅ 软件著作权 (建议但不强制)
- ✅ 应用签名 APK
- ✅ 详细应用介绍和截图
- ✅ 隐私政策
- ✅ 开发者实名认证

---

### 方案 3: 自主分发 (推荐用于测试/内部)

#### GitHub Releases

1. **创建 Release**
   ```bash
   git tag -a v1.0.0 -m "Release version 1.0.0"
   git push origin v1.0.0
   ```

2. **上传 APK 到 GitHub Release**
   - 访问: https://github.com/wssAchilles/Mycode/releases
   - 点击 "Draft a new release"
   - 上传 `app-release.apk`
   - 发布

3. **用户安装方式**
   - 下载 APK 文件
   - 允许"未知来源安装"
   - 安装应用

#### Firebase App Distribution

1. **安装 Firebase CLI 插件**
   ```bash
   firebase appdistribution:distribute build/app/outputs/flutter-apk/app-release.apk `
     --app YOUR_APP_ID `
     --groups testers
   ```

2. **邀请测试用户**
   - 测试用户会收到邮件
   - 下载 Firebase App Tester 应用
   - 安装你的应用

---

## 🤖 GitHub Actions 自动构建

创建 `.github/workflows/android-release.yml`:

```yaml
name: Build Android Release

on:
  push:
    tags:
      - 'v*'  # 推送标签时触发,如 v1.0.0
  workflow_dispatch:  # 手动触发

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: 'zulu'
          java-version: '17'
      
      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.24.0'
          channel: 'stable'
      
      - name: Install dependencies
        run: flutter pub get
      
      - name: Decode keystore
        run: |
          echo "${{ secrets.KEYSTORE_BASE64 }}" | base64 --decode > android/app/upload-keystore.jks
      
      - name: Create key.properties
        run: |
          cat > android/key.properties << EOF
          storePassword=${{ secrets.KEYSTORE_PASSWORD }}
          keyPassword=${{ secrets.KEY_PASSWORD }}
          keyAlias=${{ secrets.KEY_ALIAS }}
          storeFile=upload-keystore.jks
          EOF
      
      - name: Build APK
        run: flutter build apk --release --split-per-abi
      
      - name: Build App Bundle
        run: flutter build appbundle --release
      
      - name: Upload APK artifacts
        uses: actions/upload-artifact@v4
        with:
          name: android-apk
          path: build/app/outputs/flutter-apk/*.apk
      
      - name: Upload AAB artifact
        uses: actions/upload-artifact@v4
        with:
          name: android-aab
          path: build/app/outputs/bundle/release/app-release.aab
      
      - name: Create Release
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v1
        with:
          files: |
            build/app/outputs/flutter-apk/app-arm64-v8a-release.apk
            build/app/outputs/flutter-apk/app-armeabi-v7a-release.apk
            build/app/outputs/bundle/release/app-release.aab
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 配置 GitHub Secrets

在 GitHub 仓库设置中添加以下 Secrets:

1. **KEYSTORE_BASE64**: 密钥库文件的 Base64 编码
   ```bash
   # 生成 Base64 编码
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("android/app/upload-keystore.jks"))
   ```

2. **KEYSTORE_PASSWORD**: 密钥库密码
3. **KEY_PASSWORD**: 密钥密码
4. **KEY_ALIAS**: 密钥别名 (upload)

---

## 📊 版本管理

### 更新版本号

编辑 `pubspec.yaml`:

```yaml
version: 1.0.1+2
#        ^^^^^ ^^
#        |     |
#        |     +-- buildNumber (versionCode)
#        +-------- versionName
```

或使用命令行:

```bash
flutter build apk --release --build-name=1.0.1 --build-number=2
```

### 版本号规范

- **versionName**: 面向用户的版本号 (1.0.0)
  - 主版本.次版本.修订号
  - 例: 1.0.0 → 1.1.0 → 2.0.0

- **versionCode**: 内部版本号 (整数,递增)
  - 每次发布必须增加
  - 例: 1 → 2 → 3

---

## 🔍 测试清单

发布前检查:

- [ ] 应用在真实设备上运行正常
- [ ] 所有功能测试通过
- [ ] 网络权限配置正确
- [ ] Firebase 服务连接正常
- [ ] 应用图标和启动屏幕正确
- [ ] 没有调试日志或测试代码
- [ ] 版本号已更新
- [ ] 签名配置正确
- [ ] APK/AAB 文件可正常安装

---

## 🐛 常见问题

### 问题 1: 签名配置错误

**错误信息**: `Keystore file not found`

**解决方案**:
```bash
# 检查文件路径
Test-Path android/app/upload-keystore.jks

# 确保 key.properties 中路径正确
Get-Content android/key.properties
```

### 问题 2: 构建失败

**错误信息**: `Execution failed for task ':app:lintVitalRelease'`

**解决方案**: 在 `android/app/build.gradle.kts` 添加:
```kotlin
android {
    lintOptions {
        checkReleaseBuilds = false
    }
}
```

### 问题 3: APK 体积过大

**解决方案**:
```bash
# 1. 使用分架构构建
flutter build apk --split-per-abi

# 2. 启用混淆和压缩
flutter build apk --release --obfuscate --split-debug-info=./debug-info

# 3. 使用 AAB 格式 (Google Play)
flutter build appbundle --release
```

### 问题 4: 安装时提示"应用未安装"

**原因**: 
- 签名不匹配
- 版本号冲突
- 设备架构不兼容

**解决方案**:
```bash
# 1. 卸载旧版本
adb uninstall com.xzq.ml_platform

# 2. 重新安装
adb install -r build/app/outputs/flutter-apk/app-release.apk
```

---

## 📱 推荐发布策略

### 阶段 1: 内部测试 (1-2周)
- ✅ GitHub Releases 分发
- ✅ 邀请 5-10 名测试用户
- ✅ 收集反馈和修复 Bug

### 阶段 2: Beta 测试 (2-4周)
- ✅ Firebase App Distribution
- ✅ 扩大到 20-50 名用户
- ✅ 性能和稳定性测试

### 阶段 3: 正式发布
- ✅ Google Play Store (国际)
- ✅ 华为/小米等应用商店 (国内)
- ✅ 持续更新和维护

---

## 📞 技术支持

- **GitHub Issues**: https://github.com/wssAchilles/Mycode/issues
- **Email**: xzqnbcj666@gmail.com
- **在线文档**: [README.md](README.md)

---

<div align="center">

**🎉 祝您的应用发布成功!**

[返回主文档](README.md) | [Web 部署指南](DEPLOYMENT.md)

</div>
