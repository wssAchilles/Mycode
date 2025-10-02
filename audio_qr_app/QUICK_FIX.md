# 🔧 微信下载保护机制 - 修复方案

## ✅ 问题已识别并修复

### 问题原因：
微信检测到URL中包含：
- `.mp3` 文件扩展名
- `filename` 参数名
- 音频文件直链URL

这触发了微信的文件下载保护机制，强制跳转到外部浏览器。

### 解决方案：
1. **URL参数Base64编码**：隐藏文件扩展名和敏感参数
2. **参数名简化**：`filename` → `f`，`url` → `u`
3. **数据混淆**：使用`data`参数传递编码后的JSON

### 1. 安装Railway CLI
```bash
npm install -g @railway/cli
```

### 2. 部署到Railway
```bash
cd deploy_server
railway login
railway deploy
```

### 3. 获取Railway域名
部署成功后，Railway会提供一个形如 `https://your-app.railway.app` 的域名。

### 4. 更新Flutter配置
将新域名更新到 `lib/config/tencent_cloud_config.dart` 中的 `wechatServerUrl`。

## 备用方案：使用Heroku

如果Railway也有问题，可以使用Heroku：

### 1. 创建Procfile
```
web: node wechat_server.js
```

### 2. 部署到Heroku
```bash
heroku create your-audio-server
git init
git add .
git commit -m "Initial commit"
heroku git:remote -a your-audio-server
git push heroku main
```

## 最简单方案：使用Glitch

Glitch是最简单的免费部署平台：

1. 访问 https://glitch.com
2. 创建新项目
3. 上传我们的服务器文件
4. 获取Glitch提供的域名

## 立即可用方案：本地测试

如果需要立即测试，可以：

1. 启动本地服务器：
```bash
cd deploy_server
node wechat_server.js
```

2. 使用ngrok建立公网隧道：
```bash
npm install -g ngrok
ngrok http 3000
```

3. 使用ngrok提供的HTTPS地址更新配置

## 推荐方案

建议使用Railway，因为：
- ✅ 完全免费
- ✅ 支持Node.js
- ✅ 自动HTTPS
- ✅ 部署简单
- ✅ 稳定可靠

选择任一方案后，记得：
1. 更新Flutter配置中的服务器地址
2. 重新编译APK
3. 测试微信扫码功能