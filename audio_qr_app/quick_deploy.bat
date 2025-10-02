@echo off
chcp 65001 >nul
echo 🚀 开始部署音频播放器到腾讯云COS...

set BUCKET_NAME=my-audio-files-123-1380453532
set REGION=ap-nanjing
set COS_ENDPOINT=https://%BUCKET_NAME%.cos.%REGION%.myqcloud.com

echo 📁 检查 play.html 文件...
if not exist "play.html" (
    echo ❌ 错误：找不到 play.html 文件
    echo 请确保在项目根目录执行此脚本
    pause
    exit /b 1
)

echo 📤 上传 play.html 到 %COS_ENDPOINT%/play.html

curl -X PUT ^
     -H "Content-Type: text/html; charset=utf-8" ^
     -H "Cache-Control: public, max-age=3600" ^
     --data-binary "@play.html" ^
     "%COS_ENDPOINT%/play.html"

if %ERRORLEVEL% EQU 0 (
    echo ✅ 上传成功！
    echo 🌐 静态网站地址：https://%BUCKET_NAME%.cos-website.%REGION%.myqcloud.com
    echo 🎵 播放器地址：https://%BUCKET_NAME%.cos-website.%REGION%.myqcloud.com/play.html
    echo.
    echo 📋 下一步操作：
    echo 1. 在腾讯云控制台确认已开启静态网站功能
    echo 2. 重新编译Flutter应用：flutter build apk --release
    echo 3. 使用新APK测试二维码功能
) else (
    echo ❌ 上传失败
    echo 💡 可能的解决方案：
    echo 1. 检查网络连接
    echo 2. 在腾讯云控制台设置存储桶为公共读写权限
    echo 3. 或手动在COS控制台上传play.html文件
)

echo.
echo ✨ 脚本执行完成
pause
