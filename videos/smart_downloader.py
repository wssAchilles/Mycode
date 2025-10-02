#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
智能哔哩哔哩下载器
自动处理各种B站限制和格式问题
"""

import yt_dlp
import os
from pathlib import Path
import json

class SmartBilibiliDownloader:
    def __init__(self, output_dir="downloads"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        
    def analyze_video(self, url):
        """分析视频，获取详细信息和可用格式"""
        try:
            ydl_opts = {'quiet': True, 'no_warnings': True}
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                
                # 分析可用格式
                available_formats = []
                if 'formats' in info:
                    for fmt in info['formats']:
                        format_info = {
                            'format_id': fmt.get('format_id'),
                            'ext': fmt.get('ext', 'unknown'),
                            'height': fmt.get('height', 0),
                            'width': fmt.get('width', 0),
                            'filesize': fmt.get('filesize', 0),
                            'vcodec': fmt.get('vcodec', 'unknown'),
                            'acodec': fmt.get('acodec', 'unknown'),
                            'format_note': fmt.get('format_note', ''),
                            'protocol': fmt.get('protocol', 'unknown'),
                        }
                        available_formats.append(format_info)
                
                return {
                    'title': info.get('title', '未知标题'),
                    'uploader': info.get('uploader', '未知UP主'),
                    'duration': info.get('duration', 0),
                    'view_count': info.get('view_count', 0),
                    'description': info.get('description', ''),
                    'formats': available_formats
                }
        except Exception as e:
            print(f"分析视频失败: {e}")
            return None
    
    def find_best_format_combination(self, formats):
        """找到最佳的格式组合"""
        video_formats = [f for f in formats if f['vcodec'] != 'none' and f['height'] > 0]
        audio_formats = [f for f in formats if f['acodec'] != 'none' and f['vcodec'] == 'none']
        
        # 按质量排序
        video_formats.sort(key=lambda x: (x['height'], x['filesize'] or 0), reverse=True)
        audio_formats.sort(key=lambda x: x['filesize'] or 0, reverse=True)
        
        # 找到合适的视频格式（不超过720p）
        suitable_video = None
        for vf in video_formats:
            if vf['height'] <= 720:
                suitable_video = vf
                break
        
        # 如果没有720p以下的，选择最低质量的
        if not suitable_video and video_formats:
            suitable_video = video_formats[-1]
        
        # 选择最佳音频
        suitable_audio = audio_formats[0] if audio_formats else None
        
        return suitable_video, suitable_audio
    
    def download_with_custom_format(self, url, video_format_id=None, audio_format_id=None):
        """使用自定义格式下载"""
        if video_format_id and audio_format_id:
            format_selector = f"{video_format_id}+{audio_format_id}"
        elif video_format_id:
            format_selector = video_format_id
        else:
            # 回退到自动选择
            format_selector = "best[height<=720]/best[height<=480]/worst"
        
        ydl_opts = {
            'format': format_selector,
            'outtmpl': str(self.output_dir / '%(uploader)s - %(title)s.%(ext)s'),
            'writeinfojson': True,
            'writethumbnail': True,
            'merge_output_format': 'mp4',
            'postprocessors': [{
                'key': 'FFmpegVideoConvertor',
                'preferedformat': 'mp4',
            }],
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
                return True
        except Exception as e:
            print(f"下载失败: {e}")
            return False
    
    def download_audio_only(self, url):
        """仅下载音频"""
        # 找到音频格式
        info = self.analyze_video(url)
        if not info:
            return False
        
        audio_formats = [f for f in info['formats'] if f['acodec'] != 'none' and f['vcodec'] == 'none']
        if not audio_formats:
            print("未找到可用的音频格式")
            return False
        
        # 选择最佳音频格式
        best_audio = max(audio_formats, key=lambda x: x['filesize'] or 0)
        
        ydl_opts = {
            'format': best_audio['format_id'],
            'outtmpl': str(self.output_dir / 'Audio' / '%(uploader)s - %(title)s.%(ext)s'),
            'writeinfojson': True,
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
                print(f"✓ 音频下载成功: {best_audio['format_id']}")
                return True
        except Exception as e:
            print(f"音频下载失败: {e}")
            return False
    
    def smart_download(self, url):
        """智能下载 - 自动选择最佳策略"""
        print(f"正在分析视频: {url}")
        
        # 处理URL
        if not url.startswith('http'):
            if url.startswith('BV'):
                url = f'https://www.bilibili.com/video/{url}'
            elif url.isdigit():
                url = f'https://www.bilibili.com/video/av{url}'
        
        # 分析视频
        info = self.analyze_video(url)
        if not info:
            return False
        
        print(f"视频标题: {info['title']}")
        print(f"UP主: {info['uploader']}")
        print(f"时长: {int(info['duration'])//60}:{int(info['duration'])%60:02d}")
        
        # 分析格式
        video_fmt, audio_fmt = self.find_best_format_combination(info['formats'])
        
        if video_fmt:
            print(f"选择视频格式: {video_fmt['height']}p {video_fmt['ext']} ({video_fmt['format_id']})")
        if audio_fmt:
            print(f"选择音频格式: {audio_fmt['ext']} ({audio_fmt['format_id']})")
        
        # 尝试下载
        strategies = []
        
        # 策略1：视频+音频合并
        if video_fmt and audio_fmt:
            strategies.append(('视频+音频合并', video_fmt['format_id'], audio_fmt['format_id']))
        
        # 策略2：仅视频格式
        if video_fmt:
            strategies.append(('仅视频', video_fmt['format_id'], None))
        
        # 策略3：自动选择
        strategies.append(('自动选择', None, None))
        
        for strategy_name, vid_id, aud_id in strategies:
            print(f"\n尝试策略: {strategy_name}")
            if self.download_with_custom_format(url, vid_id, aud_id):
                print(f"✓ 下载成功: {strategy_name}")
                return True
            else:
                print(f"✗ 策略失败: {strategy_name}")
        
        # 最后尝试仅下载音频
        print("\n尝试仅下载音频...")
        if self.download_audio_only(url):
            print("✓ 音频下载成功")
            return True
        
        print("✗ 所有下载策略都失败了")
        return False

def main():
    downloader = SmartBilibiliDownloader()
    
    # 测试特定视频
    test_url = "https://www.bilibili.com/video/BV1kp7HzZEzZ"
    
    print("=" * 60)
    print("智能哔哩哔哩下载器测试")
    print("=" * 60)
    
    result = downloader.smart_download(test_url)
    
    if result:
        print("\n" + "=" * 40)
        print("下载完成！检查下载目录:")
        
        # 列出下载的文件
        downloads_dir = Path("downloads")
        if downloads_dir.exists():
            for file in downloads_dir.rglob("*"):
                if file.is_file():
                    size_mb = file.stat().st_size / (1024 * 1024)
                    print(f"  {file.relative_to(downloads_dir)} ({size_mb:.1f} MB)")
    else:
        print("\n下载失败。可能的解决方案:")
        print("1. 使用浏览器登录哔哩哔哩获取cookies")
        print("2. 尝试其他视频")
        print("3. 检查网络连接")

if __name__ == "__main__":
    main()
