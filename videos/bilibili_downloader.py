#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
哔哩哔哩视频下载器
支持单个视频、播放列表和UP主所有视频的下载
需要FFmpeg支持
"""

import os
import sys
import re
import json
import argparse
from pathlib import Path
from typing import Optional, Dict, Any
import yt_dlp
from colorama import init, Fore, Style

# 初始化colorama
init(autoreset=True)

class BilibiliDownloader:
    def __init__(self, output_dir: str = "downloads", quality: str = "best"):
        """
        初始化哔哩哔哩下载器
        
        Args:
            output_dir: 下载目录
            quality: 视频质量 (best, worst, bestvideo, bestaudio等)
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        self.quality = quality
        
        # 配置yt-dlp选项
        self.ydl_opts = {
            'format': quality,
            'outtmpl': str(self.output_dir / '%(uploader)s/%(title)s.%(ext)s'),
            'writesubtitles': True,
            'writeautomaticsub': True,
            'subtitleslangs': ['zh-CN', 'zh-TW', 'en'],
            'writeinfojson': True,
            'writethumbnail': True,
            'embedthumbnail': True,
            'embedsubs': True,
            'ignoreerrors': True,
            'no_warnings': False,
            'extractaudio': False,
            'audioformat': 'mp3',
            'audioquality': '192K',
            'postprocessors': [
                {
                    'key': 'FFmpegVideoConvertor',
                    'preferedformat': 'mp4',
                },
                {
                    'key': 'FFmpegEmbedSubtitle',
                },
                {
                    'key': 'EmbedThumbnail',
                    'already_have_thumbnail': False,
                },
            ],
        }
    
    def download_video(self, url: str) -> bool:
        """
        下载单个视频
        
        Args:
            url: 视频URL
            
        Returns:
            bool: 下载是否成功
        """
        try:
            with yt_dlp.YoutubeDL(self.ydl_opts) as ydl:
                print(f"{Fore.CYAN}正在下载: {url}")
                ydl.download([url])
                print(f"{Fore.GREEN}✓ 下载完成: {url}")
                return True
        except Exception as e:
            print(f"{Fore.RED}✗ 下载失败: {url}")
            print(f"{Fore.RED}错误信息: {str(e)}")
            return False
    
    def download_playlist(self, url: str) -> None:
        """
        下载播放列表或合集
        
        Args:
            url: 播放列表URL
        """
        try:
            opts = self.ydl_opts.copy()
            opts['outtmpl'] = str(self.output_dir / '%(uploader)s/%(playlist)s/%(playlist_index)s - %(title)s.%(ext)s')
            
            with yt_dlp.YoutubeDL(opts) as ydl:
                print(f"{Fore.CYAN}正在下载播放列表: {url}")
                ydl.download([url])
                print(f"{Fore.GREEN}✓ 播放列表下载完成")
        except Exception as e:
            print(f"{Fore.RED}✗ 播放列表下载失败")
            print(f"{Fore.RED}错误信息: {str(e)}")
    
    def download_user_videos(self, user_url: str, limit: Optional[int] = None) -> None:
        """
        下载UP主的所有视频
        
        Args:
            user_url: UP主主页URL
            limit: 下载数量限制，None表示全部下载
        """
        try:
            opts = self.ydl_opts.copy()
            if limit:
                opts['playlist_items'] = f'1-{limit}'
            
            with yt_dlp.YoutubeDL(opts) as ydl:
                print(f"{Fore.CYAN}正在下载UP主视频: {user_url}")
                if limit:
                    print(f"{Fore.YELLOW}限制下载数量: {limit}")
                ydl.download([user_url])
                print(f"{Fore.GREEN}✓ UP主视频下载完成")
        except Exception as e:
            print(f"{Fore.RED}✗ UP主视频下载失败")
            print(f"{Fore.RED}错误信息: {str(e)}")
    
    def get_video_info(self, url: str) -> Optional[Dict[str, Any]]:
        """
        获取视频信息
        
        Args:
            url: 视频URL
            
        Returns:
            Dict: 视频信息字典
        """
        try:
            opts = {'quiet': True, 'no_warnings': True}
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
                return info
        except Exception as e:
            print(f"{Fore.RED}获取视频信息失败: {str(e)}")
            return None
    
    def list_formats(self, url: str) -> None:
        """
        列出视频可用格式
        
        Args:
            url: 视频URL
        """
        try:
            opts = {'listformats': True, 'quiet': False}
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.extract_info(url, download=False)
        except Exception as e:
            print(f"{Fore.RED}获取格式列表失败: {str(e)}")
    
    def download_audio_only(self, url: str) -> bool:
        """
        仅下载音频
        
        Args:
            url: 视频URL
            
        Returns:
            bool: 下载是否成功
        """
        try:
            opts = self.ydl_opts.copy()
            opts.update({
                'format': 'bestaudio/best',
                'extractaudio': True,
                'audioformat': 'mp3',
                'outtmpl': str(self.output_dir / '%(uploader)s/Audio/%(title)s.%(ext)s'),
            })
            
            with yt_dlp.YoutubeDL(opts) as ydl:
                print(f"{Fore.CYAN}正在下载音频: {url}")
                ydl.download([url])
                print(f"{Fore.GREEN}✓ 音频下载完成")
                return True
        except Exception as e:
            print(f"{Fore.RED}✗ 音频下载失败")
            print(f"{Fore.RED}错误信息: {str(e)}")
            return False

