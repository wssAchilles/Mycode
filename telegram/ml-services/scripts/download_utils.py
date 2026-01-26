
import os
import gdown
from pathlib import Path

def download_model_from_drive(file_id: str, output_path: Path):
    """
    如果本地文件不存在，则从 Google Drive 下载。
    需要 file_id (从 Drive 分享链接获得)。
    """
    if output_path.exists():
        print(f"  ✅ Model found locally: {output_path.name}")
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
