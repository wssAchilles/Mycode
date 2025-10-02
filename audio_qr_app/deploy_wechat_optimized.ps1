# 腾讯云COS微信优化部署脚本
# 自动将优化后的play.html部署到腾讯云COS静态网站

param(
    [string]$BucketName = "my-audio-files-123-1380453532",
    [string]$Region = "ap-nanjing",
    [string]$SecretId = "AKID9HF0nU0LTPNCqGoJRSG3mOrBJrFRQCk3",
    [string]$SecretKey = "94nMjtqNmzzsY0EE0YszsY0EE1d2DAuQ"
)

Write-Host "🚀 开始部署微信优化版音频播放器到腾讯云COS..." -ForegroundColor Green

# 检查必要文件
$PlayHtmlPath = ".\play.html"
if (-not (Test-Path $PlayHtmlPath)) {
    Write-Host "❌ 错误：找不到 play.html 文件" -ForegroundColor Red
    exit 1
}

# 创建临时目录用于上传
$TempDir = ".\temp_upload"
if (Test-Path $TempDir) {
    Remove-Item $TempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $TempDir

# 复制文件到临时目录
Copy-Item $PlayHtmlPath "$TempDir\play.html"

# 创建一个简单的index.html作为首页
$IndexContent = @"
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>音频播放服务</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            color: white;
        }
        .container {
            text-align: center;
            background: rgba(255,255,255,0.1);
            padding: 40px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
        }
        h1 { margin: 0 0 20px 0; font-size: 2em; }
        p { margin: 10px 0; opacity: 0.9; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎵 音频播放服务</h1>
        <p>专业的音频播放解决方案</p>
        <p>扫描二维码即可播放音频文件</p>
        <p style="font-size: 0.9em; margin-top: 30px;">
            技术支持：腾讯云对象存储 COS
        </p>
    </div>
</body>
</html>
"@

$IndexContent | Out-File -FilePath "$TempDir\index.html" -Encoding UTF8

# 使用coscli工具上传（需要先安装coscli）
Write-Host "📁 准备上传文件到COS..." -ForegroundColor Yellow

# 检查是否安装了coscli
$CoscliPath = Get-Command coscli -ErrorAction SilentlyContinue
if (-not $CoscliPath) {
    Write-Host "⚠️  未找到coscli工具，尝试使用curl进行上传..." -ForegroundColor Yellow
    
    # 使用curl直接上传（简化版本）
    $CosEndpoint = "https://$BucketName.cos.$Region.myqcloud.com"
    
    try {
        # 上传play.html
        Write-Host "📤 上传 play.html..." -ForegroundColor Cyan
        $PlayContent = Get-Content $PlayHtmlPath -Raw
        $Response = Invoke-RestMethod -Uri "$CosEndpoint/play.html" -Method PUT -Body $PlayContent -ContentType "text/html; charset=utf-8"
        
        # 上传index.html
        Write-Host "📤 上传 index.html..." -ForegroundColor Cyan
        $Response = Invoke-RestMethod -Uri "$CosEndpoint/index.html" -Method PUT -Body $IndexContent -ContentType "text/html; charset=utf-8"
        
        Write-Host "✅ 文件上传成功！" -ForegroundColor Green
        
    } catch {
        Write-Host "❌ 直接上传失败：$($_.Exception.Message)" -ForegroundColor Red
        Write-Host "💡 建议使用coscli工具进行上传" -ForegroundColor Yellow
    }
} else {
    # 使用coscli上传
    Write-Host "📤 使用coscli上传文件..." -ForegroundColor Cyan
    
    # 配置coscli
    & coscli config set --secret_id $SecretId --secret_key $SecretKey --region $Region
    
    # 同步上传整个目录
    & coscli sync $TempDir "cos://$BucketName/" --delete
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ 文件上传成功！" -ForegroundColor Green
    } else {
        Write-Host "❌ 上传失败，退出码：$LASTEXITCODE" -ForegroundColor Red
    }
}

# 清理临时目录
Remove-Item $TempDir -Recurse -Force

# 输出访问链接
$StaticWebsiteUrl = "https://$BucketName.cos-website.$Region.myqcloud.com"
Write-Host "`n🎉 部署完成！" -ForegroundColor Green
Write-Host "静态网站地址：$StaticWebsiteUrl" -ForegroundColor Cyan
Write-Host "播放器地址：$StaticWebsiteUrl/play.html" -ForegroundColor Cyan

Write-Host "`n📋 下一步操作：" -ForegroundColor Yellow
Write-Host "1. 确保COS存储桶已开启静态网站功能"
Write-Host "2. 在Flutter应用中使用新的URL生成逻辑"
Write-Host "3. 测试微信内的音频播放功能"

Write-Host "`n💡 测试用的URL示例：" -ForegroundColor Magenta
$TestParams = @{
    f = "测试音频.mp3"
    u = "https://$BucketName.cos.$Region.myqcloud.com/audio-files/test.mp3"
}
$TestJson = $TestParams | ConvertTo-Json -Compress
$TestBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($TestJson))
$TestUrl = "$StaticWebsiteUrl/play.html?data=$TestBase64"
Write-Host $TestUrl