def parse_bilibili_url(url: str) -> str:
    """
    标准化哔哩哔哩URL格式
    
    Args:
        url: 原始URL
        
    Returns:
        str: 标准化后的URL
    """
    # BV号提取
    bv_pattern = r'BV[a-zA-Z0-9]+'
    av_pattern = r'av(\d+)'
    
    if 'bilibili.com' not in url:
        # 如果只是BV号或av号
        if re.match(bv_pattern, url):
            return f'https://www.bilibili.com/video/{url}'
        elif re.match(r'^\d+$', url):
            return f'https://www.bilibili.com/video/av{url}'
    
    return url

def main():
    parser = argparse.ArgumentParser(description='哔哩哔哩视频下载器')
    parser.add_argument('url', help='视频URL、BV号或av号')
    parser.add_argument('-o', '--output', default='downloads', help='输出目录 (默认: downloads)')
    parser.add_argument('-q', '--quality', default='best', help='视频质量 (默认: best)')
    parser.add_argument('--audio-only', action='store_true', help='仅下载音频')
    parser.add_argument('--playlist', action='store_true', help='下载播放列表/合集')
    parser.add_argument('--user', action='store_true', help='下载UP主所有视频')
    parser.add_argument('--limit', type=int, help='限制下载数量（仅用于UP主视频）')
    parser.add_argument('--info', action='store_true', help='仅显示视频信息，不下载')
    parser.add_argument('--formats', action='store_true', help='列出可用格式')
    
    args = parser.parse_args()
    
    # 标准化URL
    url = parse_bilibili_url(args.url)
    
    # 创建下载器
    downloader = BilibiliDownloader(args.output, args.quality)
    
    print(f"{Fore.YELLOW}{'='*60}")
    print(f"{Fore.YELLOW}哔哩哔哩视频下载器")
    print(f"{Fore.YELLOW}{'='*60}")
    print(f"{Fore.CYAN}URL: {url}")
    print(f"{Fore.CYAN}输出目录: {args.output}")
    print(f"{Fore.CYAN}视频质量: {args.quality}")
    print(f"{Fore.YELLOW}{'='*60}")
    
    try:
        if args.info:
            # 显示视频信息
            info = downloader.get_video_info(url)
            if info:
                print(f"{Fore.GREEN}视频标题: {info.get('title', 'N/A')}")
                print(f"{Fore.GREEN}UP主: {info.get('uploader', 'N/A')}")
                print(f"{Fore.GREEN}时长: {info.get('duration', 'N/A')} 秒")
                print(f"{Fore.GREEN}观看数: {info.get('view_count', 'N/A')}")
                print(f"{Fore.GREEN}发布日期: {info.get('upload_date', 'N/A')}")
                
        elif args.formats:
            # 列出格式
            downloader.list_formats(url)
            
        elif args.audio_only:
            # 仅下载音频
            downloader.download_audio_only(url)
            
        elif args.playlist:
            # 下载播放列表
            downloader.download_playlist(url)
            
        elif args.user:
            # 下载UP主视频
            downloader.download_user_videos(url, args.limit)
            
        else:
            # 下载单个视频
            downloader.download_video(url)
            
    except KeyboardInterrupt:
        print(f"\n{Fore.YELLOW}用户中断下载")
        sys.exit(0)
    except Exception as e:
        print(f"{Fore.RED}程序错误: {str(e)}")
        sys.exit(1)

if __name__ == '__main__':
    main()
