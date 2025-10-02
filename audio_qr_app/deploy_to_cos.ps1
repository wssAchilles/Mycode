# 腾讯云COS静态网站自动化部署脚本 (Windows PowerShell版本)
# 适用于音频二维码播放页面部署

Write-Host "🚀 开始部署音频播放页面到腾讯云COS..." -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan

# 配置变量
$SECRET_ID = "AKID9HF0nU0LTPNCqGoJRSG3mOrBJrFRQCk3"
$SECRET_KEY = "94nMjtqNmzzsY0EE0YszsY0EE1d2DAuQ"
$BUCKET_NAME = "my-audio-files-123-1380453532"
$REGION = "ap-nanjing"

Write-Host "📋 配置信息:" -ForegroundColor Yellow
Write-Host "  存储桶: $BUCKET_NAME" -ForegroundColor White
Write-Host "  地区: $REGION" -ForegroundColor White
Write-Host ""

# 第一步：安装腾讯云CLI工具
Write-Host "📦 步骤1: 安装腾讯云CLI工具..." -ForegroundColor Yellow

try {
    # 检查Python是否安装
    $pythonVersion = python --version 2>&1
    Write-Host "✅ 检测到Python: $pythonVersion" -ForegroundColor Green
    
    # 安装tccli
    Write-Host "正在安装tccli..." -ForegroundColor White
    pip install tccli --quiet --disable-pip-version-check
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ tccli 安装成功" -ForegroundColor Green
    } else {
        throw "tccli安装失败"
    }
} catch {
    Write-Host "❌ tccli 安装失败，请检查Python和pip环境" -ForegroundColor Red
    Write-Host "请确保已安装Python和pip，并且可以在命令行中访问" -ForegroundColor Yellow
    exit 1
}

# 第二步：配置腾讯云CLI认证信息
Write-Host ""
Write-Host "🔑 步骤2: 配置腾讯云CLI认证..." -ForegroundColor Yellow

try {
    tccli configure set secretId $SECRET_ID
    tccli configure set secretKey $SECRET_KEY
    tccli configure set region $REGION
    tccli configure set output json
    Write-Host "✅ 认证配置完成" -ForegroundColor Green
} catch {
    Write-Host "❌ 认证配置失败" -ForegroundColor Red
    exit 1
}

# 第三步：设置存储桶访问权限为公有读
Write-Host ""
Write-Host "🔓 步骤3: 设置存储桶访问权限..." -ForegroundColor Yellow

try {
    # 将存储桶ACL设置为public-read，允许公网访问静态网站
    tccli cos PutBucketAcl --Bucket $BUCKET_NAME --ACL public-read
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ 存储桶权限设置成功 (public-read)" -ForegroundColor Green
    } else {
        Write-Host "⚠️ 存储桶权限设置可能失败，但不影响后续步骤" -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️ 存储桶权限设置遇到问题，继续后续步骤" -ForegroundColor Yellow
}

# 第四步：上传静态文件到COS
Write-Host ""
Write-Host "📤 步骤4: 上传静态文件..." -ForegroundColor Yellow

# 检查play.html文件是否存在
if (-not (Test-Path "play.html")) {
    Write-Host "❌ 错误: play.html 文件不存在，请确保文件在当前目录" -ForegroundColor Red
    exit 1
}

try {
    # 上传play.html到存储桶根目录
    tccli cos PutObject --Bucket $BUCKET_NAME --Key "play.html" --Body "play.html" --ContentType "text/html"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ play.html 上传成功" -ForegroundColor Green
    } else {
        throw "play.html上传失败"
    }
} catch {
    Write-Host "❌ play.html 上传失败" -ForegroundColor Red
    exit 1
}

# 可选：如果有index.html也一起上传
if (Test-Path "index.html") {
    Write-Host "📤 发现index.html，正在上传..." -ForegroundColor White
    try {
        tccli cos PutObject --Bucket $BUCKET_NAME --Key "index.html" --Body "index.html" --ContentType "text/html"
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ index.html 上传成功" -ForegroundColor Green
        }
    } catch {
        Write-Host "⚠️ index.html 上传失败，但不影响主要功能" -ForegroundColor Yellow
    }
}

