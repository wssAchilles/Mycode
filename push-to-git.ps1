# 📤 Git 智能推送脚本
# 用途: 自动清理、添加和推送代码到 Git 仓库
# 作者: wssAchilles
# 日期: 2025-10-02

Write-Host "🚀 开始 Git 推送流程..." -ForegroundColor Green
Write-Host ""

# 切换到项目目录
Set-Location "d:\Code"

# ============================================
# 1. 检查 Git 状态
# ============================================
Write-Host "📊 检查 Git 状态..." -ForegroundColor Cyan
git status --short | Select-Object -First 20
Write-Host ""

$confirmation = Read-Host "是否继续推送? (y/n)"
if ($confirmation -ne 'y') {
    Write-Host "❌ 取消推送" -ForegroundColor Red
    exit
}

# ============================================
# 2. 清理 Git 缓存
# ============================================
Write-Host "🧹 清理 Git 缓存..." -ForegroundColor Cyan
git rm -r --cached . 2>$null
Write-Host "✅ 缓存清理完成" -ForegroundColor Green
Write-Host ""

# ============================================
# 3. 重新添加文件
# ============================================
Write-Host "📁 重新添加文件..." -ForegroundColor Cyan
git add .

# 显示即将提交的文件统计
$stagedFiles = git diff --cached --name-only
$fileCount = ($stagedFiles | Measure-Object).Count
Write-Host "✅ 已暂存 $fileCount 个文件" -ForegroundColor Green
Write-Host ""

# ============================================
# 4. 检查是否有大文件
# ============================================
Write-Host "🔍 检查大文件（>50MB）..." -ForegroundColor Cyan
$largeFiles = git ls-files | ForEach-Object { 
    $file = Get-Item $_ -ErrorAction SilentlyContinue
    if ($file -and $file.Length -gt 50MB) {
        [PSCustomObject]@{
            Name = $file.Name
            Size = [math]::Round($file.Length/1MB, 2)
        }
    }
}

if ($largeFiles) {
    Write-Host "⚠️  发现大文件:" -ForegroundColor Yellow
    $largeFiles | Format-Table -AutoSize
    Write-Host "提示: 考虑使用 Git LFS 或将这些文件添加到 .gitignore" -ForegroundColor Yellow
    Write-Host ""
    
    $continueWithLarge = Read-Host "是否继续? (y/n)"
    if ($continueWithLarge -ne 'y') {
        Write-Host "❌ 取消推送" -ForegroundColor Red
        exit
    }
} else {
    Write-Host "✅ 没有发现大文件" -ForegroundColor Green
}
Write-Host ""

# ============================================
# 5. 创建提交
# ============================================
Write-Host "💾 创建提交..." -ForegroundColor Cyan
$commitMessage = @"
chore: 更新大学生涯项目集合 - $(Get-Date -Format "yyyy-MM-dd")

更新内容:
- ✅ 完善项目 README 文档
- ✅ 优化 .gitignore 配置
- ✅ 添加核心项目代码
- ✅ 排除大型依赖和构建文件

包含项目:
- 📱 Flutter 移动应用 (kindergarten_library, mychatapp, audio_qr_app, wechat)
- 🌐 Web 全栈项目 (flask, Firebase, bytebot)
- ☕ Java 企业应用 (blog, web, urban-environment)
- 🔧 工具与算法 (videos, Cplus, AnalysisCode)

排除项目:
- ❌ BuildPath (大型 C++ 构建环境)
- ❌ Signal (Java 服务器项目)
- ❌ Worm (大型爬虫项目)
- ❌ MyTg, MyTelegram (用户指定排除)
"@

git commit -m $commitMessage

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 提交失败" -ForegroundColor Red
    exit
}

Write-Host "✅ 提交成功" -ForegroundColor Green
Write-Host ""

# ============================================
# 6. 推送到远程仓库
# ============================================
Write-Host "📤 推送到远程仓库..." -ForegroundColor Cyan
Write-Host "目标: origin master" -ForegroundColor Yellow
Write-Host ""

$pushConfirmation = Read-Host "确认推送到 GitHub? (y/n)"
if ($pushConfirmation -ne 'y') {
    Write-Host "❌ 取消推送" -ForegroundColor Red
    Write-Host "💡 提示: 提交已保存到本地，稍后可使用 'git push origin master' 手动推送" -ForegroundColor Yellow
    exit
}

git push origin master

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "❌ 推送失败" -ForegroundColor Red
    Write-Host ""
    Write-Host "可能的原因:" -ForegroundColor Yellow
    Write-Host "1. 网络连接问题" -ForegroundColor Yellow
    Write-Host "2. 文件过大（超过 GitHub 限制）" -ForegroundColor Yellow
    Write-Host "3. 需要身份验证" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "解决方案:" -ForegroundColor Cyan
    Write-Host "1. 检查网络连接" -ForegroundColor Cyan
    Write-Host "2. 增加缓冲区: git config http.postBuffer 524288000" -ForegroundColor Cyan
    Write-Host "3. 使用 GitHub Desktop 或配置 SSH 密钥" -ForegroundColor Cyan
    exit
}

Write-Host ""
Write-Host "✅ 推送成功！" -ForegroundColor Green
Write-Host ""

# ============================================
# 7. 显示推送结果
# ============================================
Write-Host "📊 推送结果摘要:" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

# 显示最近的提交
Write-Host ""
Write-Host "最近提交:" -ForegroundColor Yellow
git log --oneline -3

Write-Host ""
Write-Host "远程仓库:" -ForegroundColor Yellow
git remote -v

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""
Write-Host "🎉 全部完成！您的代码已成功推送到 GitHub!" -ForegroundColor Green
Write-Host ""
Write-Host "📍 GitHub 仓库地址:" -ForegroundColor Cyan
Write-Host "   https://github.com/wssAchilles/Mycode" -ForegroundColor White
Write-Host ""
Write-Host "💡 下一步:" -ForegroundColor Yellow
Write-Host "   1. 访问 GitHub 查看您的项目" -ForegroundColor White
Write-Host "   2. 检查 README.md 在 GitHub 上的显示效果" -ForegroundColor White
Write-Host "   3. 考虑添加 LICENSE 文件" -ForegroundColor White
Write-Host "   4. 配置 GitHub Pages（如需要）" -ForegroundColor White
Write-Host ""

# 询问是否打开浏览器
$openBrowser = Read-Host "是否在浏览器中打开 GitHub 仓库? (y/n)"
if ($openBrowser -eq 'y') {
    Start-Process "https://github.com/wssAchilles/Mycode"
}

Write-Host ""
Write-Host "✨ 感谢使用 Git 智能推送脚本！" -ForegroundColor Magenta
Write-Host ""
