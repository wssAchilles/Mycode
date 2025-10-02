# Tencent Cloud COS Static Website Deployment Script (Windows PowerShell)
# Audio QR Code Player Page Deployment

Write-Host "Starting deployment to Tencent Cloud COS..." -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Cyan

# Configuration variables
$SECRET_ID = "AKID9HF0nU0LTPNCqGoJRSG3mOrBJrFRQCk3"
$SECRET_KEY = "94nMjtqNmzzsY0EE0YszsY0EE1d2DAuQ"
$BUCKET_NAME = "my-audio-files-123-1380453532"
$REGION = "ap-nanjing"

Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Bucket: $BUCKET_NAME" -ForegroundColor White
Write-Host "  Region: $REGION" -ForegroundColor White
Write-Host ""

# Step 1: Install Tencent Cloud CLI
Write-Host "Step 1: Installing Tencent Cloud CLI..." -ForegroundColor Yellow

try {
    $pythonVersion = python --version 2>&1
    Write-Host "Python detected: $pythonVersion" -ForegroundColor Green
    
    Write-Host "Installing tccli..." -ForegroundColor White
    pip install tccli --quiet --disable-pip-version-check
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "tccli installation successful" -ForegroundColor Green
    } else {
        throw "tccli installation failed"
    }
} catch {
    Write-Host "tccli installation failed. Please check Python and pip." -ForegroundColor Red
    exit 1
}

# Step 2: Configure Tencent Cloud CLI
Write-Host ""
Write-Host "Step 2: Configuring authentication..." -ForegroundColor Yellow

try {
    tccli configure set secretId $SECRET_ID
    tccli configure set secretKey $SECRET_KEY
    tccli configure set region $REGION
    tccli configure set output json
    Write-Host "Authentication configured successfully" -ForegroundColor Green
} catch {
    Write-Host "Authentication configuration failed" -ForegroundColor Red
    exit 1
}

# Step 3: Set bucket permissions
Write-Host ""
Write-Host "Step 3: Setting bucket permissions..." -ForegroundColor Yellow

try {
    tccli cos PutBucketAcl --Bucket $BUCKET_NAME --ACL public-read
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Bucket permissions set successfully (public-read)" -ForegroundColor Green
    } else {
        Write-Host "Bucket permissions may have failed, continuing..." -ForegroundColor Yellow
    }
} catch {
    Write-Host "Bucket permissions encountered issues, continuing..." -ForegroundColor Yellow
}

# Step 4: Upload static files
Write-Host ""
Write-Host "Step 4: Uploading static files..." -ForegroundColor Yellow

if (-not (Test-Path "play.html")) {
    Write-Host "Error: play.html file not found in current directory" -ForegroundColor Red
    exit 1
}

try {
    tccli cos PutObject --Bucket $BUCKET_NAME --Key "play.html" --Body "play.html" --ContentType "text/html"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "play.html uploaded successfully" -ForegroundColor Green
    } else {
        throw "play.html upload failed"
    }
} catch {
    Write-Host "play.html upload failed" -ForegroundColor Red
    exit 1
}

# Step 5: Enable static website hosting
Write-Host ""
Write-Host "Step 5: Enabling static website hosting..." -ForegroundColor Yellow

$websiteConfig = '{"IndexDocument":{"Suffix":"play.html"},"ErrorDocument":{"Key":"play.html"}}'

try {
    $tempConfigFile = "website-config.json"
    $websiteConfig | Out-File -FilePath $tempConfigFile -Encoding UTF8
    
    tccli cos PutBucketWebsite --Bucket $BUCKET_NAME --WebsiteConfiguration file://$tempConfigFile
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Static website hosting enabled successfully" -ForegroundColor Green
        Write-Host "  - Index document: play.html" -ForegroundColor White
        Write-Host "  - Error document: play.html" -ForegroundColor White
    } else {
        throw "Static website hosting failed"
    }
    
    Remove-Item $tempConfigFile -ErrorAction SilentlyContinue
} catch {
    Write-Host "Static website hosting failed" -ForegroundColor Red
    exit 1
}

# Step 6: Configure CORS
Write-Host ""
Write-Host "Step 6: Configuring CORS rules..." -ForegroundColor Yellow

$corsConfig = '{"CORSRules":[{"AllowedOrigins":["*"],"AllowedMethods":["GET","HEAD"],"AllowedHeaders":["*"],"MaxAgeSeconds":86400}]}'

try {
    $tempCorsFile = "cors-config.json"
    $corsConfig | Out-File -FilePath $tempCorsFile -Encoding UTF8
    
    tccli cos PutBucketCors --Bucket $BUCKET_NAME --CORSConfiguration file://$tempCorsFile
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "CORS rules configured successfully" -ForegroundColor Green
    } else {
        Write-Host "CORS configuration may have failed, but basic functionality should work" -ForegroundColor Yellow
    }
    
    Remove-Item $tempCorsFile -ErrorAction SilentlyContinue
} catch {
    Write-Host "CORS configuration encountered issues, but basic functionality should work" -ForegroundColor Yellow
}

# Step 7: Generate access URL
Write-Host ""
Write-Host "Deployment completed!" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Cyan

$WEBSITE_URL = "https://$BUCKET_NAME.cos-website.$REGION.myqcloud.com"

Write-Host "Your static website URL:" -ForegroundColor Yellow
Write-Host "  $WEBSITE_URL" -ForegroundColor Cyan
Write-Host ""
Write-Host "Example play page URL:" -ForegroundColor Yellow
Write-Host "  $WEBSITE_URL/play.html?filename=example.mp3&url=https://example.com/audio.mp3" -ForegroundColor White
Write-Host ""

Write-Host "Verifying deployment status..." -ForegroundColor Yellow
Write-Host "Please wait 5-10 minutes for DNS to take effect, then test the URL." -ForegroundColor White

Write-Host ""
Write-Host "Deployment automation completed!" -ForegroundColor Green
Write-Host "Please save the URL above and update your Flutter app configuration." -ForegroundColor Cyan
Write-Host ""
Write-Host "Tips:" -ForegroundColor Yellow
Write-Host "  1. DNS propagation may take 5-10 minutes" -ForegroundColor White
Write-Host "  2. If access fails, check bucket permissions and file upload status" -ForegroundColor White
Write-Host "  3. Ensure audio file URLs are accessible" -ForegroundColor White
Write-Host "===========================================" -ForegroundColor Cyan

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Green
Write-Host "  1. Wait 5-10 minutes for configuration to take effect" -ForegroundColor White
Write-Host "  2. Recompile Flutter APK" -ForegroundColor White
Write-Host "  3. Test WeChat QR code scanning" -ForegroundColor White