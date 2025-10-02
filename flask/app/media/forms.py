from flask_wtf import FlaskForm
from flask_wtf.file import FileField, FileAllowed, FileRequired
from wtforms import StringField, TextAreaField, SelectField, BooleanField, HiddenField
from wtforms.validators import DataRequired, Length, Optional
from flask import current_app

class MediaUploadForm(FlaskForm):
    """媒体文件上传表单"""
    # 将 MultipleFileField 替换为 FileField
    files = FileField('文件', validators=[
        FileRequired('请选择要上传的文件'),
        FileAllowed(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg',   # 图片
                     'mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm',   # 视频
                     'mp3', 'wav', 'ogg', 'aac', 'flac',                 # 音频
                     'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', # 文档
                     'txt', 'md', 'zip', 'rar'], '不支持的文件类型')
    ])
    folder_id = SelectField('上传到文件夹', coerce=int, validators=[Optional()])
    description = TextAreaField('描述', validators=[Optional(), Length(max=500)])
    tags = StringField('标签', validators=[Optional(), Length(max=500)],
                       render_kw={'placeholder': '多个标签用逗号分隔'})
    is_public = BooleanField('公开可见', default=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # 动态加载文件夹选项
        from app.models import MediaFolder
        folders = MediaFolder.query.filter_by(is_active=True).all()
        self.folder_id.choices = [(0, '根目录')] + [(f.id, f.full_path) for f in folders]


class MediaEditForm(FlaskForm):
    """媒体文件编辑表单"""
    filename = StringField('文件名', validators=[DataRequired(), Length(max=255)])
    description = TextAreaField('描述', validators=[Optional(), Length(max=500)])
    alt_text = StringField('替代文本', validators=[Optional(), Length(max=255)],
                           render_kw={'placeholder': '为屏幕阅读器提供的图片描述'})
    tags = StringField('标签', validators=[Optional(), Length(max=500)],
                       render_kw={'placeholder': '多个标签用逗号分隔'})
    is_public = BooleanField('公开可见')
    is_active = BooleanField('启用状态')


class MediaFolderForm(FlaskForm):
    """媒体文件夹表单"""
    name = StringField('文件夹名称', validators=[DataRequired(), Length(max=100)])
    description = TextAreaField('描述', validators=[Optional(), Length(max=500)])
    parent_id = SelectField('父文件夹', coerce=int, validators=[Optional()])

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # 动态加载父文件夹选项
        from app.models import MediaFolder
        folders = MediaFolder.query.filter_by(is_active=True).all()
        self.parent_id.choices = [(0, '根目录')] + [(f.id, f.full_path) for f in folders]


class MediaSearchForm(FlaskForm):
    """媒体文件搜索表单"""
    keyword = StringField('关键词', validators=[Optional()],
                          render_kw={'placeholder': '搜索文件名、描述、标签...'})
    file_type = SelectField('文件类型', choices=[
        ('', '所有类型'),
        ('image', '图片'),
        ('video', '视频'),
        ('audio', '音频'),
        ('document', '文档')
    ], validators=[Optional()])
    folder_id = SelectField('文件夹', coerce=int, validators=[Optional()])
    uploader = SelectField('上传者', coerce=int, validators=[Optional()])
    is_public = SelectField('可见性', choices=[
        ('', '全部'),
        ('1', '公开'),
        ('0', '私有')
    ], validators=[Optional()])
    sort_by = SelectField('排序方式', choices=[
        ('uploaded_at_desc', '上传时间（新到旧）'),
        ('uploaded_at_asc', '上传时间（旧到新）'),
        ('filename_asc', '文件名（A-Z）'),
        ('filename_desc', '文件名（Z-A）'),
        ('file_size_desc', '文件大小（大到小）'),
        ('file_size_asc', '文件大小（小到大）'),
        ('download_count_desc', '下载次数（多到少）')
    ], default='uploaded_at_desc')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # 动态加载文件夹和用户选项
        from app.models import MediaFolder, User

        folders = MediaFolder.query.filter_by(is_active=True).all()
        self.folder_id.choices = [(0, '所有文件夹')] + [(f.id, f.full_path) for f in folders]

        users = User.query.filter_by(confirmed=True).all()
        self.uploader.choices = [(0, '所有用户')] + [(u.id, u.username) for u in users]


class MediaBatchOperationForm(FlaskForm):
    """媒体文件批量操作表单"""
    media_ids = HiddenField('媒体文件ID', validators=[DataRequired()])
    operation = SelectField('操作', choices=[
        ('delete', '删除选中文件'),
        ('move', '移动到文件夹'),
        ('set_public', '设为公开'),
        ('set_private', '设为私有'),
        ('add_tags', '添加标签'),
        ('remove_tags', '移除标签')
    ], validators=[DataRequired()])
    target_folder_id = SelectField('目标文件夹', coerce=int, validators=[Optional()])
    tags_to_add = StringField('要添加的标签', validators=[Optional()],
                              render_kw={'placeholder': '多个标签用逗号分隔'})
    tags_to_remove = StringField('要移除的标签', validators=[Optional()],
                                 render_kw={'placeholder': '多个标签用逗号分隔'})

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # 动态加载文件夹选项
        from app.models import MediaFolder
        folders = MediaFolder.query.filter_by(is_active=True).all()
        self.target_folder_id.choices = [(0, '根目录')] + [(f.id, f.full_path) for f in folders]