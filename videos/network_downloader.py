#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
网络优化版哔哩哔哩下载器
解决SSL和连接问题
"""

import yt_dlp
import os
from pathlib import Path
import ssl
import urllib3

# 禁用SSL警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def create_robust_downloader_config():
    """创建稳定的下载器配置"""
    return {
        # 网络配置
        'socket_timeout': 30,
        'retries': 3,
        'fragment_retries': 3,
        'extractor_retries': 3,
        'file_access_retries': 3,
        
        # HTTP配置
        'http_chunk_size': 1048576,  # 1MB chunks
        'prefer_insecure': False,
        
        # 用户代理
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        
        # 其他配置
        'no_warnings': False,
        'ignoreerrors': False,
    }

def download_with_retry(url, output_dir="downloads", max_attempts=3):
    """
    带重试机制的下载函数
    """
    Path(output_dir).mkdir(exist_ok=True)
    
    # 处理URL
    if not url.startswith('http'):
        if url.startswith('BV'):
            url = f'https://www.bilibili.com/video/{url}'
        elif url.isdigit():
            url = f'https://www.bilibili.com/video/av{url}'
    
    print(f"正在下载: {url}")
    
    # 不同的下载策略
    strategies = [
        {
            'name': '音频格式 (最稳定)',
            'format': '30280/30232/30216',  # 直接指定音频格式ID
            'outtmpl': f'{output_dir}/Audio/%(uploader)s - %(title)s.%(ext)s',
        },
        {
            'name': '低质量视频',
            'format': '100022',  # 360p AV1格式
            'outtmpl': f'{output_dir}/%(uploader)s - %(title)s - 360p.%(ext)s',
        },
        {
            'name': '最低质量',
            'format': 'worst',
            'outtmpl': f'{output_dir}/%(uploader)s - %(title)s - worst.%(ext)s',
        }
    ]
    
    for attempt in range(max_attempts):
        print(f"\n=== 尝试 {attempt + 1}/{max_attempts} ===")
        
        for strategy in strategies:
            print(f"策略: {strategy['name']}")
            
            # 基础配置
            ydl_opts = create_robust_downloader_config()
            ydl_opts.update({
                'format': strategy['format'],
                'outtmpl': strategy['outtmpl'],
                'writeinfojson': True,
                'writethumbnail': True,
            })
            
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([url])
                    print(f"✓ 成功下载: {strategy['name']}")
                    return True
                    
            except yt_dlp.DownloadError as e:
                print(f"✗ 下载错误: {e}")
                continue
            except Exception as e:
                print(f"✗ 其他错误: {e}")
                continue
        
        if attempt < max_attempts - 1:
            print("等待5秒后重试...")
            import time
            time.sleep(5)
    
    print("所有尝试都失败了")
    return False

def simple_audio_download(url, output_dir="downloads/audio"):
    """
    简化的音频下载
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    
    # 处理URL
    if not url.startswith('http'):
        if url.startswith('BV'):
            url = f'https://www.bilibili.com/video/{url}'
        elif url.isdigit():
            url = f'https://www.bilibili.com/video/av{url}'
    
    # 最简单的配置
    ydl_opts = {
        'format': 'bestaudio',
        'outtmpl': f'{output_dir}/%(title)s.%(ext)s',
        'socket_timeout': 60,
        'retries': 5,
        'ignoreerrors': True,
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            print("尝试下载音频...")
            ydl.download([url])
            print("✓ 音频下载成功")
            return True
    except Exception as e:
        print(f"✗ 音频下载失败: {e}")
        return False

def test_network_download():
    """测试网络下载"""
    # 您的测试URL
    test_url = "https://www.bilibili.com/video/BV1kp7HzZEzZ"
    
    print("=" * 60)
    print("网络优化版下载测试")
    print("=" * 60)
    
    # 首先尝试完整下载
    print("1. 尝试完整下载...")
    success = download_with_retry(test_url, "network_downloads")
    
    if not success:
        print("\n2. 尝试仅下载音频...")
        success = simple_audio_download(test_url, "network_downloads/audio")
    
    if success:
        print("\n✓ 下载成功！查看 network_downloads 目录")
        
        # 显示下载的文件
        download_dir = Path("network_downloads")
        if download_dir.exists():
            print("\n下载的文件:")
            for file in download_dir.rglob("*"):
                if file.is_file():
                    size_mb = file.stat().st_size / (1024 * 1024)
                    print(f"  {file.relative_to(download_dir)} ({size_mb:.1f} MB)")
    else:
        print("\n✗ 下载失败")
        print("\n可能的原因和解决方案:")
        print("1. 网络连接不稳定 - 请检查网络")
        print("2. 该视频需要登录 - 考虑使用cookies")
        print("3. 地区限制 - 可能需要代理")
        print("4. B站临时限制 - 稍后再试")

def interactive_download():
    """交互式下载"""
    print("网络优化版哔哩哔哩下载器")
    print("=" * 40)
    
    while True:
        print("\n选择下载模式:")
        print("1. 完整下载 (视频+音频)")
        print("2. 仅下载音频")
        print("3. 测试特定视频")
        print("4. 退出")
        
        choice = input("请选择 (1-4): ").strip()
        
        if choice == '4':
            break
        elif choice == '3':
            test_network_download()
            continue
        elif choice not in ['1', '2']:
            print("无效选择")
            continue
        
        url = input("请输入视频URL或BV号: ").strip()
        if not url:
            print("未输入URL")
            continue
        
        if choice == '1':
            download_with_retry(url)
        elif choice == '2':
            simple_audio_download(url)

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        test_network_download()
    else:
        interactive_download()
