from flask_wtf import FlaskForm
from flask_wtf.file import FileField, FileAllowed
from wtforms import StringField, TextAreaField, BooleanField, SubmitField, SelectField
from wtforms.validators import DataRequired, Length
from app.models import Category

class PostForm(FlaskForm):
    """文章表单"""
    title = StringField('标题', validators=[DataRequired(), Length(max=200)])
    summary = TextAreaField('摘要', validators=[Length(max=500)])
    content = TextAreaField('内容')
    slug = StringField('URL别名', validators=[Length(max=200)])
    keywords = StringField('SEO关键词', validators=[Length(max=200)])
    status = SelectField('状态', choices=[
        ('draft', '草稿'), 
        ('published', '已发布'), 
        ('archived', '已归档')
    ], default='draft')
    featured = BooleanField('特色文章')
    featured_image = FileField('特色图片', validators=[
        FileAllowed(['jpg', 'png', 'gif', 'jpeg'], '只允许图片文件')
    ])
    category = SelectField('分类', coerce=int, validate_choice=False)
    tags = StringField('标签', validators=[Length(max=200)])
    published = BooleanField('发布')
    submit = SubmitField('保存')
    
    def __init__(self, *args, **kwargs):
        super(PostForm, self).__init__(*args, **kwargs)
        try:
            # 安全地查询分类，避免在应用上下文外执行
            from flask import has_app_context
            if has_app_context():
                categories = Category.query.order_by(Category.name).all()
                self.category.choices = [(0, '选择分类')] + [
                    (c.id, c.name) for c in categories
                ]
            else:
                self.category.choices = [(0, '选择分类')]
        except Exception:
            self.category.choices = [(0, '选择分类')]

class CommentForm(FlaskForm):
    """评论表单"""
    content = TextAreaField('评论内容', validators=[
        DataRequired(), Length(min=1, max=500)
    ])
    submit = SubmitField('发表评论')

class CategoryForm(FlaskForm):
    """分类表单"""
    name = StringField('分类名称', validators=[DataRequired(), Length(max=64)])
    description = TextAreaField('描述', validators=[Length(max=500)])
    submit = SubmitField('保存')

class TagForm(FlaskForm):
    """标签表单"""
    name = StringField('标签名称', validators=[DataRequired(), Length(max=64)])
    color = StringField('颜色', validators=[Length(max=7)], default='#007bff')
    submit = SubmitField('保存')
