#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试特定视频的下载
"""

import yt_dlp

def test_video_download():
    # 您提供的URL
    url = "https://www.bilibili.com/video/BV1kp7HzZEzZ"
    
    print("=" * 60)
    print("测试视频下载 - 格式分析")
    print("=" * 60)
    
    # 首先获取所有可用格式
    print("1. 获取视频可用格式...")
    try:
        ydl_opts = {
            'listformats': True,
            'quiet': False,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
    except Exception as e:
        print(f"获取格式失败: {e}")
    
    print("\n" + "=" * 60)
    print("2. 尝试下载最低质量版本...")
    print("=" * 60)
    
    # 尝试不同的格式策略
    strategies = [
        ('最低质量', 'worst'),
        ('360p或以下', 'best[height<=360]'),
        ('480p或以下', 'best[height<=480]'),
        ('任意视频格式', 'bestvideo[ext=mp4]/best[ext=mp4]/best'),
    ]
    
    for name, format_selector in strategies:
        print(f"\n尝试策略: {name} ({format_selector})")
        
        ydl_opts = {
            'format': format_selector,
            'outtmpl': f'test_downloads/%(uploader)s - %(title)s - {name}.%(ext)s',
            'writeinfojson': True,
            'ignoreerrors': True,
            'no_warnings': False,
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
                print(f"✓ 成功下载: {name}")
                break  # 成功后停止尝试其他策略
        except Exception as e:
            print(f"✗ 失败: {e}")
    
    print("\n" + "=" * 60)
    print("3. 获取视频基本信息...")
    print("=" * 60)
    
    try:
        ydl_opts = {'quiet': True, 'no_warnings': True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            print(f"标题: {info.get('title', 'N/A')}")
            print(f"UP主: {info.get('uploader', 'N/A')}")
            print(f"时长: {info.get('duration', 0)//60}分{info.get('duration', 0)%60}秒")
            print(f"播放数: {info.get('view_count', 'N/A')}")
            print(f"描述: {info.get('description', 'N/A')[:200]}...")
            
    except Exception as e:
        print(f"获取信息失败: {e}")

if __name__ == "__main__":
    test_video_download()