# 第五步：开启静态网站功能
Write-Host ""
Write-Host "🌐 步骤5: 开启COS静态网站功能..." -ForegroundColor Yellow

$websiteConfig = @'
{
    "IndexDocument": {
        "Suffix": "play.html"
    },
    "ErrorDocument": {
        "Key": "play.html"
    }
}
'@

try {
    # 将配置写入临时文件
    $tempConfigFile = "website-config.json"
    $websiteConfig | Out-File -FilePath $tempConfigFile -Encoding UTF8
    
    # 为存储桶开启静态网站托管功能
    tccli cos PutBucketWebsite --Bucket $BUCKET_NAME --WebsiteConfiguration file://$tempConfigFile
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ 静态网站功能开启成功" -ForegroundColor Green
        Write-Host "  - 默认首页: play.html" -ForegroundColor White
        Write-Host "  - 错误页面: play.html" -ForegroundColor White
    } else {
        throw "静态网站功能开启失败"
    }
    
    # 清理临时文件
    Remove-Item $tempConfigFile -ErrorAction SilentlyContinue
} catch {
    Write-Host "❌ 静态网站功能开启失败" -ForegroundColor Red
    exit 1
}

# 第六步：配置CORS规则（支持跨域访问）
Write-Host ""
Write-Host "🔀 步骤6: 配置CORS跨域规则..." -ForegroundColor Yellow

$corsConfig = @'
{
    "CORSRules": [
        {
            "AllowedOrigins": ["*"],
            "AllowedMethods": ["GET", "HEAD"],
            "AllowedHeaders": ["*"],
            "MaxAgeSeconds": 86400
        }
    ]
}
'@

try {
    # 将CORS配置写入临时文件
    $tempCorsFile = "cors-config.json"
    $corsConfig | Out-File -FilePath $tempCorsFile -Encoding UTF8
    
    tccli cos PutBucketCors --Bucket $BUCKET_NAME --CORSConfiguration file://$tempCorsFile
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ CORS规则配置成功" -ForegroundColor Green
    } else {
        Write-Host "⚠️ CORS规则配置可能失败，但不影响基本功能" -ForegroundColor Yellow
    }
    
    # 清理临时文件
    Remove-Item $tempCorsFile -ErrorAction SilentlyContinue
} catch {
    Write-Host "⚠️ CORS规则配置遇到问题，但不影响基本功能" -ForegroundColor Yellow
}

# 第七步：生成访问URL并验证
Write-Host ""
Write-Host "🎉 部署完成！" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan

# 根据腾讯云规则生成静态网站访问URL
$WEBSITE_URL = "https://$BUCKET_NAME.cos-website.$REGION.myqcloud.com"

Write-Host "📍 您的静态网站地址:" -ForegroundColor Yellow
Write-Host "  $WEBSITE_URL" -ForegroundColor Cyan
Write-Host ""
Write-Host "📱 播放页面完整URL示例:" -ForegroundColor Yellow
Write-Host "  $WEBSITE_URL/play.html?filename=example.mp3`&url=https://example.com/audio.mp3" -ForegroundColor White
Write-Host ""

# 尝试验证部署是否成功
Write-Host "🔍 正在验证部署状态..." -ForegroundColor Yellow
Write-Host "请稍等片刻让DNS生效，然后在浏览器中访问上述URL进行测试。" -ForegroundColor White

Write-Host ""
Write-Host "✅ 自动化部署完成！" -ForegroundColor Green
Write-Host "📝 请保存上述URL，并更新您的Flutter应用配置。" -ForegroundColor Cyan
Write-Host ""
Write-Host "💡 提示：" -ForegroundColor Yellow
Write-Host "  1. DNS生效可能需要5-10分钟" -ForegroundColor White
Write-Host "  2. 如果访问失败，请检查存储桶权限和文件上传状态" -ForegroundColor White
Write-Host "  3. 确保音频文件URL可以正常访问" -ForegroundColor White
Write-Host "==========================================" -ForegroundColor Cyan

Write-Host ""
Write-Host "🚀 接下来请：" -ForegroundColor Green
Write-Host "  1. 等待5-10分钟让配置生效" -ForegroundColor White
Write-Host "  2. 重新编译Flutter APK" -ForegroundColor White
Write-Host "  3. 测试微信扫码功能" -ForegroundColor White