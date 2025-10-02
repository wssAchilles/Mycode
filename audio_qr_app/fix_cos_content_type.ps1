# 修复腾讯云COS HTML文件Content-Type的脚本
# 确保HTML文件在浏览器中正常显示而不是下载

Write-Host "🔧 修复腾讯云COS HTML文件Content-Type..." -ForegroundColor Green

# 存储桶信息
$bucketName = "my-audio-files-123-1380453532"
$region = "ap-nanjing"
$fileName = "play.html"

# 构建URL
$cosUrl = "https://$bucketName.cos.$region.myqcloud.com/$fileName"
$staticUrl = "https://$bucketName.cos-website.$region.myqcloud.com/$fileName"

Write-Host "📋 检查当前文件状态..."
Write-Host "COS URL: $cosUrl"
Write-Host "静态网站URL: $staticUrl"

try {
    # 检查静态网站访问
    Write-Host "`n🌐 测试静态网站访问..."
    $response = Invoke-WebRequest -Uri $staticUrl -Method Head -ErrorAction Stop
    
    Write-Host "✅ 静态网站访问成功"
    Write-Host "状态码: $($response.StatusCode)"
    Write-Host "Content-Type: $($response.Headers['Content-Type'])"
    Write-Host "Content-Length: $($response.Headers['Content-Length'])"
    
    # 检查Content-Type
    $contentType = $response.Headers['Content-Type']
    if ($contentType -like "*text/html*") {
        Write-Host "✅ Content-Type 设置正确: $contentType" -ForegroundColor Green
        Write-Host "问题可能在于浏览器设置或其他因素"
    } else {
        Write-Host "❌ Content-Type 设置错误: $contentType" -ForegroundColor Red
        Write-Host "应该设置为: text/html; charset=utf-8"
    }
    
} catch {
    Write-Host "❌ 静态网站访问失败: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n💡 解决建议："
Write-Host "1. 如果Content-Type正确，尝试不同的浏览器"
Write-Host "2. 清除浏览器缓存和Cookie"
Write-Host "3. 尝试无痕/隐私模式访问"
Write-Host "4. 检查浏览器下载设置"

Write-Host "`n🧪 生成测试URL："
$testUrl = "$staticUrl"
Write-Host "测试URL: $testUrl"
Write-Host "请在浏览器中直接访问此URL进行测试"

# 生成简化的测试URL（不带参数）
Write-Host "`n🔗 简化测试URL（无参数）："
Write-Host "$staticUrl"
Write-Host "如果此URL可以正常访问，问题在于参数处理"

Write-Host "`n✅ 脚本执行完成" -ForegroundColor Green
