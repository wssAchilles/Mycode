# ⚡ Git 快速推送脚本（简化版）
# 适用于日常小更新的快速提交

param(
    [string]$message = "chore: 日常代码更新 - $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
)

Write-Host "⚡ 快速推送模式" -ForegroundColor Green
Write-Host ""

Set-Location "d:\Code"

# 1. 状态检查
Write-Host "📊 检查状态..." -ForegroundColor Cyan
git status --short | Select-Object -First 10
Write-Host ""

# 2. 添加文件
Write-Host "📁 添加文件..." -ForegroundColor Cyan
git add .

# 3. 提交
Write-Host "💾 提交更改..." -ForegroundColor Cyan
Write-Host "提交信息: $message" -ForegroundColor Yellow
git commit -m $message

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 提交失败或无更改" -ForegroundColor Red
    exit
}

# 4. 推送
Write-Host "📤 推送到远程..." -ForegroundColor Cyan
git push origin master

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ 推送成功！" -ForegroundColor Green
} else {
    Write-Host "❌ 推送失败" -ForegroundColor Red
}

Write-Host ""
