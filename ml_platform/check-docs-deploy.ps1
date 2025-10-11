# 检查 VitePress 文档部署配置

Write-Host "🚀 开始检查 VitePress 文档部署配置..." -ForegroundColor Cyan
Write-Host ""

$allPassed = $true
$repoName = ""

# 检查 Node.js
Write-Host "📦 检查 Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✅ Node.js 版本: $nodeVersion" -ForegroundColor Green
    } else {
        Write-Host "   ❌ Node.js 未安装或未添加到 PATH" -ForegroundColor Red
        $allPassed = $false
    }
} catch {
    Write-Host "   ❌ Node.js 未安装或未添加到 PATH" -ForegroundColor Red
    $allPassed = $false
}

# 检查 npm
Write-Host "📦 检查 npm..." -ForegroundColor Yellow
try {
    $npmVersion = npm --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✅ npm 版本: $npmVersion" -ForegroundColor Green
    } else {
        Write-Host "   ❌ npm 未安装" -ForegroundColor Red
        $allPassed = $false
    }
} catch {
    Write-Host "   ❌ npm 未安装" -ForegroundColor Red
    $allPassed = $false
}

# 检查 Git
Write-Host "🔧 检查 Git..." -ForegroundColor Yellow
try {
    $gitVersion = git --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✅ $gitVersion" -ForegroundColor Green
    } else {
        Write-Host "   ❌ Git 未安装或未添加到 PATH" -ForegroundColor Red
        $allPassed = $false
    }
} catch {
    Write-Host "   ❌ Git 未安装或未添加到 PATH" -ForegroundColor Red
    $allPassed = $false
}

# 检查 Git 远程仓库
Write-Host "🌐 检查 Git 远程仓库..." -ForegroundColor Yellow
try {
    $remoteUrl = git config --get remote.origin.url 2>&1
    if ($LASTEXITCODE -eq 0 -and $remoteUrl) {
        Write-Host "   ✅ 远程仓库: $remoteUrl" -ForegroundColor Green
        
        # 提取仓库名
        if ($remoteUrl -match '/([^/]+?)(\.git)?$') {
            $repoName = $matches[1]
            Write-Host "   ℹ️  仓库名称: $repoName" -ForegroundColor Cyan
        }
    } else {
        Write-Host "   ❌ 未配置 Git 远程仓库" -ForegroundColor Red
        $allPassed = $false
    }
} catch {
    Write-Host "   ❌ 未配置 Git 远程仓库" -ForegroundColor Red
    $allPassed = $false
}

# 检查 docs 目录
Write-Host "📁 检查 docs 目录..." -ForegroundColor Yellow
if (Test-Path "docs") {
    Write-Host "   ✅ docs 目录存在" -ForegroundColor Green
    
    # 检查关键文件
    $files = @(
        "docs\.vitepress\config.js",
        "docs\package.json",
        "docs\index.md"
    )
    
    foreach ($file in $files) {
        if (Test-Path $file) {
            Write-Host "   ✅ $file 存在" -ForegroundColor Green
        } else {
            Write-Host "   ❌ $file 不存在" -ForegroundColor Red
            $allPassed = $false
        }
    }
} else {
    Write-Host "   ❌ docs 目录不存在" -ForegroundColor Red
    $allPassed = $false
}

# 检查 node_modules
Write-Host "📦 检查依赖安装..." -ForegroundColor Yellow
if (Test-Path "docs\node_modules") {
    Write-Host "   ✅ 依赖已安装" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  依赖未安装,请运行: cd docs; npm install" -ForegroundColor Yellow
}

# 检查 GitHub Actions workflow
Write-Host "🔄 检查 GitHub Actions..." -ForegroundColor Yellow
if (Test-Path ".github\workflows\deploy-docs.yml") {
    Write-Host "   ✅ deploy-docs.yml 存在" -ForegroundColor Green
} else {
    Write-Host "   ❌ .github\workflows\deploy-docs.yml 不存在" -ForegroundColor Red
    $allPassed = $false
}

# 检查 config.js 中的 base 配置
Write-Host "⚙️  检查 VitePress 配置..." -ForegroundColor Yellow
if (Test-Path "docs\.vitepress\config.js") {
    $configContent = Get-Content "docs\.vitepress\config.js" -Raw
    $basePattern = "base:\s*[`"']([^`"']+)[`"']"
    if ($configContent -match $basePattern) {
        $baseConfig = $matches[1]
        Write-Host "   ✅ base 配置: $baseConfig" -ForegroundColor Green
        
        if ($repoName -and ($baseConfig -notlike "*$repoName*")) {
            Write-Host "   ⚠️  警告: base 配置可能与仓库名不匹配" -ForegroundColor Yellow
            Write-Host "      仓库名: $repoName" -ForegroundColor Yellow
            Write-Host "      base 配置: $baseConfig" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   ⚠️  未找到 base 配置" -ForegroundColor Yellow
    }
}

# 总结
Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
if ($allPassed) {
    Write-Host "✅ 所有检查通过!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 下一步操作:" -ForegroundColor Cyan
    Write-Host "   1. 提交代码: git add ." -ForegroundColor White
    Write-Host "      然后: git commit -m `"docs: add documentation`"" -ForegroundColor White
    Write-Host "   2. 推送到 GitHub: git push origin main" -ForegroundColor White
    Write-Host "   3. 在 GitHub 仓库设置中启用 Pages (Settings -> Pages)" -ForegroundColor White
    Write-Host "   4. 配置 Actions 权限 (Settings -> Actions -> General)" -ForegroundColor White
    if ($repoName) {
        Write-Host "   5. 访问文档: https://wssAchilles.github.io/$repoName/" -ForegroundColor White
    }
} else {
    Write-Host "❌ 部分检查失败,请修复上述问题" -ForegroundColor Red
}
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""
