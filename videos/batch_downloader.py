#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量下载哔哩哔哩视频
从文本文件读取URL列表进行批量下载
"""

import os
import time
from pathlib import Path
from bilibili_downloader import BilibiliDownloader

def batch_download_from_file(file_path: str, output_dir: str = "downloads"):
    """
    从文件批量下载视频
    
    Args:
        file_path: 包含URL列表的文件路径
        output_dir: 输出目录
    """
    if not os.path.exists(file_path):
        print(f"文件不存在: {file_path}")
        return
    
    downloader = BilibiliDownloader(output_dir)
    
    with open(file_path, 'r', encoding='utf-8') as f:
        urls = [line.strip() for line in f if line.strip() and not line.startswith('#')]
    
    print(f"共找到 {len(urls)} 个URL")
    
    success_count = 0
    failed_urls = []
    
    for i, url in enumerate(urls, 1):
        print(f"\n[{i}/{len(urls)}] 正在处理: {url}")
        
        if downloader.download_video(url):
            success_count += 1
        else:
            failed_urls.append(url)
        
        # 避免请求过于频繁
        if i < len(urls):
            time.sleep(2)
    
    print(f"\n下载完成!")
    print(f"成功: {success_count}")
    print(f"失败: {len(failed_urls)}")
    
    if failed_urls:
        print("\n失败的URL:")
        for url in failed_urls:
            print(f"  - {url}")

def create_url_list_template():
    """创建URL列表模板文件"""
    template_content = """# 哔哩哔哩视频URL列表
# 每行一个URL，以#开头的行为注释
# 支持完整URL、BV号、av号

# 示例:
# https://www.bilibili.com/video/BV1xx411c7mD
# BV1xx411c7mD
# av12345678

"""
    
    with open("urls.txt", "w", encoding="utf-8") as f:
        f.write(template_content)
    
    print("已创建URL列表模板文件: urls.txt")
    print("请编辑该文件，添加要下载的视频URL")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("用法:")
        print("  python batch_downloader.py <url_file>  # 批量下载")
        print("  python batch_downloader.py --template  # 创建模板文件")
        sys.exit(1)
    
    if sys.argv[1] == "--template":
        create_url_list_template()
    else:
        batch_download_from_file(sys.argv[1])
