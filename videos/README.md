# 哔哩哔哩视频下载器

这是一个功能完整的哔哩哔哩视频下载工具，支持多种下载模式和格式。

## 功能特性

- ✅ 下载单个视频
- ✅ 下载播放列表/合集
- ✅ 下载UP主所有视频
- ✅ 仅下载音频
- ✅ 批量下载
- ✅ 自动嵌入字幕和缩略图
- ✅ 支持多种视频质量选择
- ✅ 彩色终端输出
- ✅ 错误处理和重试机制

## 安装依赖

首先激活您的conda环境：
```bash
conda activate D:\CondaEnvs\videos
```

然后安装所需的Python包：
```bash
pip install -r requirements.txt
```

## 使用方法

### 1. 命令行工具 (bilibili_downloader.py)

#### 基本用法
```bash
# 下载单个视频
python bilibili_downloader.py BV1xx411c7mD

# 使用完整URL
python bilibili_downloader.py https://www.bilibili.com/video/BV1xx411c7mD

# 指定输出目录和质量
python bilibili_downloader.py BV1xx411c7mD -o my_videos -q best[height<=720]
```

#### 高级功能
```bash
# 仅下载音频
python bilibili_downloader.py BV1xx411c7mD --audio-only

# 下载播放列表
python bilibili_downloader.py https://www.bilibili.com/playlist/pl123456 --playlist

# 下载UP主所有视频（限制前10个）
python bilibili_downloader.py https://space.bilibili.com/123456 --user --limit 10

# 查看视频信息
python bilibili_downloader.py BV1xx411c7mD --info

# 查看可用格式
python bilibili_downloader.py BV1xx411c7mD --formats
```

### 2. 简单下载脚本 (simple_downloader.py)

适合快速下载单个视频：
```bash
python simple_downloader.py
```
运行后会提示输入视频URL。

### 3. 批量下载 (batch_downloader.py)

#### 创建URL列表模板
```bash
python batch_downloader.py --template
```

#### 批量下载
```bash
python batch_downloader.py urls.txt
```

## 配置说明

### 视频质量选项
- `best`: 最佳质量
- `worst`: 最差质量
- `best[height<=1080]`: 最高1080p
- `best[height<=720]`: 最高720p
- `bestvideo+bestaudio`: 最佳视频+最佳音频

### 输出目录结构
```
downloads/
├── UP主名称/
│   ├── 视频标题1.mp4
│   ├── 视频标题2.mp4
│   └── Audio/
│       └── 音频文件.mp3
└── 其他UP主/
    └── 视频文件...
```

## 支持的URL格式

- 完整视频URL: `https://www.bilibili.com/video/BV1xx411c7mD`
- BV号: `BV1xx411c7mD`
- av号: `av12345678` 或直接数字 `12345678`
- 播放列表: `https://www.bilibili.com/playlist/pl123456`
- UP主主页: `https://space.bilibili.com/123456`

## 注意事项

1. **FFmpeg要求**: 确保FFmpeg已正确安装并添加到系统PATH
2. **网络环境**: 建议在良好的网络环境下使用
3. **版权声明**: 下载的视频仅供个人学习使用，请遵守相关法律法规
4. **频率限制**: 批量下载时会自动添加延迟以避免被限制

## 故障排除

### 常见问题

1. **FFmpeg未找到**
   ```
   错误: ffmpeg not found
   ```
   解决方案: 确保FFmpeg已安装并添加到PATH

2. **视频无法下载**
   ```
   错误: 该视频已被删除或设为私密
   ```
   解决方案: 检查视频是否存在或可访问

3. **网络错误**
   ```
   错误: Unable to download webpage
   ```
   解决方案: 检查网络连接或稍后重试

### 更新yt-dlp
如果遇到下载问题，尝试更新yt-dlp：
```bash
pip install --upgrade yt-dlp
```

## 示例

### 下载单个视频示例
```bash
python bilibili_downloader.py BV1BV411x7XX -o downloads -q "best[height<=1080]"
```

### 批量下载示例
1. 创建 `my_videos.txt` 文件：
```
BV1xx411c7mD
BV1yy411c7mE
https://www.bilibili.com/video/BV1zz411c7mF
```

2. 执行批量下载：
```bash
python batch_downloader.py my_videos.txt
```
