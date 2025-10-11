# 🚀 Android 快速构建脚本
# 用于快速构建和测试 Android 应用

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  ML Platform - Android 构建工具" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# 菜单选项
function Show-Menu {
    Write-Host "请选择构建选项:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  1. 构建 Debug APK (用于测试)" -ForegroundColor Green
    Write-Host "  2. 构建 Release APK (单个文件)" -ForegroundColor Green
    Write-Host "  3. 构建 Release APK (分架构,推荐)" -ForegroundColor Green
    Write-Host "  4. 构建 AAB (Google Play)" -ForegroundColor Green
    Write-Host "  5. 清理构建缓存" -ForegroundColor Yellow
    Write-Host "  6. 查看构建产物" -ForegroundColor Cyan
    Write-Host "  7. 安装到设备/模拟器" -ForegroundColor Cyan
    Write-Host "  0. 退出" -ForegroundColor Red
    Write-Host ""
}

# 检查 Flutter 环境
function Check-Flutter {
    Write-Host "检查 Flutter 环境..." -ForegroundColor Cyan
    try {
        $flutterVersion = flutter --version | Select-Object -First 1
        Write-Host "✓ $flutterVersion" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "✗ Flutter 未安装或未添加到 PATH" -ForegroundColor Red
        return $false
    }
}

# 构建 Debug APK
function Build-DebugAPK {
    Write-Host ""
    Write-Host "开始构建 Debug APK..." -ForegroundColor Yellow
    flutter build apk --debug
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✓ Debug APK 构建成功!" -ForegroundColor Green
        Write-Host "文件位置: build\app\outputs\flutter-apk\app-debug.apk" -ForegroundColor Cyan
        Show-FileSize "build\app\outputs\flutter-apk\app-debug.apk"
    }
    else {
        Write-Host "✗ 构建失败" -ForegroundColor Red
    }
}

# 构建 Release APK (单个)
function Build-ReleaseAPK {
    Write-Host ""
    Write-Host "开始构建 Release APK (单个文件)..." -ForegroundColor Yellow
    flutter build apk --release
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✓ Release APK 构建成功!" -ForegroundColor Green
        Write-Host "文件位置: build\app\outputs\flutter-apk\app-release.apk" -ForegroundColor Cyan
        Show-FileSize "build\app\outputs\flutter-apk\app-release.apk"
    }
    else {
        Write-Host "✗ 构建失败" -ForegroundColor Red
    }
}

# 构建 Release APK (分架构)
function Build-SplitAPK {
    Write-Host ""
    Write-Host "开始构建 Release APK (分架构)..." -ForegroundColor Yellow
    flutter build apk --release --split-per-abi
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✓ Release APK 构建成功!" -ForegroundColor Green
        Write-Host "文件位置: build\app\outputs\flutter-apk\" -ForegroundColor Cyan
        Write-Host ""
        
        $apks = Get-ChildItem "build\app\outputs\flutter-apk\app-*-release.apk"
        foreach ($apk in $apks) {
            $size = [math]::Round($apk.Length / 1MB, 2)
            Write-Host "  ├─ $($apk.Name) ($size MB)" -ForegroundColor Green
        }
    }
    else {
        Write-Host "✗ 构建失败" -ForegroundColor Red
    }
}

# 构建 AAB
function Build-AAB {
    Write-Host ""
    Write-Host "开始构建 App Bundle (AAB)..." -ForegroundColor Yellow
    flutter build appbundle --release
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✓ AAB 构建成功!" -ForegroundColor Green
        Write-Host "文件位置: build\app\outputs\bundle\release\app-release.aab" -ForegroundColor Cyan
        Show-FileSize "build\app\outputs\bundle\release\app-release.aab"
    }
    else {
        Write-Host "✗ 构建失败" -ForegroundColor Red
    }
}

# 清理构建
function Clean-Build {
    Write-Host ""
    Write-Host "清理构建缓存..." -ForegroundColor Yellow
    flutter clean
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ 清理完成" -ForegroundColor Green
    }
    else {
        Write-Host "✗ 清理失败" -ForegroundColor Red
    }
}

