# 微信URL测试脚本
# 生成不同格式的测试URL，用于验证微信播放功能

Write-Host "🧪 生成微信播放测试URL..." -ForegroundColor Green

# 配置信息
$StaticWebsiteUrl = "https://my-audio-files-123-1380453532.cos-website.ap-nanjing.myqcloud.com"
$TestFileName = "测试音频文件.mp3"
$TestAudioUrl = "https://my-audio-files-123-1380453532.cos.ap-nanjing.myqcloud.com/audio-files/test_audio.mp3"

Write-Host "`n📋 测试用的音频信息：" -ForegroundColor Cyan
Write-Host "文件名：$TestFileName"
Write-Host "音频URL：$TestAudioUrl"
Write-Host "播放器基址：$StaticWebsiteUrl"

# 生成不同格式的URL进行测试
Write-Host "`n🔗 测试URL列表：" -ForegroundColor Yellow

# 格式1：新的双重Base64编码（最推荐）
Write-Host "`n1️⃣ 双重Base64编码格式（最新，混淆度最高）：" -ForegroundColor Magenta
$Params1 = @{
    'content' = $TestFileName
    'source' = $TestAudioUrl  
    'type' = 'media'
    'version' = '1.0'
    'timestamp' = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
}
$Json1 = $Params1 | ConvertTo-Json -Compress
$FirstBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Json1))
$DoubleBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("media_$FirstBase64"))
$Url1 = "$StaticWebsiteUrl/play.html?id=$DoubleBase64&v=2.0&lang=zh&_t=$([DateTimeOffset]::Now.ToUnixTimeMilliseconds())"
Write-Host $Url1 -ForegroundColor White

# 格式2：简单Base64编码（兼容版本）
Write-Host "`n2️⃣ 简单Base64编码格式（兼容版本）：" -ForegroundColor Magenta
$Params2 = @{
    'f' = $TestFileName
    'u' = $TestAudioUrl
}
$Json2 = $Params2 | ConvertTo-Json -Compress  
$SimpleBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Json2))
$Url2 = "$StaticWebsiteUrl/play.html?data=$SimpleBase64"
Write-Host $Url2 -ForegroundColor White

# 格式3：直接参数（最简单，但容易被检测）
Write-Host "`n3️⃣ 直接参数格式（最简单，用于对比）：" -ForegroundColor Magenta
$EncodedFilename = [System.Web.HttpUtility]::UrlEncode($TestFileName)
$EncodedAudioUrl = [System.Web.HttpUtility]::UrlEncode($TestAudioUrl)
$Url3 = "$StaticWebsiteUrl/play.html?filename=$EncodedFilename&url=$EncodedAudioUrl"
Write-Host $Url3 -ForegroundColor White

# 格式4：额外混淆版本
Write-Host "`n4️⃣ 额外混淆格式（实验性）：" -ForegroundColor Magenta
$Params4 = @{
    'payload' = $TestAudioUrl
    'title' = $TestFileName
    'format' = 'audio'
    'session' = [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
}
$Json4 = $Params4 | ConvertTo-Json -Compress
$ExtraBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Json4))
$Url4 = "$StaticWebsiteUrl/play.html?s=$ExtraBase64&ver=1.2&locale=zh-CN"
Write-Host $Url4 -ForegroundColor White

Write-Host "`n📱 测试方法：" -ForegroundColor Green
Write-Host "1. 将以上URL逐一复制到浏览器测试"
Write-Host "2. 使用二维码生成器生成二维码"
Write-Host "3. 用微信扫描测试播放效果"
Write-Host "4. 观察是否还会出现'下载文件'提示"

Write-Host "`n⭐ 推荐测试顺序：" -ForegroundColor Cyan
Write-Host "URL1 (双重Base64) → URL2 (简单Base64) → URL3 (直接参数)"
Write-Host "如果URL1成功避免下载提示，则说明混淆策略有效"

Write-Host "`n🔍 调试提示：" -ForegroundColor Yellow
Write-Host "• 在浏览器中按F12查看控制台输出"
Write-Host "• 关注参数解析成功/失败的日志"
Write-Host "• 微信中可能需要点击'继续访问'才能进入播放器"

# 保存URL到文件
$UrlsContent = @"
# 微信播放测试URL列表
# 生成时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

## 双重Base64编码格式（推荐）
$Url1

## 简单Base64编码格式（兼容）
$Url2

## 直接参数格式（对比）
$Url3

## 额外混淆格式（实验）
$Url4

## 测试说明
1. 用微信扫描上述URL的二维码
2. 观察是否还出现下载提示
3. 测试音频播放功能是否正常
4. 推荐优先测试第一个URL
"@

$UrlsContent | Out-File -FilePath ".\test_urls.txt" -Encoding UTF8
Write-Host "`n💾 测试URL已保存到 test_urls.txt 文件" -ForegroundColor Green
