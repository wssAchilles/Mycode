#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
增强版哔哩哔哩视频下载脚本
处理各种下载限制和错误
"""

import yt_dlp
import os
from pathlib import Path

def get_available_formats(url):
    """
    获取视频可用格式
    """
    try:
        ydl_opts = {'quiet': True, 'no_warnings': True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if 'formats' in info:
                formats = []
                for f in info['formats']:
                    if f.get('vcodec') != 'none':  # 只要视频格式
                        height = f.get('height', 0)
                        ext = f.get('ext', 'unknown')
                        filesize = f.get('filesize', 0)
                        size_mb = filesize / (1024*1024) if filesize else 0
                        formats.append({
                            'format_id': f.get('format_id'),
                            'height': height,
                            'ext': ext,
                            'size_mb': size_mb,
                            'note': f.get('format_note', '')
                        })
                return sorted(formats, key=lambda x: x['height'], reverse=True)
    except Exception as e:
        print(f"获取格式信息失败: {e}")
    return []

def download_bilibili_video_enhanced(url, output_dir="downloads"):
    """
    增强版哔哩哔哩视频下载函数
    
    Args:
        url: 视频URL或BV号
        output_dir: 输出目录
    """
    # 创建输出目录
    Path(output_dir).mkdir(exist_ok=True)
    
    # 处理BV号
    if not url.startswith('http'):
        if url.startswith('BV'):
            url = f'https://www.bilibili.com/video/{url}'
        elif url.isdigit():
            url = f'https://www.bilibili.com/video/av{url}'
    
    print(f"正在分析视频: {url}")
    
    # 首先尝试获取视频信息
    try:
        info_opts = {'quiet': True, 'no_warnings': True}
        with yt_dlp.YoutubeDL(info_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            title = info.get('title', '未知标题')
            uploader = info.get('uploader', '未知UP主')
            duration = info.get('duration', 0)
            
            print(f"视频标题: {title}")
            print(f"UP主: {uploader}")
            print(f"时长: {duration//60}分{duration%60}秒")
    except Exception as e:
        print(f"获取视频信息失败: {e}")
        return False
    
    # 获取可用格式
    print("正在获取可用格式...")
    formats = get_available_formats(url)
    
    if formats:
        print("可用格式:")
        for i, fmt in enumerate(formats[:5]):  # 只显示前5个格式
            size_info = f" ({fmt['size_mb']:.1f}MB)" if fmt['size_mb'] > 0 else ""
            print(f"  {i+1}. {fmt['height']}p {fmt['ext']} {fmt['note']}{size_info}")
    
    # 尝试多种格式策略下载
    format_strategies = [
        'best[height<=720]',      # 720p或以下
        'best[height<=480]',      # 480p或以下
        'best[height<=360]',      # 360p或以下
        'worst',                  # 最低质量
    ]
    
    for strategy in format_strategies:
        print(f"\n尝试格式: {strategy}")
        
        ydl_opts = {
            'format': strategy,
            'outtmpl': f'{output_dir}/%(uploader)s - %(title)s.%(ext)s',
            'writeinfojson': True,
            'writethumbnail': True,
            'ignoreerrors': False,
            'no_warnings': False,
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
                print("✓ 下载成功！")
                return True
        except Exception as e:
            print(f"✗ 下载失败: {e}")
            continue
    
    print("所有格式都下载失败，可能需要登录或该视频不可访问")
    return False

def download_audio_only(url, output_dir="downloads/audio"):
    """
    仅下载音频
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    
    # 处理BV号
    if not url.startswith('http'):
        if url.startswith('BV'):
            url = f'https://www.bilibili.com/video/{url}'
        elif url.isdigit():
            url = f'https://www.bilibili.com/video/av{url}'
    
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': f'{output_dir}/%(uploader)s - %(title)s.%(ext)s',
        'extractaudio': True,
        'audioformat': 'mp3',
        'audioquality': '192K',
        'writeinfojson': True,
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            print(f"正在下载音频: {url}")
            ydl.download([url])
            print("✓ 音频下载成功！")
            return True
    except Exception as e:
        print(f"✗ 音频下载失败: {e}")
        return False

def main():
    print("哔哩哔哩视频下载器 - 增强版")
    print("=" * 40)
    
    while True:
        print("\n选择操作:")
        print("1. 下载视频")
        print("2. 仅下载音频")
        print("3. 查看视频信息")
        print("4. 退出")
        
        choice = input("请输入选择 (1-4): ").strip()
        
        if choice == '4':
            print("再见！")
            break
        
        if choice not in ['1', '2', '3']:
            print("无效选择，请重新输入")
            continue
        
        url = input("请输入哔哩哔哩视频URL或BV号: ").strip()
        if not url:
            print("未输入有效URL")
            continue
        
        if choice == '1':
            download_bilibili_video_enhanced(url)
        elif choice == '2':
            download_audio_only(url)
        elif choice == '3':
            # 仅显示信息
            try:
                # 处理BV号
                if not url.startswith('http'):
                    if url.startswith('BV'):
                        url = f'https://www.bilibili.com/video/{url}'
                    elif url.isdigit():
                        url = f'https://www.bilibili.com/video/av{url}'
                
                info_opts = {'quiet': True, 'no_warnings': True}
                with yt_dlp.YoutubeDL(info_opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                    
                    print(f"\n视频信息:")
                    print(f"标题: {info.get('title', 'N/A')}")
                    print(f"UP主: {info.get('uploader', 'N/A')}")
                    print(f"时长: {info.get('duration', 0)//60}分{info.get('duration', 0)%60}秒")
                    print(f"播放数: {info.get('view_count', 'N/A')}")
                    print(f"发布日期: {info.get('upload_date', 'N/A')}")
                    print(f"描述: {info.get('description', 'N/A')[:100]}...")
                    
                    # 显示可用格式
                    formats = get_available_formats(url)
                    if formats:
                        print(f"\n可用格式 (共{len(formats)}个):")
                        for i, fmt in enumerate(formats[:10]):  # 显示前10个
                            size_info = f" ({fmt['size_mb']:.1f}MB)" if fmt['size_mb'] > 0 else ""
                            print(f"  {fmt['height']}p {fmt['ext']} {fmt['note']}{size_info}")
                        
            except Exception as e:
                print(f"获取视频信息失败: {e}")

if __name__ == "__main__":
    main()
