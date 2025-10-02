# 哔哩哔哩视频下载器 - 快速使用指南

## 🚀 快速开始

### 1. 环境准备
```bash
# 激活您的conda环境
conda activate D:\CondaEnvs\videos

# 进入项目目录
cd "d:\Code\videos"

# 验证环境
python demo.py
```

### 2. 基本使用

#### 下载单个视频
```bash
# 使用BV号
python bilibili_downloader.py BV1xx411c7mD

# 使用完整URL
python bilibili_downloader.py "https://www.bilibili.com/video/BV1xx411c7mD"

# 使用av号
python bilibili_downloader.py av12345678
```

#### 简单交互式下载
```bash
python simple_downloader.py
# 然后输入视频URL或BV号
```

### 3. 高级功能

#### 自定义下载目录和质量
```bash
python bilibili_downloader.py BV1xx411c7mD -o "我的视频" -q "best[height<=720]"
```

#### 仅下载音频
```bash
python bilibili_downloader.py BV1xx411c7mD --audio-only
```

#### 查看视频信息（不下载）
```bash
python bilibili_downloader.py BV1xx411c7mD --info
```

#### 使用质量预设
```bash
# 使用高级下载器的预设质量
python advanced_downloader.py BV1xx411c7mD -p hd     # 720p
python advanced_downloader.py BV1xx411c7mD -p full_hd # 1080p
python advanced_downloader.py BV1xx411c7mD -p audio_only # 仅音频
```

### 4. 批量下载

#### 创建URL列表
```bash
python batch_downloader.py --template
```

#### 编辑urls.txt文件，添加要下载的视频：
```
# 哔哩哔哩视频URL列表
BV1xx411c7mD
BV1yy411c7mE
https://www.bilibili.com/video/BV1zz411c7mF
```

#### 执行批量下载
```bash
python batch_downloader.py urls.txt
```

### 5. 播放列表和UP主视频

#### 下载播放列表/合集
```bash
python bilibili_downloader.py "https://www.bilibili.com/playlist/pl123456" --playlist
```

#### 下载UP主所有视频（限制数量）
```bash
python bilibili_downloader.py "https://space.bilibili.com/123456" --user --limit 10
```

## 📁 输出文件结构

下载的文件会按以下结构组织：
```
downloads/
├── UP主名称/
│   ├── 视频标题.mp4
│   ├── 视频标题.zh-CN.srt        # 中文字幕
│   ├── 视频标题.info.json        # 视频信息
│   └── 视频标题.webp             # 缩略图
└── Audio/
    └── 音频文件.mp3
```

## ⚙️ 配置文件

编辑 `config.ini` 来自定义默认设置：

```ini
[DEFAULT]
# 输出目录
output_directory = downloads

# 视频质量
video_quality = best[height<=1080]

# 是否下载字幕
download_subtitles = true

# 字幕语言
subtitle_languages = zh-CN,en
```

## 🎯 常用质量设置

| 设置 | 说明 |
|------|------|
| `best` | 最佳质量 |
| `best[height<=1080]` | 最高1080p |
| `best[height<=720]` | 最高720p |
| `best[height<=480]` | 最高480p |
| `bestaudio` | 最佳音频质量 |
| `worst` | 最低质量（节省空间） |

## 🔧 故障排除

### 常见问题

1. **模块未找到错误**
   ```
   ModuleNotFoundError: No module named 'yt_dlp'
   ```
   **解决方案**：确保激活了正确的conda环境
   ```bash
   conda activate D:\CondaEnvs\videos
   ```

2. **FFmpeg错误**
   ```
   ERROR: ffmpeg not found
   ```
   **解决方案**：确保FFmpeg已安装并添加到PATH

3. **网络错误**
   **解决方案**：检查网络连接，稍后重试

4. **视频无法访问**
   **解决方案**：检查视频是否存在、是否为私密视频

### 更新依赖
```bash
pip install --upgrade yt-dlp
```

## 📋 项目文件说明

| 文件 | 功能 |
|------|------|
| `bilibili_downloader.py` | 主要下载器，功能完整 |
| `simple_downloader.py` | 简单交互式下载器 |
| `advanced_downloader.py` | 支持配置文件的高级下载器 |
| `batch_downloader.py` | 批量下载工具 |
| `demo.py` | 演示和测试脚本 |
| `config.ini` | 配置文件 |
| `requirements.txt` | Python依赖列表 |

## ⚖️ 法律声明

- 下载的视频仅供个人学习研究使用
- 请遵守相关法律法规和版权规定
- 不得用于商业用途
- 尊重创作者的知识产权

## 💡 使用技巧

1. **提高下载速度**：选择合适的视频质量，不必总是选择最高质量
2. **节省存储空间**：使用音频模式下载音乐视频
3. **批量下载**：整理好URL列表，使用批量下载功能
4. **网络优化**：在网络较好的时段进行下载
5. **文件管理**：定期清理不需要的视频文件

## 🆘 获取帮助

查看命令行帮助：
```bash
python bilibili_downloader.py --help
python advanced_downloader.py --help
python batch_downloader.py --help
```

Happy downloading! 🎉
