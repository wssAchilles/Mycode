#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
简单的哔哩哔哩视频下载脚本
适合快速下载使用
"""

import yt_dlp
import os
from pathlib import Path

def download_bilibili_video(url, output_dir="downloads"):
    """
    简单的哔哩哔哩视频下载函数
    
    Args:
        url: 视频URL或BV号
        output_dir: 输出目录
    """
    # 创建输出目录
    Path(output_dir).mkdir(exist_ok=True)
    
    # 配置下载选项
    ydl_opts = {
        # 格式选择：优先720p，然后480p，最后任意可用格式
        'format': 'best[height<=720]/best[height<=480]/best',
        'outtmpl': f'{output_dir}/%(uploader)s - %(title)s.%(ext)s',
        'writesubtitles': False,  # 暂时关闭字幕下载，避免登录问题
        'writeautomaticsub': False,
        'writethumbnail': True,  # 下载缩略图
        'writeinfojson': True,   # 下载视频信息
        'ignoreerrors': True,    # 忽略一些错误继续下载
    }
    
    # 处理BV号
    if not url.startswith('http'):
        if url.startswith('BV'):
            url = f'https://www.bilibili.com/video/{url}'
        elif url.isdigit():
            url = f'https://www.bilibili.com/video/av{url}'
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            print(f"正在下载: {url}")
            ydl.download([url])
            print("下载完成！")
    except Exception as e:
        print(f"下载失败: {e}")

if __name__ == "__main__":
    # 示例使用
    video_url = input("请输入哔哩哔哩视频URL或BV号: ").strip()
    
    if video_url:
        download_bilibili_video(video_url)
    else:
        print("未输入有效URL")
