# 🔍 Git 推送前检查脚本
# 快速检查即将推送的文件和潜在问题

Write-Host "🔍 Git 推送前检查开始..." -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

Set-Location "d:\Code"

# 1. 检查排除的大型项目是否被追踪
Write-Host "📁 检查排除的项目..." -ForegroundColor Yellow
$excludedProjects = @("BuildPath", "Signal", "Worm", "MyTg", "MyTelegram")
$found = $false

foreach ($project in $excludedProjects) {
    $tracked = git ls-files | Select-String -Pattern "^$project/"
    if ($tracked) {
        Write-Host "⚠️  警告: $project 仍被追踪!" -ForegroundColor Red
        $found = $true
    }
}

if (-not $found) {
    Write-Host "✅ 所有大型项目已正确排除" -ForegroundColor Green
}
Write-Host ""

# 2. 检查 node_modules
Write-Host "📦 检查 node_modules..." -ForegroundColor Yellow
$nodeModules = git ls-files | Select-String -Pattern "node_modules"
if ($nodeModules) {
    Write-Host "⚠️  警告: 发现 node_modules 文件!" -ForegroundColor Red
    Write-Host "   建议运行: git rm -r --cached node_modules" -ForegroundColor Yellow
} else {
    Write-Host "✅ node_modules 已排除" -ForegroundColor Green
}
Write-Host ""

# 3. 检查 .venv 和 Python 缓存
Write-Host "🐍 检查 Python 缓存..." -ForegroundColor Yellow
$pythonCache = git ls-files | Select-String -Pattern "(\.venv|__pycache__|\.pyc)"
if ($pythonCache) {
    Write-Host "⚠️  警告: 发现 Python 缓存文件!" -ForegroundColor Red
} else {
    Write-Host "✅ Python 缓存已排除" -ForegroundColor Green
}
Write-Host ""

# 4. 检查密钥文件
Write-Host "🔐 检查密钥文件..." -ForegroundColor Yellow
$keyFiles = git ls-files | Select-String -Pattern "\.(key|jks|pem|p12|pfx)$"
if ($keyFiles) {
    Write-Host "🚨 严重警告: 发现密钥文件!" -ForegroundColor Red
    $keyFiles | ForEach-Object { Write-Host "   - $_" -ForegroundColor Red }
    Write-Host "   请立即从 Git 中移除这些文件!" -ForegroundColor Red
} else {
    Write-Host "✅ 无密钥文件" -ForegroundColor Green
}
Write-Host ""

# 5. 检查大文件
Write-Host "📊 检查大文件 (>10MB)..." -ForegroundColor Yellow
$largeFiles = git ls-files | ForEach-Object { 
    $file = Get-Item $_ -ErrorAction SilentlyContinue
    if ($file -and $file.Length -gt 10MB) {
        [PSCustomObject]@{
            Path = $_
            SizeMB = [math]::Round($file.Length/1MB, 2)
        }
    }
}

if ($largeFiles) {
    Write-Host "⚠️  发现大文件:" -ForegroundColor Yellow
    $largeFiles | Format-Table -AutoSize
    Write-Host "   考虑使用 Git LFS 或添加到 .gitignore" -ForegroundColor Yellow
} else {
    Write-Host "✅ 无大文件问题" -ForegroundColor Green
}
Write-Host ""

# 6. 统计要推送的文件
Write-Host "📈 文件统计..." -ForegroundColor Yellow
$allFiles = git ls-files
$fileCount = ($allFiles | Measure-Object).Count
$totalSize = ($allFiles | ForEach-Object { 
    $file = Get-Item $_ -ErrorAction SilentlyContinue
    if ($file) { $file.Length }
} | Measure-Object -Sum).Sum
$totalSizeMB = [math]::Round($totalSize/1MB, 2)

Write-Host "   总文件数: $fileCount" -ForegroundColor White
Write-Host "   总大小: $totalSizeMB MB" -ForegroundColor White
Write-Host ""

# 7. 按项目统计
Write-Host "📂 项目统计:" -ForegroundColor Yellow
$projects = @(
    "audio_qr_app", "kindergarten_library", "mychatapp", "wechat",
    "flask", "Firebase", "bytebot",
    "Java", "Cplus", "videos", "AnalysisCode"
)

foreach ($proj in $projects) {
    $projFiles = git ls-files | Select-String -Pattern "^$proj/"
    if ($projFiles) {
        $count = ($projFiles | Measure-Object).Count
        Write-Host "   $proj : $count 文件" -ForegroundColor Cyan
    }
}
Write-Host ""

# 8. 检查 Git 配置
Write-Host "⚙️  Git 配置检查..." -ForegroundColor Yellow
$userName = git config user.name
$userEmail = git config user.email
$remote = git config remote.origin.url

if ($userName -and $userEmail) {
    Write-Host "✅ 用户信息已配置" -ForegroundColor Green
    Write-Host "   姓名: $userName" -ForegroundColor White
    Write-Host "   邮箱: $userEmail" -ForegroundColor White
} else {
    Write-Host "⚠️  警告: 用户信息未完整配置" -ForegroundColor Red
}

if ($remote) {
    Write-Host "✅ 远程仓库已配置" -ForegroundColor Green
    Write-Host "   URL: $remote" -ForegroundColor White
} else {
    Write-Host "⚠️  警告: 远程仓库未配置" -ForegroundColor Red
}
Write-Host ""

# 9. 最终建议
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""
Write-Host "📋 检查完成！建议:" -ForegroundColor Cyan

if (-not $found -and -not $keyFiles -and -not $nodeModules) {
    Write-Host "✅ 可以安全推送!" -ForegroundColor Green
    Write-Host ""
    Write-Host "运行以下命令推送:" -ForegroundColor Yellow
    Write-Host "   .\push-to-git.ps1" -ForegroundColor White
} else {
    Write-Host "⚠️  建议先解决上述问题后再推送" -ForegroundColor Red
    Write-Host ""
    Write-Host "清理命令:" -ForegroundColor Yellow
    Write-Host "   git rm -r --cached ." -ForegroundColor White
    Write-Host "   git add ." -ForegroundColor White
}

Write-Host ""
