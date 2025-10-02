# Tencent Cloud COS Deployment Script (Using COSCLI)
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

# Step 1: Download and install COSCLI
Write-Host "Step 1: Installing COSCLI..." -ForegroundColor Yellow

$COSCLI_URL = "https://github.com/tencentyun/coscli/releases/download/v0.21.0-beta/coscli-windows-amd64.exe"
$COSCLI_PATH = "coscli.exe"

if (-not (Test-Path $COSCLI_PATH)) {
    Write-Host "Downloading COSCLI..." -ForegroundColor White
    try {
        Invoke-WebRequest -Uri $COSCLI_URL -OutFile $COSCLI_PATH
        Write-Host "COSCLI downloaded successfully" -ForegroundColor Green
    } catch {
        Write-Host "Failed to download COSCLI. Please check internet connection." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "COSCLI already exists" -ForegroundColor Green
}

# Step 2: Configure COSCLI
Write-Host ""
Write-Host "Step 2: Configuring COSCLI..." -ForegroundColor Yellow

try {
    & .\coscli config set --secret_id $SECRET_ID --secret_key $SECRET_KEY --region $REGION
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "COSCLI configured successfully" -ForegroundColor Green
    } else {
        throw "COSCLI configuration failed"
    }
} catch {
    Write-Host "COSCLI configuration failed" -ForegroundColor Red
    exit 1
}

# Step 3: Upload play.html
Write-Host ""
Write-Host "Step 3: Uploading play.html..." -ForegroundColor Yellow

if (-not (Test-Path "play.html")) {
    Write-Host "Error: play.html file not found in current directory" -ForegroundColor Red
    exit 1
}

try {
    & .\coscli cp play.html "cos://$BUCKET_NAME/play.html" --include "*.html"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "play.html uploaded successfully" -ForegroundColor Green
    } else {
        throw "play.html upload failed"
    }
} catch {
    Write-Host "play.html upload failed" -ForegroundColor Red
    exit 1
}

# Step 4: Set bucket to public read
Write-Host ""
Write-Host "Step 4: Setting bucket permissions..." -ForegroundColor Yellow

try {
    & .\coscli bucket-policy set "cos://$BUCKET_NAME" --acl public-read
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Bucket permissions set to public-read" -ForegroundColor Green
    } else {
        Write-Host "Bucket permissions may have failed, continuing..." -ForegroundColor Yellow
    }
} catch {
    Write-Host "Bucket permissions encountered issues, continuing..." -ForegroundColor Yellow
}

# Step 5: Set up static website hosting
Write-Host ""
Write-Host "Step 5: Setting up static website hosting..." -ForegroundColor Yellow

Write-Host "Creating static website configuration..." -ForegroundColor White
$websiteConfig = @{
    "IndexDocument" = @{
        "Suffix" = "play.html"
    }
    "ErrorDocument" = @{
        "Key" = "play.html"
    }
}

$websiteConfigJson = $websiteConfig | ConvertTo-Json -Depth 3
$configFile = "website-config.json"
$websiteConfigJson | Out-File -FilePath $configFile -Encoding UTF8

Write-Host "Static website configuration created" -ForegroundColor Green

# Manual instructions for static website setup
Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "Deployment Status: Files Uploaded!" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Cyan

Write-Host ""
Write-Host "Your COS bucket URL:" -ForegroundColor Yellow
Write-Host "  https://$BUCKET_NAME.cos.$REGION.myqcloud.com/play.html" -ForegroundColor Cyan
Write-Host ""
Write-Host "Static website URL (after manual setup):" -ForegroundColor Yellow
Write-Host "  https://$BUCKET_NAME.cos-website.$REGION.myqcloud.com" -ForegroundColor Cyan
Write-Host ""

Write-Host "IMPORTANT: To complete the setup, please:" -ForegroundColor Red
Write-Host "1. Go to Tencent Cloud Console: https://console.cloud.tencent.com/cos5" -ForegroundColor White
Write-Host "2. Find your bucket: $BUCKET_NAME" -ForegroundColor White
Write-Host "3. Go to 'Basic Configuration' > 'Static Website'" -ForegroundColor White
Write-Host "4. Enable static website hosting:" -ForegroundColor White
Write-Host "   - Index Document: play.html" -ForegroundColor White
Write-Host "   - Error Document: play.html" -ForegroundColor White
Write-Host "5. Save the configuration" -ForegroundColor White
Write-Host ""

Write-Host "Test URLs:" -ForegroundColor Yellow
Write-Host "Direct file access:" -ForegroundColor White
Write-Host "  https://$BUCKET_NAME.cos.$REGION.myqcloud.com/play.html?filename=test.mp3&url=https://example.com/audio.mp3" -ForegroundColor Cyan
Write-Host ""
Write-Host "Static website access (after manual setup):" -ForegroundColor White
Write-Host "  https://$BUCKET_NAME.cos-website.$REGION.myqcloud.com?filename=test.mp3&url=https://example.com/audio.mp3" -ForegroundColor Cyan

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "Deployment automation completed!" -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Complete manual static website setup in console" -ForegroundColor White
Write-Host "  2. Test the URLs above" -ForegroundColor White
Write-Host "  3. Update Flutter app configuration" -ForegroundColor White
Write-Host "  4. Recompile APK and test WeChat QR scanning" -ForegroundColor White
Write-Host "===========================================" -ForegroundColor Cyan

# Clean up
Remove-Item $configFile -ErrorAction SilentlyContinue