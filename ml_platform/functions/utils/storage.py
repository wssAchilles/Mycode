"""
存储工具模块
负责从 Firebase Storage 或其他来源处理文件
"""

from typing import Optional
import urllib.parse
import io
import pandas as pd
from firebase_admin import storage

def download_dataset_from_storage(dataset_url: str) -> pd.DataFrame:
    """
    从 Firebase Storage 下载数据集并转换为 DataFrame
    
    Args:
        dataset_url: 数据集的 URL (支持 gs:// 或 https:// 格式)
        
    Returns:
        pd.DataFrame: 数据集内容
        
    Raises:
        ValueError: URL 格式错误或文件无法读取
        Exception: 下载过程中的其他错误
    """
    if not dataset_url:
        raise ValueError("URL 不能为空")

    bucket_name = ""
    file_path = ""
    
    try:
        # 解析 URL
        if dataset_url.startswith('gs://'):
            # 格式: gs://bucket-name/path/to/file.csv
            parts = dataset_url[5:].split('/', 1)
            if len(parts) < 2:
                raise ValueError(f"gs:// URL 格式错误: {dataset_url}")
            bucket_name = parts[0]
            file_path = parts[1]
        elif dataset_url.startswith('http'):
            # 格式: https://firebasestorage.googleapis.com/...
            # 尝试解析标准 Firebase Storage URL
            parsed = urllib.parse.urlparse(dataset_url)
            path_parts = parsed.path.split('/')
            
            # Firebase Storage URL 通常包含 /b/bucket-name/o/file-path
            if '/b/' in parsed.path and '/o/' in parsed.path:
                try:
                    b_index = path_parts.index('b')
                    o_index = path_parts.index('o')
                    if b_index + 1 < len(path_parts):
                        bucket_name = path_parts[b_index + 1]
                    if o_index + 1 < len(path_parts):
                        # URL中的路径是被编码的
                        file_path = urllib.parse.unquote(path_parts[o_index + 1])
                except ValueError:
                    pass
            
            # 如果解析失败，回退到 requests 直接下载（如果允许外部网络）
            # 注意：Cloud Functions 默认可能没有外网（视配置而定），且这里主要针对内部 Storage
            if not bucket_name or not file_path:
                 # TODO: 如果需要支持非 Storage 的 http 链接，需要引入 requests
                 # 但考虑到依赖和安全，暂时只支持 Storage
                 raise ValueError(f"无法解析的 Firebase Storage URL: {dataset_url}")
        else:
             raise ValueError(f"不支持的 URL 协议: {dataset_url}")
            
        print(f"正在从 Bucket: {bucket_name} 下载文件: {file_path}")
        
        # 下载文件
        bucket = storage.bucket(bucket_name)
        blob = bucket.blob(file_path)
        
        # 使用 download_as_bytes 而不是 text，更通用
        content_bytes = blob.download_as_bytes()
        
        if not content_bytes:
             raise ValueError("文件内容为空")
             
        # 尝试读取 CSV
        # 显式指定 encoding，防止编码问题
        try:
            df = pd.read_csv(io.BytesIO(content_bytes), encoding='utf-8')
        except UnicodeDecodeError:
            # 尝试 gbk
            df = pd.read_csv(io.BytesIO(content_bytes), encoding='gbk')
            
        return df
        
    except Exception as e:
        raise Exception(f"数据集下载或解析失败: {str(e)}")
