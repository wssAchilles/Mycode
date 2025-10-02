# 上传修复后的play.html文件

$bucketName = "my-audio-files-123-1380453532"
$region = "ap-nanjing"
$fileName = "play.html"
$filePath = "d:\Code\audio_qr_app\play.html"

Write-Host "🔄 正在上传修复后的play.html..." -ForegroundColor Green

try {
    # 检查文件是否存在
    if (-not (Test-Path $filePath)) {
        throw "文件不存在: $filePath"
    }

    # 读取文件内容
    $content = Get-Content -Path $filePath -Raw -Encoding UTF8
    Write-Host "📁 文件大小: $($content.Length) 字符"

    # 构建上传URL
    $uploadUrl = "https://$bucketName.cos.$region.myqcloud.com/$fileName"
    Write-Host "🌐 上传URL: $uploadUrl"

    # 上传文件
    $headers = @{
        'Content-Type' = 'text/html; charset=utf-8'
        'x-cos-acl' = 'public-read'
        'Cache-Control' = 'public, max-age=3600'
    }

    $body = [System.Text.Encoding]::UTF8.GetBytes($content)
    $response = Invoke-RestMethod -Uri $uploadUrl -Method Put -Body $body -Headers $headers -TimeoutSec 30

    Write-Host "✅ play.html上传成功！" -ForegroundColor Green

    # 验证静态网站访问
    $staticUrl = "https://$bucketName.cos-website.$region.myqcloud.com/$fileName"
    Write-Host "🔗 静态网站URL: $staticUrl"

    # 等待生效
    Start-Sleep -Seconds 3

    # 验证访问
    Write-Host "🧪 验证访问..."
    $testResponse = Invoke-WebRequest -Uri $staticUrl -Method Head -TimeoutSec 10
    Write-Host "✅ 验证成功，状态码: $($testResponse.StatusCode)" -ForegroundColor Green

    Write-Host "`n🎯 修复说明："
    Write-Host "1. 新增localStorage参数保存功能"
    Write-Host "2. 离线模式增加localStorage恢复功能"
    Write-Host "3. 现在下载的HTML文件应该能正常播放音频"
    Write-Host "`n📱 测试步骤："
    Write-Host "1. 重新生成二维码（应该显示参数URL）"
    Write-Host "2. 扫码访问（浏览器会先保存参数）"
    Write-Host "3. 即使下载HTML文件，也能从localStorage恢复参数"

} catch {
    Write-Host "❌ 上传失败: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "💡 可能的原因："
    Write-Host "  - 网络连接问题"
    Write-Host "  - COS权限配置问题"
    Write-Host "  - 文件路径错误"
}

Write-Host "`n⚡ 脚本执行完成" -ForegroundColor Yellow
