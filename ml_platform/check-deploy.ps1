# VitePress Documentation Deployment Checker
# 检查 VitePress 文档部署配置

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " VitePress 文档部署配置检查工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$script:allPassed = $true
$script:repoName = ""

# 检查 Node.js
Write-Host "[1/8] 检查 Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = & node --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Node.js: $nodeVersion" -ForegroundColor Green
    }
    else {
        throw "Node.js not found"
    }
}
catch {
    Write-Host "  ✗ Node.js 未安装或未添加到 PATH" -ForegroundColor Red
    $script:allPassed = $false
}

# 检查 npm
Write-Host "[2/8] 检查 npm..." -ForegroundColor Yellow
try {
    $npmVersion = & npm --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ npm: $npmVersion" -ForegroundColor Green
    }
    else {
        throw "npm not found"
    }
}
catch {
    Write-Host "  ✗ npm 未安装" -ForegroundColor Red
    $script:allPassed = $false
}

# 检查 Git
Write-Host "[3/8] 检查 Git..." -ForegroundColor Yellow
try {
    $gitVersion = & git --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ $gitVersion" -ForegroundColor Green
    }
    else {
        throw "Git not found"
    }
}
catch {
    Write-Host "  ✗ Git 未安装或未添加到 PATH" -ForegroundColor Red
    $script:allPassed = $false
}

# 检查 Git 远程仓库
Write-Host "[4/8] 检查 Git 远程仓库..." -ForegroundColor Yellow
try {
    $remoteUrl = & git config --get remote.origin.url 2>&1
    if ($LASTEXITCODE -eq 0 -and $remoteUrl) {
        Write-Host "  ✓ 远程仓库: $remoteUrl" -ForegroundColor Green
        
        # 提取仓库名
        if ($remoteUrl -match '/([^/]+?)(\.git)?$') {
            $script:repoName = $matches[1]
            Write-Host "  ℹ 仓库名称: $($script:repoName)" -ForegroundColor Cyan
        }
    }
    else {
        throw "No remote configured"
    }
}
catch {
    Write-Host "  ✗ 未配置 Git 远程仓库" -ForegroundColor Red
    $script:allPassed = $false
}

# 检查 docs 目录
Write-Host "[5/8] 检查 docs 目录结构..." -ForegroundColor Yellow
$docsExists = Test-Path "docs"
if ($docsExists) {
    Write-Host "  ✓ docs 目录存在" -ForegroundColor Green
    
    # 检查关键文件
    $requiredFiles = @{
        "docs\.vitepress\config.js" = "VitePress 配置文件"
        "docs\package.json"         = "npm 包配置文件"
        "docs\index.md"             = "文档首页"
    }
    
    foreach ($filePath in $requiredFiles.Keys) {
        $fileDesc = $requiredFiles[$filePath]
        if (Test-Path $filePath) {
            Write-Host "  ✓ $fileDesc" -ForegroundColor Green
        }
        else {
            Write-Host "  ✗ $fileDesc 不存在" -ForegroundColor Red
            $script:allPassed = $false
        }
    }
}
else {
    Write-Host "  ✗ docs 目录不存在" -ForegroundColor Red
    $script:allPassed = $false
}

# 检查 node_modules
Write-Host "[6/8] 检查依赖安装..." -ForegroundColor Yellow
if (Test-Path "docs\node_modules") {
    Write-Host "  ✓ 依赖已安装" -ForegroundColor Green
}
else {
    Write-Host "  ⚠ 依赖未安装" -ForegroundColor Yellow
    Write-Host "    运行: cd docs; npm install" -ForegroundColor Gray
}

# 检查 GitHub Actions workflow
Write-Host "[7/8] 检查 GitHub Actions..." -ForegroundColor Yellow
if (Test-Path ".github\workflows\deploy-docs.yml") {
    Write-Host "  ✓ deploy-docs.yml 存在" -ForegroundColor Green
}
else {
    Write-Host "  ✗ .github\workflows\deploy-docs.yml 不存在" -ForegroundColor Red
    $script:allPassed = $false
}

# 检查 VitePress 配置
Write-Host "[8/8] 检查 VitePress 配置..." -ForegroundColor Yellow
$configPath = "docs\.vitepress\config.js"
if (Test-Path $configPath) {
    try {
        $configContent = Get-Content $configPath -Raw -Encoding UTF8
        
        # 检查 base 配置
        if ($configContent -match 'base:\s*[''"`]([^''"`]+)[''"`]') {
            $baseConfig = $matches[1]
            Write-Host "  ✓ base 配置: $baseConfig" -ForegroundColor Green
            
            # 检查是否与仓库名匹配
            if ($script:repoName -and ($baseConfig -notlike "*$($script:repoName)*")) {
                Write-Host "  ⚠ base 配置可能与仓库名不匹配" -ForegroundColor Yellow
                Write-Host "    仓库名: $($script:repoName)" -ForegroundColor Gray
                Write-Host "    base: $baseConfig" -ForegroundColor Gray
            }
        }
        else {
            Write-Host "  ⚠ 未找到 base 配置" -ForegroundColor Yellow
        }
        
        # 检查 title
        if ($configContent -match 'title:\s*[''"`]([^''"`]+)[''"`]') {
            $title = $matches[1]
            Write-Host "  ✓ 站点标题: $title" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "  ✗ 读取配置文件失败: $_" -ForegroundColor Red
        $script:allPassed = $false
    }
}
else {
    Write-Host "  ✗ 配置文件不存在" -ForegroundColor Red
    $script:allPassed = $false
}

# 显示总结
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
if ($script:allPassed) {
    Write-Host " ✓ 所有检查通过!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "下一步操作:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. 提交代码到 GitHub:" -ForegroundColor White
    Write-Host "   git add ." -ForegroundColor Gray
    Write-Host "   git commit -m `"docs: add VitePress documentation`"" -ForegroundColor Gray
    Write-Host "   git push origin main" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. 配置 GitHub Pages:" -ForegroundColor White
    Write-Host "   a. 访问: https://github.com/wssAchilles/$($script:repoName)/settings/pages" -ForegroundColor Gray
    Write-Host "   b. Source 选择: GitHub Actions" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. 配置 Actions 权限:" -ForegroundColor White
    Write-Host "   a. 访问: https://github.com/wssAchilles/$($script:repoName)/settings/actions" -ForegroundColor Gray
    Write-Host "   b. Workflow permissions: Read and write permissions" -ForegroundColor Gray
    Write-Host ""
    Write-Host "4. 访问文档站点:" -ForegroundColor White
    if ($script:repoName) {
        Write-Host "   https://wssAchilles.github.io/$($script:repoName)/" -ForegroundColor Cyan
    }
    Write-Host ""
}
else {
    Write-Host " ✗ 检查未通过" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "请修复上述错误后重新运行此脚本。" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "提示: 详细的部署指南请查看 docs/guide/deployment.md" -ForegroundColor Gray
Write-Host ""
