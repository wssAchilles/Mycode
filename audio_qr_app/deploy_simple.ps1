# 简化的腾讯云COS部署脚本
# 避免复杂的错误处理，直接使用基本的上传方式

Write-Host "🚀 开始部署音频播放器到腾讯云COS..." -ForegroundColor Green

# 配置信息
$BucketName = "my-audio-files-123-1380453532"
$Region = "ap-nanjing"
$CosEndpoint = "https://$BucketName.cos.$Region.myqcloud.com"

# 检查play.html文件
if (-not (Test-Path ".\play.html")) {
    Write-Host "❌ 错误：找不到 play.html 文件" -ForegroundColor Red
    Write-Host "请确保在项目根目录执行此脚本" -ForegroundColor Yellow
    exit 1
}

Write-Host "📁 读取 play.html 文件..." -ForegroundColor Yellow
$PlayContent = Get-Content ".\play.html" -Raw -Encoding UTF8

Write-Host "📤 上传 play.html 到 COS..." -ForegroundColor Cyan
Write-Host "目标地址：$CosEndpoint/play.html" -ForegroundColor Gray

# 设置请求头
$Headers = @{
    'Content-Type' = 'text/html; charset=utf-8'
    'Cache-Control' = 'public, max-age=3600'
}

# 执行上传
try {
    $Response = Invoke-WebRequest -Uri "$CosEndpoint/play.html" -Method PUT -Body ([System.Text.Encoding]::UTF8.GetBytes($PlayContent)) -Headers $Headers -UseBasicParsing

    Write-Host "✅ 上传完成！状态码：$($Response.StatusCode)" -ForegroundColor Green
    
    if ($Response.StatusCode -eq 200 -or $Response.StatusCode -eq 201) {
        Write-Host "🎉 play.html 部署成功！" -ForegroundColor Green
    } else {
        Write-Host "⚠️  上传可能未完全成功，状态码：$($Response.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ 上传失败" -ForegroundColor Red
    Write-Host "错误信息：$($_.Exception.Message)" -ForegroundColor Red
    
    Write-Host "`n💡 可能的解决方案：" -ForegroundColor Yellow
    Write-Host "1. 检查网络连接"
    Write-Host "2. 在腾讯云控制台设置存储桶为公共读写权限"
    Write-Host "3. 或手动在COS控制台上传play.html文件"
    exit 1
}

# 验证上传
Write-Host "`n🔍 验证上传结果..." -ForegroundColor Yellow
try {
    $VerifyResponse = Invoke-WebRequest -Uri "$CosEndpoint/play.html" -Method GET -UseBasicParsing
    if ($VerifyResponse.StatusCode -eq 200) {
        Write-Host "✅ 文件验证成功，可以正常访问" -ForegroundColor Green
    }
}
catch {
    Write-Host "⚠️  验证请求失败，但文件可能已成功上传" -ForegroundColor Yellow
}

# 输出结果信息
$StaticWebsiteUrl = "https://$BucketName.cos-website.$Region.myqcloud.com"

Write-Host "`n🎉 部署完成！" -ForegroundColor Green -BackgroundColor DarkGreen
Write-Host "🌐 静态网站地址：" -ForegroundColor Cyan -NoNewline
Write-Host $StaticWebsiteUrl -ForegroundColor White
Write-Host "🎵 播放器地址：" -ForegroundColor Cyan -NoNewline  
Write-Host "$StaticWebsiteUrl/play.html" -ForegroundColor White

Write-Host "`n📋 下一步操作：" -ForegroundColor Yellow
Write-Host "1. 在腾讯云控制台确认已开启静态网站功能"
Write-Host "2. 重新编译Flutter应用：flutter build apk --release"
Write-Host "3. 使用新APK测试二维码功能"

Write-Host "`n🧪 生成测试URL..." -ForegroundColor Magenta
$TestFileName = "测试音频.mp3"
$TestAudioUrl = "$CosEndpoint/audio-files/test.mp3"

# 生成简单Base64测试URL
$SimpleParams = @{
    'f' = $TestFileName
    'u' = $TestAudioUrl
} | ConvertTo-Json -Compress
$SimpleBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($SimpleParams))
$TestUrl = "$StaticWebsiteUrl/play.html?data=$SimpleBase64"

Write-Host "测试URL："
Write-Host $TestUrl -ForegroundColor White

Write-Host "`n✨ 部署完成！请使用新编译的APK测试功能。" -ForegroundColor Green
