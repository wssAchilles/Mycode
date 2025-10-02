import os
import uuid
import mimetypes
from PIL import Image, ImageOps
from werkzeug.utils import secure_filename
from flask import current_app, url_for
import subprocess
import json
from datetime import datetime

class MediaFileProcessor:
    """媒体文件处理器"""
    
    # 支持的文件类型
    ALLOWED_EXTENSIONS = {
        'image': ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'],
        'video': ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm'],
        'audio': ['mp3', 'wav', 'ogg', 'aac', 'flac'],
        'document': ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'zip', 'rar']
    }
    
    # 文件大小限制（字节）
    MAX_FILE_SIZE = {
        'image': 10 * 1024 * 1024,      # 10MB
        'video': 100 * 1024 * 1024,     # 100MB
        'audio': 50 * 1024 * 1024,      # 50MB
        'document': 20 * 1024 * 1024    # 20MB
    }
    
    @classmethod
    def get_file_type(cls, filename):
        """根据文件名获取文件类型"""
        ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
        for file_type, extensions in cls.ALLOWED_EXTENSIONS.items():
            if ext in extensions:
                return file_type
        return 'unknown'
    
    @classmethod
    def is_allowed_file(cls, filename):
        """检查文件是否被允许"""
        return cls.get_file_type(filename) != 'unknown'
    
    @classmethod
    def get_upload_path(cls, file_type):
        """获取上传路径"""
        base_path = os.path.join(current_app.static_folder, 'uploads', 'media')
        
        # 按年月分文件夹
        now = datetime.now()
        date_path = now.strftime('%Y/%m')
        
        upload_path = os.path.join(base_path, file_type, date_path)
        os.makedirs(upload_path, exist_ok=True)
        
        return upload_path
    
    @classmethod
    def generate_unique_filename(cls, original_filename):
        """生成唯一文件名"""
        name, ext = os.path.splitext(secure_filename(original_filename))
        unique_id = uuid.uuid4().hex
        return f"{unique_id}{ext}"
    
    @classmethod
    def save_file(cls, file, folder_id=None):
        """保存文件并返回媒体文件信息"""
        if not file or not file.filename:
            raise ValueError("无效的文件")
        
        original_filename = file.filename
        file_type = cls.get_file_type(original_filename)
        
        if file_type == 'unknown':
            raise ValueError(f"不支持的文件类型: {original_filename}")
        
        # 检查文件大小
        file.seek(0, 2)  # 移动到文件末尾
        file_size = file.tell()
        file.seek(0)  # 重置到文件开头
        
        if file_size > cls.MAX_FILE_SIZE.get(file_type, 10 * 1024 * 1024):
            max_size_mb = cls.MAX_FILE_SIZE.get(file_type, 10 * 1024 * 1024) // (1024 * 1024)
            raise ValueError(f"文件太大，最大允许 {max_size_mb}MB")
        
        # 生成存储路径和文件名
        upload_path = cls.get_upload_path(file_type)
        stored_filename = cls.generate_unique_filename(original_filename)
        file_path = os.path.join(upload_path, stored_filename)
        
        # 保存文件
        file.save(file_path)
        
        # 获取相对路径和URL
        relative_path = os.path.relpath(file_path, current_app.static_folder)
        file_url = url_for('static', filename=relative_path.replace('\\', '/'))
        
        # 获取文件信息
        mime_type, _ = mimetypes.guess_type(file_path)
        if not mime_type:
            mime_type = 'application/octet-stream'
        
        file_info = {
            'filename': original_filename,
            'stored_filename': stored_filename,
            'file_path': relative_path,
            'file_url': file_url,
            'file_type': file_type,
            'mime_type': mime_type,
            'file_size': file_size,
            'dimensions': None,
            'duration': None
        }
        
        # 处理不同类型的文件
        if file_type == 'image':
            file_info.update(cls.process_image(file_path))
        elif file_type == 'video':
            file_info.update(cls.process_video(file_path))
        elif file_type == 'audio':
            file_info.update(cls.process_audio(file_path))
        
        return file_info
    
    @classmethod
    def process_image(cls, file_path):
        """处理图片文件"""
        try:
            with Image.open(file_path) as img:
                # 获取尺寸
                width, height = img.size
                dimensions = f"{width},{height}"
                
                # 生成缩略图
                cls.generate_thumbnail(file_path, img)
                
                return {
                    'dimensions': dimensions
                }
        except Exception as e:
            current_app.logger.error(f"处理图片失败: {e}")
            return {}
    
    @classmethod
    def generate_thumbnail(cls, file_path, img=None):
        """生成缩略图"""
        try:
            if img is None:
                img = Image.open(file_path)
            
            # 创建缩略图目录
            thumbnail_dir = os.path.join(os.path.dirname(file_path), 'thumbnails')
            os.makedirs(thumbnail_dir, exist_ok=True)
            
            # 生成不同尺寸的缩略图
            sizes = [(150, 150), (300, 300), (600, 600)]
            
            for size in sizes:
                # 保持宽高比的缩略图
                thumbnail = ImageOps.fit(img, size, Image.Resampling.LANCZOS)
                
                # 保存缩略图
                filename = os.path.basename(file_path)
                name, ext = os.path.splitext(filename)
                thumbnail_name = f"{name}_{size[0]}x{size[1]}{ext}"
                thumbnail_path = os.path.join(thumbnail_dir, thumbnail_name)
                
                thumbnail.save(thumbnail_path, optimize=True, quality=85)
                
        except Exception as e:
            current_app.logger.error(f"生成缩略图失败: {e}")
    
    @classmethod
    def process_video(cls, file_path):
        """处理视频文件"""
        try:
            # 使用ffprobe获取视频信息
            cmd = [
                'ffprobe', '-v', 'quiet', '-print_format', 'json',
                '-show_format', '-show_streams', file_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                info = json.loads(result.stdout)
                
                # 获取视频流信息
                video_stream = next((s for s in info['streams'] if s['codec_type'] == 'video'), None)
                
                if video_stream:
                    width = video_stream.get('width')
                    height = video_stream.get('height')
                    dimensions = f"{width},{height}" if width and height else None
                    
                    # 获取时长
                    duration = float(info['format'].get('duration', 0))
                    
                    # 生成视频缩略图
                    cls.generate_video_thumbnail(file_path)
                    
                    return {
                        'dimensions': dimensions,
                        'duration': int(duration)
                    }
            
        except Exception as e:
            current_app.logger.error(f"处理视频失败: {e}")
        
        return {}
    
    @classmethod
    def generate_video_thumbnail(cls, file_path):
        """生成视频缩略图"""
        try:
            # 创建缩略图目录
            thumbnail_dir = os.path.join(os.path.dirname(file_path), 'thumbnails')
            os.makedirs(thumbnail_dir, exist_ok=True)
            
            # 生成缩略图文件名
            filename = os.path.basename(file_path)
            name, _ = os.path.splitext(filename)
            thumbnail_name = f"{name}_thumbnail.jpg"
            thumbnail_path = os.path.join(thumbnail_dir, thumbnail_name)
            
            # 使用ffmpeg生成缩略图（视频中间帧）
            cmd = [
                'ffmpeg', '-i', file_path, '-ss', '00:00:01.000',
                '-vframes', '1', '-f', 'image2', '-y', thumbnail_path
            ]
            
            subprocess.run(cmd, capture_output=True, timeout=30)
            
        except Exception as e:
            current_app.logger.error(f"生成视频缩略图失败: {e}")
    
    @classmethod
    def process_audio(cls, file_path):
        """处理音频文件"""
        try:
            # 使用ffprobe获取音频信息
            cmd = [
                'ffprobe', '-v', 'quiet', '-print_format', 'json',
                '-show_format', file_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                info = json.loads(result.stdout)
                
                # 获取时长
                duration = float(info['format'].get('duration', 0))
                
                return {
                    'duration': int(duration)
                }
            
        except Exception as e:
            current_app.logger.error(f"处理音频失败: {e}")
        
        return {}
    
    @classmethod
    def delete_file(cls, media_file):
        """删除文件及其相关资源"""
        try:
            # 删除主文件
            file_path = os.path.join(current_app.static_folder, media_file.file_path)
            if os.path.exists(file_path):
                os.remove(file_path)
            
            # 删除缩略图
            if media_file.is_image or media_file.is_video:
                thumbnail_dir = os.path.join(os.path.dirname(file_path), 'thumbnails')
                if os.path.exists(thumbnail_dir):
                    filename = os.path.basename(file_path)
                    name, ext = os.path.splitext(filename)
                    
                    # 删除图片缩略图
                    if media_file.is_image:
                        sizes = [(150, 150), (300, 300), (600, 600)]
                        for size in sizes:
                            thumbnail_name = f"{name}_{size[0]}x{size[1]}{ext}"
                            thumbnail_path = os.path.join(thumbnail_dir, thumbnail_name)
                            if os.path.exists(thumbnail_path):
                                os.remove(thumbnail_path)
                    
                    # 删除视频缩略图
                    elif media_file.is_video:
                        thumbnail_name = f"{name}_thumbnail.jpg"
                        thumbnail_path = os.path.join(thumbnail_dir, thumbnail_name)
                        if os.path.exists(thumbnail_path):
                            os.remove(thumbnail_path)
            
            return True
            
        except Exception as e:
            current_app.logger.error(f"删除文件失败: {e}")
            return False
    
    @classmethod
    def get_thumbnail_url(cls, media_file, size='300x300'):
        """获取缩略图URL"""
        if not media_file.is_image:
            return media_file.thumbnail_url
        
        try:
            # 构建缩略图路径
            file_dir = os.path.dirname(media_file.file_path)
            filename = os.path.basename(media_file.file_path)
            name, ext = os.path.splitext(filename)
            
            thumbnail_path = os.path.join(file_dir, 'thumbnails', f"{name}_{size}{ext}")
            thumbnail_full_path = os.path.join(current_app.static_folder, thumbnail_path)
            
            if os.path.exists(thumbnail_full_path):
                return url_for('static', filename=thumbnail_path.replace('\\', '/'))
            else:
                # 如果缩略图不存在，返回原图
                return media_file.file_url
                
        except Exception:
            return media_file.file_url
