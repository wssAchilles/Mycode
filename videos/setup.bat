@echo off
echo ========================================
echo 哔哩哔哩视频下载器 - 环境配置脚本
echo ========================================

echo 正在激活conda环境...
call conda activate D:\CondaEnvs\videos

echo.
echo 正在安装Python依赖包...
pip install yt-dlp requests beautifulsoup4 colorama

echo.
echo 正在检查FFmpeg...
ffmpeg -version >nul 2>&1
if %errorlevel% == 0 (
    echo [✓] FFmpeg 已正确安装
) else (
    echo [!] FFmpeg 未找到，请确保已安装并添加到PATH
    echo     下载地址: https://ffmpeg.org/download.html
)

echo.
echo 正在测试yt-dlp...
python -c "import yt_dlp; print('yt-dlp 版本:', yt_dlp.version.__version__)"

echo.
echo ========================================
echo 安装完成！
echo ========================================
echo.
echo 使用示例:
echo   python bilibili_downloader.py BV1xx411c7mD
echo   python simple_downloader.py
echo   python batch_downloader.py urls.txt
echo.
pause