# 查看构建产物
function Show-BuildOutputs {
    Write-Host ""
    Write-Host "构建产物列表:" -ForegroundColor Yellow
    Write-Host ""
    
    # APK 文件
    Write-Host "APK 文件:" -ForegroundColor Cyan
    if (Test-Path "build\app\outputs\flutter-apk") {
        $apks = Get-ChildItem "build\app\outputs\flutter-apk\*.apk" -ErrorAction SilentlyContinue
        if ($apks) {
            foreach ($apk in $apks) {
                $size = [math]::Round($apk.Length / 1MB, 2)
                $time = $apk.LastWriteTime.ToString("yyyy-MM-dd HH:mm")
                Write-Host "  ├─ $($apk.Name)" -ForegroundColor Green
                Write-Host "     大小: $size MB  |  时间: $time" -ForegroundColor Gray
            }
        }
        else {
            Write-Host "  └─ 无 APK 文件" -ForegroundColor Gray
        }
    }
    else {
        Write-Host "  └─ 无构建目录" -ForegroundColor Gray
    }
    
    Write-Host ""
    
    # AAB 文件
    Write-Host "AAB 文件:" -ForegroundColor Cyan
    if (Test-Path "build\app\outputs\bundle\release\app-release.aab") {
        $aab = Get-Item "build\app\outputs\bundle\release\app-release.aab"
        $size = [math]::Round($aab.Length / 1MB, 2)
        $time = $aab.LastWriteTime.ToString("yyyy-MM-dd HH:mm")
        Write-Host "  ├─ $($aab.Name)" -ForegroundColor Green
        Write-Host "     大小: $size MB  |  时间: $time" -ForegroundColor Gray
    }
    else {
        Write-Host "  └─ 无 AAB 文件" -ForegroundColor Gray
    }
}

# 安装到设备
function Install-ToDevice {
    Write-Host ""
    Write-Host "检查连接的设备..." -ForegroundColor Yellow
    
    $devices = adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\t' }
    
    if (-not $devices) {
        Write-Host "✗ 未检测到连接的设备或模拟器" -ForegroundColor Red
        Write-Host "请确保:" -ForegroundColor Yellow
        Write-Host "  1. 设备已连接并启用 USB 调试" -ForegroundColor Gray
        Write-Host "  2. 或启动了 Android 模拟器" -ForegroundColor Gray
        return
    }
    
    Write-Host "✓ 检测到设备" -ForegroundColor Green
    Write-Host ""
    
    # 查找最新的 APK
    $apks = Get-ChildItem "build\app\outputs\flutter-apk\*.apk" -ErrorAction SilentlyContinue | 
            Where-Object { $_.Name -notlike "*-debug*" } |
            Sort-Object LastWriteTime -Descending
    
    if (-not $apks) {
        Write-Host "✗ 未找到 APK 文件,请先构建应用" -ForegroundColor Red
        return
    }
    
    $apk = $apks[0]
    Write-Host "安装: $($apk.Name)" -ForegroundColor Cyan
    
    adb install -r $apk.FullName
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✓ 安装成功!" -ForegroundColor Green
    }
    else {
        Write-Host "✗ 安装失败" -ForegroundColor Red
    }
}

# 显示文件大小
function Show-FileSize($path) {
    if (Test-Path $path) {
        $file = Get-Item $path
        $sizeMB = [math]::Round($file.Length / 1MB, 2)
        Write-Host "文件大小: $sizeMB MB" -ForegroundColor Gray
    }
}

# 主程序
if (-not (Check-Flutter)) {
    Write-Host ""
    Write-Host "请先安装 Flutter 或将其添加到系统 PATH" -ForegroundColor Red
    Write-Host "官方文档: https://flutter.dev/docs/get-started/install" -ForegroundColor Cyan
    exit 1
}

Write-Host ""

do {
    Show-Menu
    $choice = Read-Host "请输入选项"
    
    switch ($choice) {
        "1" { Build-DebugAPK }
        "2" { Build-ReleaseAPK }
        "3" { Build-SplitAPK }
        "4" { Build-AAB }
        "5" { Clean-Build }
        "6" { Show-BuildOutputs }
        "7" { Install-ToDevice }
        "0" { 
            Write-Host ""
            Write-Host "再见! 👋" -ForegroundColor Cyan
            exit 0
        }
        default { 
            Write-Host ""
            Write-Host "无效的选项,请重新选择" -ForegroundColor Red
        }
    }
    
    Write-Host ""
    Write-Host "按任意键继续..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    Clear-Host
    
    Write-Host "=====================================" -ForegroundColor Cyan
    Write-Host "  ML Platform - Android 构建工具" -ForegroundColor Cyan
    Write-Host "=====================================" -ForegroundColor Cyan
    Write-Host ""
    
} while ($true)
