# 腾讯云 COS 静态网站部署指南

## 🎯 部署目标
将 `play.html` 页面部署到腾讯云 COS 静态网站，实现微信内直接播放音频功能。

## 📋 配置信息
- **存储桶名称**: `my-audio-files-123-1380453532`
- **所属地域**: `ap-nanjing` （南京）
- **访问权限**: 公有读私有写

## 🔧 部署步骤

### 步骤 1: 登录腾讯云控制台
1. 访问：https://console.cloud.tencent.com/cos5
2. 使用您的腾讯云账号登录

### 步骤 2: 找到存储桶
1. 在存储桶列表中找到：`my-audio-files-123-1380453532`
2. 点击进入存储桶管理界面

### 步骤 3: 上传文件
1. 点击"上传文件"按钮
2. 选择项目根目录下的 `play.html` 文件
3. 确认上传完成

### 步骤 4: 设置访问权限
1. 点击"权限管理" -> "存储桶访问权限"
2. 将访问权限设置为"公有读私有写"
3. 保存设置

### 步骤 5: 启用静态网站托管
1. 点击"基础配置" -> "静态网站"
2. 启用静态网站功能
3. 设置索引文档：`play.html`
4. 设置错误文档：`play.html`
5. 保存配置

### 步骤 6: 配置 CORS（可选但推荐）
1. 点击"安全管理" -> "跨域访问CORS"
2. 添加规则：
   - 来源 Origin: `*`
   - 操作 Methods: `GET, HEAD`
   - Allow-Headers: `*`
   - Max-Age: `86400`
3. 保存配置

## 🔗 访问地址

### 直接文件访问
```
https://my-audio-files-123-1380453532.cos.ap-nanjing.myqcloud.com/play.html
```

### 静态网站访问（推荐）
```
https://my-audio-files-123-1380453532.cos-website.ap-nanjing.myqcloud.com
```

## 📱 测试地址

### 示例 1: 基本音频播放
```
https://my-audio-files-123-1380453532.cos-website.ap-nanjing.myqcloud.com/play.html?filename=示例音频.mp3&url=https://example.com/audio.mp3
```

### 示例 2: 完整参数
```
https://my-audio-files-123-1380453532.cos-website.ap-nanjing.myqcloud.com/play.html?filename=我的录音.mp3&url=https://your-domain.com/files/recording.mp3
```

## ⚡ 验证部署

1. **基本验证**: 直接访问静态网站地址，应该显示播放器页面
2. **参数验证**: 使用示例地址测试参数解析功能
3. **微信验证**: 使用微信扫描包含这些地址的二维码

## 🔄 更新 Flutter 应用

部署完成后，需要更新 Flutter 应用中的配置：

```dart
// lib/config/tencent_cloud_config.dart
class TencentCloudConfig {
  static const String wechatServerUrl = 
    'https://my-audio-files-123-1380453532.cos-website.ap-nanjing.myqcloud.com';
}
```

## 📝 重新编译 APK

```bash
flutter clean
flutter build apk --release
```

## 🧪 测试流程

1. ✅ 确认静态网站可以正常访问
2. ✅ 确认参数传递功能正常
3. ✅ 重新编译 Flutter APK
4. ✅ 安装新版本 APK
5. ✅ 录制音频并生成二维码
6. ✅ 使用微信扫描二维码
7. ✅ 验证在微信内直接播放（无外部跳转）

## 🎉 预期结果

- ✨ 微信扫码后直接在微信内播放音频
- ✨ 无需跳转到外部浏览器
- ✨ 专业的播放器界面和用户体验
- ✨ 支持播放控制、进度调节等功能

## 🔍 故障排除

### 如果访问失败：
1. 检查存储桶权限是否为"公有读"
2. 确认文件已成功上传
3. 等待 5-10 分钟让配置生效

### 如果微信内不能播放：
1. 确认音频文件 URL 可以正常访问
2. 检查音频文件格式（推荐 MP3）
3. 确认 CORS 配置正确

---

**部署完成后，您的音频二维码功能将完美支持微信内直接播放！** 🎵