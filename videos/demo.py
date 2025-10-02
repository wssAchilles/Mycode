#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
哔哩哔哩视频下载器演示脚本
展示各种下载功能的使用方法
"""

from bilibili_downloader import BilibiliDownloader
from advanced_downloader import AdvancedBilibiliDownloader
import sys

def demo_basic_download():
    """演示基本视频下载"""
    print("=" * 60)
    print("基本视频下载演示")
    print("=" * 60)
    
    # 创建下载器
    downloader = BilibiliDownloader("demo_downloads")
    
    # 示例视频URL (这是一个公开的测试视频)
    test_url = "BV1xx411c7mD"  # 替换为真实的BV号
    
    print(f"下载URL: {test_url}")
    print("注意：这只是演示，请替换为真实的视频URL")
    
    # 获取视频信息
    info = downloader.get_video_info(f"https://www.bilibili.com/video/{test_url}")
    if info:
        print(f"视频标题: {info.get('title', 'N/A')}")
        print(f"UP主: {info.get('uploader', 'N/A')}")
        print(f"时长: {info.get('duration', 'N/A')} 秒")
    
    # 不实际下载，只是演示
    print("如果要实际下载，请取消注释下面的代码：")
    print("# downloader.download_video(test_url)")

def demo_advanced_download():
    """演示高级下载功能"""
    print("\n" + "=" * 60)
    print("高级下载功能演示")
    print("=" * 60)
    
    # 创建高级下载器
    downloader = AdvancedBilibiliDownloader()
    
    # 显示配置
    downloader.show_config()
    
    print("\n可用的质量预设:")
    if 'QUALITY_PRESETS' in downloader.config:
        for name, quality in downloader.config['QUALITY_PRESETS'].items():
            print(f"  {name}: {quality}")

def demo_batch_download():
    """演示批量下载"""
    print("\n" + "=" * 60)
    print("批量下载演示")
    print("=" * 60)
    
    # 创建示例URL列表文件
    sample_urls = """# 哔哩哔哩视频URL列表示例
# 每行一个URL，以#开头的行为注释

# 示例URLs (请替换为真实的URL):
# BV1xx411c7mD
# BV1yy411c7mE
# https://www.bilibili.com/video/BV1zz411c7mF

# 播放列表示例:
# https://www.bilibili.com/playlist/pl123456

# UP主主页示例:
# https://space.bilibili.com/123456
"""
    
    with open("demo_urls.txt", "w", encoding="utf-8") as f:
        f.write(sample_urls)
    
    print("已创建示例URL列表文件: demo_urls.txt")
    print("编辑此文件，添加真实的视频URL，然后运行:")
    print("python batch_downloader.py demo_urls.txt")

def show_usage_examples():
    """显示使用示例"""
    print("\n" + "=" * 60)
    print("使用示例")
    print("=" * 60)
    
    examples = [
        ("下载单个视频", "python bilibili_downloader.py BV1xx411c7mD"),
        ("指定输出目录", "python bilibili_downloader.py BV1xx411c7mD -o my_videos"),
        ("下载最高720p", "python bilibili_downloader.py BV1xx411c7mD -q \"best[height<=720]\""),
        ("仅下载音频", "python bilibili_downloader.py BV1xx411c7mD --audio-only"),
        ("查看视频信息", "python bilibili_downloader.py BV1xx411c7mD --info"),
        ("查看可用格式", "python bilibili_downloader.py BV1xx411c7mD --formats"),
        ("使用高级下载器", "python advanced_downloader.py BV1xx411c7mD -p hd"),
        ("批量下载", "python batch_downloader.py urls.txt"),
        ("简单下载", "python simple_downloader.py"),
    ]
    
    for desc, cmd in examples:
        print(f"{desc}:")
        print(f"  {cmd}")
        print()

def main():
    print("哔哩哔哩视频下载器演示")
    print("请确保您已经:")
    print("1. 激活了conda环境: conda activate D:\\CondaEnvs\\videos")
    print("2. 安装了依赖包: pip install -r requirements.txt")
    print("3. 安装了FFmpeg")
    print()
    
    # 运行演示
    demo_basic_download()
    demo_advanced_download()
    demo_batch_download()
    show_usage_examples()
    
    print("=" * 60)
    print("演示完成！")
    print("=" * 60)
    print()
    print("提示:")
    print("- 所有示例中的BV号都是占位符，请替换为真实的视频URL")
    print("- 首次下载时可能需要较长时间来获取视频信息")
    print("- 确保网络连接良好")
    print("- 下载的视频仅供个人学习使用")

if __name__ == "__main__":
    main()
