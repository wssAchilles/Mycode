# VitePress Deployment Checker
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host "VitePress Documentation Deployment Check" -ForegroundColor Cyan
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host ""

$allPassed = $true
$repoName = ""

# Check Node.js
Write-Host "[1/8] Checking Node.js..." -ForegroundColor Yellow
$nodeCheck = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCheck) {
    $nodeVersion = node --version
    Write-Host "  OK: Node.js $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "  ERROR: Node.js not found" -ForegroundColor Red
    $allPassed = $false
}

# Check npm
Write-Host "[2/8] Checking npm..." -ForegroundColor Yellow
$npmCheck = Get-Command npm -ErrorAction SilentlyContinue
if ($npmCheck) {
    $npmVersion = npm --version
    Write-Host "  OK: npm $npmVersion" -ForegroundColor Green
} else {
    Write-Host "  ERROR: npm not found" -ForegroundColor Red
    $allPassed = $false
}

# Check Git
Write-Host "[3/8] Checking Git..." -ForegroundColor Yellow
$gitCheck = Get-Command git -ErrorAction SilentlyContinue
if ($gitCheck) {
    $gitVersion = git --version
    Write-Host "  OK: $gitVersion" -ForegroundColor Green
} else {
    Write-Host "  ERROR: Git not found" -ForegroundColor Red
    $allPassed = $false
}

# Check Git remote
Write-Host "[4/8] Checking Git remote..." -ForegroundColor Yellow
try {
    $remoteUrl = git config --get remote.origin.url 2>&1
    if ($remoteUrl) {
        Write-Host "  OK: $remoteUrl" -ForegroundColor Green
        if ($remoteUrl -match '/([^/]+?)(\.git)?$') {
            $repoName = $matches[1]
            Write-Host "  INFO: Repository name is '$repoName'" -ForegroundColor Cyan
        }
    } else {
        Write-Host "  ERROR: No Git remote configured" -ForegroundColor Red
        $allPassed = $false
    }
} catch {
    Write-Host "  ERROR: Cannot get Git remote" -ForegroundColor Red
    $allPassed = $false
}

# Check docs directory
Write-Host "[5/8] Checking docs structure..." -ForegroundColor Yellow
if (Test-Path "docs") {
    Write-Host "  OK: docs directory exists" -ForegroundColor Green
    
    if (Test-Path "docs\.vitepress\config.js") {
        Write-Host "  OK: config.js exists" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: config.js not found" -ForegroundColor Red
        $allPassed = $false
    }
    
    if (Test-Path "docs\package.json") {
        Write-Host "  OK: package.json exists" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: package.json not found" -ForegroundColor Red
        $allPassed = $false
    }
    
    if (Test-Path "docs\index.md") {
        Write-Host "  OK: index.md exists" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: index.md not found" -ForegroundColor Red
        $allPassed = $false
    }
} else {
    Write-Host "  ERROR: docs directory not found" -ForegroundColor Red
    $allPassed = $false
}

# Check node_modules
Write-Host "[6/8] Checking dependencies..." -ForegroundColor Yellow
if (Test-Path "docs\node_modules") {
    Write-Host "  OK: Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "  WARNING: Dependencies not installed" -ForegroundColor Yellow
    Write-Host "    Run: cd docs; npm install" -ForegroundColor Gray
}

# Check GitHub Actions
Write-Host "[7/8] Checking GitHub Actions..." -ForegroundColor Yellow
if (Test-Path ".github\workflows\deploy-docs.yml") {
    Write-Host "  OK: deploy-docs.yml exists" -ForegroundColor Green
} else {
    Write-Host "  ERROR: deploy-docs.yml not found" -ForegroundColor Red
    $allPassed = $false
}

# Check VitePress config
Write-Host "[8/8] Checking VitePress config..." -ForegroundColor Yellow
if (Test-Path "docs\.vitepress\config.js") {
    $configContent = Get-Content "docs\.vitepress\config.js" -Raw
    
    # Check base config (simplified)
    if ($configContent -match 'base:') {
        Write-Host "  OK: base configuration found" -ForegroundColor Green
        
        # Extract base value
        if ($configContent -match "base:\s*['\`"]([^'\`"]+)['\`"]") {
            $baseValue = $matches[1]
            Write-Host "  INFO: base = '$baseValue'" -ForegroundColor Cyan
            
            if ($repoName -and ($baseValue -notlike "*$repoName*")) {
                Write-Host "  WARNING: base may not match repository name" -ForegroundColor Yellow
                Write-Host "    Repository: $repoName" -ForegroundColor Gray
                Write-Host "    Base: $baseValue" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "  WARNING: base configuration not found" -ForegroundColor Yellow
    }
    
    # Check title
    if ($configContent -match "title:\s*['\`"]([^'\`"]+)['\`"]") {
        $titleValue = $matches[1]
        Write-Host "  INFO: title = '$titleValue'" -ForegroundColor Cyan
    }
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan

if ($allPassed) {
    Write-Host "SUCCESS: All checks passed!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. Commit and push:" -ForegroundColor White
    Write-Host "   git add ." -ForegroundColor Gray
    Write-Host "   git commit -m `"docs: add documentation`"" -ForegroundColor Gray
    Write-Host "   git push origin main" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. Enable GitHub Pages:" -ForegroundColor White
    Write-Host "   - Go to Settings -> Pages" -ForegroundColor Gray
    Write-Host "   - Source: GitHub Actions" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. Configure Actions permissions:" -ForegroundColor White
    Write-Host "   - Go to Settings -> Actions -> General" -ForegroundColor Gray
    Write-Host "   - Workflow permissions: Read and write" -ForegroundColor Gray
    Write-Host ""
    
    if ($repoName) {
        Write-Host "4. Visit your docs:" -ForegroundColor White
        Write-Host "   https://wssAchilles.github.io/$repoName/" -ForegroundColor Cyan
    }
    Write-Host ""
} else {
    Write-Host "FAILED: Some checks did not pass" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Please fix the errors above and run this script again." -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "For detailed instructions, see: docs/guide/deployment.md" -ForegroundColor Gray
Write-Host ""
