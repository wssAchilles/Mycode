#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
高级哔哩哔哩视频下载器
支持配置文件自定义设置
"""

import os
import configparser
from pathlib import Path
from bilibili_downloader import BilibiliDownloader
import yt_dlp

class AdvancedBilibiliDownloader(BilibiliDownloader):
    def __init__(self, config_file="config.ini"):
        """
        初始化高级下载器，从配置文件读取设置
        
        Args:
            config_file: 配置文件路径
        """
        self.config = configparser.ConfigParser()
        
        # 读取配置文件
        if os.path.exists(config_file):
            self.config.read(config_file, encoding='utf-8')
        else:
            print(f"警告: 配置文件 {config_file} 不存在，使用默认设置")
            self.create_default_config(config_file)
            self.config.read(config_file, encoding='utf-8')
        
        # 从配置文件获取设置
        default_section = self.config['DEFAULT']
        
        output_dir = default_section.get('output_directory', 'downloads')
        quality = default_section.get('video_quality', 'best[height<=1080]')
        
        # 调用父类初始化
        super().__init__(output_dir, quality)
        
        # 应用配置文件设置
        self.apply_config()
    
    def create_default_config(self, config_file):
        """创建默认配置文件"""
        default_config = """# 哔哩哔哩下载器配置文件
[DEFAULT]
output_directory = downloads
video_quality = best[height<=1080]
download_subtitles = true
subtitle_languages = zh-CN,en
embed_subtitles = true
download_thumbnail = true
embed_thumbnail = true
download_info_json = true
output_template = %(uploader)s/%(title)s.%(ext)s
audio_quality = 192K
audio_format = mp3
video_format = mp4
download_delay = 2
max_retries = 3
ignore_errors = true
user_agent = 
proxy = 

[QUALITY_PRESETS]
ultra_hd = best[height<=2160]
full_hd = best[height<=1080]
hd = best[height<=720]
sd = best[height<=480]
audio_only = bestaudio/best
"""
        with open(config_file, 'w', encoding='utf-8') as f:
            f.write(default_config)
        print(f"已创建默认配置文件: {config_file}")
    
    def apply_config(self):
        """应用配置文件设置到yt-dlp选项"""
        default_section = self.config['DEFAULT']
        
        # 更新输出模板
        template = default_section.get('output_template', '%(uploader)s/%(title)s.%(ext)s')
        self.ydl_opts['outtmpl'] = str(self.output_dir / template)
        
        # 字幕设置
        if default_section.getboolean('download_subtitles', True):
            self.ydl_opts['writesubtitles'] = True
            self.ydl_opts['writeautomaticsub'] = True
            
            # 字幕语言
            languages = default_section.get('subtitle_languages', 'zh-CN,en').split(',')
            self.ydl_opts['subtitleslangs'] = [lang.strip() for lang in languages]
            
            # 嵌入字幕
            if default_section.getboolean('embed_subtitles', True):
                self.ydl_opts['embedsubs'] = True
        
        # 缩略图设置
        if default_section.getboolean('download_thumbnail', True):
            self.ydl_opts['writethumbnail'] = True
            
            if default_section.getboolean('embed_thumbnail', True):
                self.ydl_opts['embedthumbnail'] = True
        
        # 信息JSON文件
        if default_section.getboolean('download_info_json', True):
            self.ydl_opts['writeinfojson'] = True
        
        # 音频设置
        self.ydl_opts['audioquality'] = default_section.get('audio_quality', '192K')
        self.ydl_opts['audioformat'] = default_section.get('audio_format', 'mp3')
        
        # 错误处理
        self.ydl_opts['ignoreerrors'] = default_section.getboolean('ignore_errors', True)
        
        # 重试次数
        max_retries = default_section.getint('max_retries', 3)
        self.ydl_opts['retries'] = max_retries
        
        # 用户代理
        user_agent = default_section.get('user_agent', '').strip()
        if user_agent:
            self.ydl_opts['user_agent'] = user_agent
        
        # 代理设置
        proxy = default_section.get('proxy', '').strip()
        if proxy:
            self.ydl_opts['proxy'] = proxy
        
        # 视频格式转换
        video_format = default_section.get('video_format', 'mp4')
        if video_format != 'auto':
            for processor in self.ydl_opts['postprocessors']:
                if processor['key'] == 'FFmpegVideoConvertor':
                    processor['preferedformat'] = video_format
    
    def get_quality_preset(self, preset_name):
        """
        获取预设的视频质量
        
        Args:
            preset_name: 预设名称 (ultra_hd, full_hd, hd, sd, audio_only)
            
        Returns:
            str: 质量字符串
        """
        if 'QUALITY_PRESETS' in self.config:
            return self.config['QUALITY_PRESETS'].get(preset_name, self.quality)
        return self.quality
    
    def download_with_preset(self, url, preset_name):
        """
        使用预设质量下载视频
        
        Args:
            url: 视频URL
            preset_name: 预设名称
        """
        original_quality = self.quality
        self.quality = self.get_quality_preset(preset_name)
        self.ydl_opts['format'] = self.quality
        
        try:
            result = self.download_video(url)
        finally:
            # 恢复原始质量设置
            self.quality = original_quality
            self.ydl_opts['format'] = original_quality
        
        return result
    
    def show_config(self):
        """显示当前配置"""
        print("当前配置:")
        print(f"  输出目录: {self.output_dir}")
        print(f"  视频质量: {self.quality}")
        
        if 'QUALITY_PRESETS' in self.config:
            print("  质量预设:")
            for name, quality in self.config['QUALITY_PRESETS'].items():
                print(f"    {name}: {quality}")

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='高级哔哩哔哩视频下载器')
    parser.add_argument('url', nargs='?', help='视频URL、BV号或av号')
    parser.add_argument('-c', '--config', default='config.ini', help='配置文件路径')
    parser.add_argument('-p', '--preset', help='使用质量预设 (ultra_hd, full_hd, hd, sd, audio_only)')
    parser.add_argument('--show-config', action='store_true', help='显示当前配置')
    parser.add_argument('--create-config', action='store_true', help='创建默认配置文件')
    
    args = parser.parse_args()
    
    if args.create_config:
        downloader = AdvancedBilibiliDownloader(args.config)
        print("配置文件创建完成")
        return
    
    downloader = AdvancedBilibiliDownloader(args.config)
    
    if args.show_config:
        downloader.show_config()
        return
    
    if not args.url:
        print("请提供视频URL")
        return
    
    if args.preset:
        print(f"使用质量预设: {args.preset}")
        downloader.download_with_preset(args.url, args.preset)
    else:
        downloader.download_video(args.url)

if __name__ == '__main__':
    main()
