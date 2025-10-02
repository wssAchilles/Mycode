#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
哔哩哔哩视频下载器 - 解决分离格式问题
专门处理B站视频音频分离的情况
"""

import yt_dlp
import os
from pathlib import Path

def download_bilibili_fixed(url, output_dir="downloads"):
    """
    修复版哔哩哔哩下载器
    正确处理视频音频分离的问题
    """
    # 创建输出目录
    Path(output_dir).mkdir(exist_ok=True)
    
    # 处理BV号
    if not url.startswith('http'):
        if url.startswith('BV'):
            url = f'https://www.bilibili.com/video/{url}'
        elif url.isdigit():
            url = f'https://www.bilibili.com/video/av{url}'
    
    print(f"正在下载: {url}")
    
    # 配置下载选项 - 关键是正确的格式选择
    ydl_opts = {
        # 选择最佳视频+最佳音频，然后合并
        'format': 'bestvideo[height<=720]+bestaudio/best[height<=720]/bestvideo[height<=480]+bestaudio/best[height<=480]/worst',
        'outtmpl': f'{output_dir}/%(uploader)s - %(title)s.%(ext)s',
        'writeinfojson': True,
        'writethumbnail': True,
        'merge_output_format': 'mp4',  # 合并为mp4格式
        'ignoreerrors': False,
        # 后处理器 - 用于合并视频和音频
        'postprocessors': [{
            'key': 'FFmpegVideoConvertor',
            'preferedformat': 'mp4',
        }],
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
            print("✓ 下载完成！")
            return True
    except Exception as e:
        print(f"✗ 下载失败: {e}")
        
        # 如果失败，尝试更简单的策略
        print("尝试备用下载策略...")
        
        # 备用策略：只选择包含音频的完整格式
        backup_opts = {
            'format': 'best[ext=mp4]/best',
            'outtmpl': f'{output_dir}/%(uploader)s - %(title)s - 备用.%(ext)s',
            'writeinfojson': True,
            'ignoreerrors': True,
        }
        
        try:
            with yt_dlp.YoutubeDL(backup_opts) as ydl:
                ydl.download([url])
                print("✓ 备用策略下载完成！")
                return True
        except Exception as e2:
            print(f"✗ 备用策略也失败: {e2}")
            return False

def test_specific_video():
    """测试您提供的特定视频"""
    url = "https://www.bilibili.com/video/BV1kp7HzZEzZ"
    
    print("=" * 60)
    print("测试特定视频下载")
    print("=" * 60)
    
    success = download_bilibili_fixed(url, "test_downloads")
    
    if success:
        print("\n下载成功！检查 test_downloads 目录")
        
        # 列出下载的文件
        test_dir = Path("test_downloads")
        if test_dir.exists():
            print("\n下载的文件:")
            for file in test_dir.iterdir():
                if file.is_file():
                    size_mb = file.stat().st_size / (1024 * 1024)
                    print(f"  {file.name} ({size_mb:.1f} MB)")
    else:
        print("\n下载失败，可能的原因:")
        print("1. 该视频需要登录才能访问")
        print("2. 该视频有地区限制")
        print("3. 该视频需要会员权限")
        print("4. 网络连接问题")

def download_with_login_hint():
    """带登录提示的下载器"""
    print("=" * 60)
    print("哔哩哔哩下载器 - 登录版提示")
    print("=" * 60)
    print()
    print("注意：如果视频需要登录，您可以:")
    print("1. 使用浏览器登录哔哩哔哩")
    print("2. 导出cookies（推荐使用浏览器扩展）")
    print("3. 使用 --cookies-from-browser 选项")
    print()
    print("暂时我们尝试下载无需登录的内容...")
    print()
    
    url = input("请输入视频URL或BV号: ").strip()
    if url:
        download_bilibili_fixed(url)

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        test_specific_video()
    else:
        # 交互模式
        while True:
            print("\n" + "=" * 40)
            print("哔哩哔哩下载器")
            print("=" * 40)
            print("1. 下载视频")
            print("2. 测试特定视频 (BV1kp7HzZEzZ)")
            print("3. 退出")
            
            choice = input("请选择 (1-3): ").strip()
            
            if choice == '1':
                url = input("请输入视频URL或BV号: ").strip()
                if url:
                    download_bilibili_fixed(url)
            elif choice == '2':
                test_specific_video()
            elif choice == '3':
                print("再见！")
                break
            else:
                print("无效选择")
