
import os
from pathlib import Path

import gdown


def _extract_drive_id(file_id_or_url: str) -> str:
    if not file_id_or_url:
        return ""
    token = file_id_or_url.strip()
    if "drive.google.com" not in token:
        return token
    if "/d/" in token:
        part = token.split("/d/", 1)[1]
        return part.split("/", 1)[0].split("?", 1)[0]
    if "id=" in token:
        part = token.split("id=", 1)[1]
        return part.split("&", 1)[0]
    return token

def download_model_from_drive(file_id_or_url: str, output_path: Path):
    """
    如果本地文件不存在，则从 Google Drive 下载。
    需要 file_id 或完整 Drive 链接。
    """
    if output_path.exists():
        print(f"  ✅ Model found locally: {output_path.name}")
        return

    file_id = _extract_drive_id(file_id_or_url)
    if not file_id:
        print(f"  ❌ Missing Drive file id for {output_path.name}")
        return

    print(f"  ⬇️ Downloading {output_path.name} from Google Drive...")
    
    try:
        # 使用 gdown 下载
        url = f'https://drive.google.com/uc?id={file_id}'
        gdown.download(url, str(output_path), quiet=False)
        
        if output_path.exists():
            print(f"  ✅ Download success: {output_path.name}")
        else:
            print(f"  ❌ Download failed: {output_path.name} not found after download.")
            
    except Exception as e:
        print(f"  ❌ Download error for {output_path.name}: {e}")
