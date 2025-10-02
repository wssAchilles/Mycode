# 简化的腾讯云COS部署脚本
# 直接使用HTTP PUT请求上传文件

Write-Host "🚀 开始部署音频播放器到腾讯云COS..." -ForegroundColor Green

# 配置信息
$BucketName = "my-audio-files-123-1380453532"
$Region = "ap-nanjing"
$CosEndpoint = "https://$BucketName.cos.$Region.myqcloud.com"

# 检查play.html文件
if (-not (Test-Path ".\play.html")) {
    Write-Host "❌ 错误：找不到 play.html 文件" -ForegroundColor Red
    exit 1
}

Write-Host "📁 读取 play.html 文件..." -ForegroundColor Yellow
$PlayContent = Get-Content ".\play.html" -Raw -Encoding UTF8

# 上传play.html
Write-Host "📤 上传 play.html 到 $CosEndpoint/play.html" -ForegroundColor Cyan

try {
    $Headers = @{
        'Content-Type' = 'text/html; charset=utf-8'
        'Cache-Control' = 'public, max-age=3600'
    }
    
    # 使用PowerShell的Invoke-RestMethod上传
    $Response = Invoke-RestMethod -Uri "$CosEndpoint/play.html" `
                                  -Method PUT `
                                  -Body ([System.Text.Encoding]::UTF8.GetBytes($PlayContent)) `
                                  -Headers $Headers `
                                  -ErrorAction Stop
    
    Write-Host "✅ play.html 上传成功！" -ForegroundColor Green
    
} catch {
    $StatusCode = $null
    $StatusDescription = "未知错误"
    
    # 尝试获取HTTP状态码
    if ($_.Exception.Response) {
        $StatusCode = $_.Exception.Response.StatusCode.value__
        $StatusDescription = $_.Exception.Response.StatusDescription
    }
    
    # 根据状态码提供具体的错误信息
    if ($StatusCode -eq 403) {
        Write-Host "❌ 上传失败：权限不足 (403)" -ForegroundColor Red
        Write-Host "💡 请检查：" -ForegroundColor Yellow
        Write-Host "   1. 存储桶是否设置为公共读写权限"
        Write-Host "   2. 或者需要使用签名认证"
    } elseif ($StatusCode -eq 404) {
        Write-Host "❌ 上传失败：存储桶不存在 (404)" -ForegroundColor Red
        Write-Host "💡 请检查存储桶名称和地域是否正确"
    } else {
        Write-Host "❌ 上传失败：$StatusCode - $StatusDescription" -ForegroundColor Red
        Write-Host "错误详情：$($_.Exception.Message)" -ForegroundColor Red
    }
    
    Write-Host "`n🔧 解决方案：" -ForegroundColor Magenta
    Write-Host "1. 在腾讯云控制台中，进入COS存储桶设置"
    Write-Host "2. 设置访问权限为 '公有读私有写' 或 '公有读写'"
    Write-Host "3. 或者配置CORS规则允许跨域上传"
    exit 1
}

# 验证上传结果
Write-Host "🔍 验证上传结果..." -ForegroundColor Yellow
try {
    $VerifyResponse = Invoke-WebRequest -Uri "$CosEndpoint/play.html" -Method HEAD -ErrorAction Stop
    Write-Host "✅ 文件验证成功，状态码：$($VerifyResponse.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "⚠️  文件验证失败，但可能已上传成功" -ForegroundColor Orange
}

# 输出访问信息
$StaticWebsiteUrl = "https://$BucketName.cos-website.$Region.myqcloud.com"
Write-Host "`n🎉 部署完成！" -ForegroundColor Green
Write-Host "🌐 静态网站地址：$StaticWebsiteUrl" -ForegroundColor Cyan
Write-Host "🎵 播放器地址：$StaticWebsiteUrl/play.html" -ForegroundColor Cyan

Write-Host "`n📋 接下来的步骤：" -ForegroundColor Yellow
Write-Host "1. 确保在腾讯云控制台中已开启静态网站功能"
Write-Host "2. 重新编译Flutter应用使用新的URL生成逻辑"
Write-Host "3. 用微信扫描二维码测试播放功能"

Write-Host "`n💡 测试用的URL示例：" -ForegroundColor Magenta
$TestFileName = "测试音频.mp3"
$TestAudioUrl = "$CosEndpoint/audio-files/test.mp3"

# 生成测试用的双重Base64编码URL
$TestParams = @{
    'content' = $TestFileName
    'source' = $TestAudioUrl  
    'type' = 'media'
    'version' = '1.0'
    'timestamp' = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
}

$TestJson = $TestParams | ConvertTo-Json -Compress
$FirstBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($TestJson))
$DoubleBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("media_$FirstBase64"))

$TestUrl = "$StaticWebsiteUrl/play.html?id=$DoubleBase64&v=2.0&lang=zh&_t=$([DateTimeOffset]::Now.ToUnixTimeMilliseconds())"
Write-Host $TestUrl

Write-Host "`n🔗 简化版测试URL（兼容旧版本）：" -ForegroundColor Magenta
$SimpleParams = @{
    'f' = $TestFileName
    'u' = $TestAudioUrl
}
$SimpleJson = $SimpleParams | ConvertTo-Json -Compress  
$SimpleBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($SimpleJson))
$SimpleUrl = "$StaticWebsiteUrl/play.html?data=$SimpleBase64"
Write-Host $SimpleUrl
