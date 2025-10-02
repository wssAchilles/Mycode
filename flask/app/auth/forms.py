from flask_wtf import FlaskForm
from flask_wtf.file import FileField, FileAllowed
from wtforms import StringField, PasswordField, BooleanField, SubmitField, TextAreaField
from wtforms.validators import ValidationError, DataRequired, Email, EqualTo, Length
from app.models import User

class LoginForm(FlaskForm):
    """登录表单"""
    username = StringField('用户名', validators=[DataRequired()])
    password = PasswordField('密码', validators=[DataRequired()])
    remember_me = BooleanField('记住我')
    submit = SubmitField('登录')

class RegistrationForm(FlaskForm):
    """注册表单"""
    username = StringField('用户名', validators=[DataRequired(), Length(min=4, max=20)])
    email = StringField('邮箱', validators=[DataRequired(), Email()])
    password = PasswordField('密码', validators=[DataRequired(), Length(min=6)])
    password2 = PasswordField(
        '确认密码', validators=[DataRequired(), EqualTo('password')])
    submit = SubmitField('注册')

    def validate_username(self, username):
        user = User.query.filter_by(username=username.data).first()
        if user is not None:
            raise ValidationError('用户名已存在，请选择其他用户名。')

    def validate_email(self, email):
        user = User.query.filter_by(email=email.data).first()
        if user is not None:
            raise ValidationError('邮箱已被注册，请使用其他邮箱。')

class ResetPasswordRequestForm(FlaskForm):
    """重置密码请求表单"""
    email = StringField('邮箱', validators=[DataRequired(), Email()])
    submit = SubmitField('发送重置邮件')

class ResetPasswordForm(FlaskForm):
    """重置密码表单"""
    password = PasswordField('新密码', validators=[DataRequired(), Length(min=6)])
    password2 = PasswordField(
        '确认密码', validators=[DataRequired(), EqualTo('password')])
    submit = SubmitField('重置密码')

class ChangePasswordForm(FlaskForm):
    """修改密码表单"""
    old_password = PasswordField('当前密码', validators=[DataRequired()])
    password = PasswordField('新密码', validators=[DataRequired(), Length(min=6)])
    password2 = PasswordField(
        '确认新密码', validators=[DataRequired(), EqualTo('password', message='两次输入的密码不一致')])
    submit = SubmitField('修改密码')

class EditProfileForm(FlaskForm):
    """编辑个人资料表单"""
    username = StringField('用户名', validators=[DataRequired(), Length(min=4, max=20)])
    email = StringField('邮箱', validators=[DataRequired(), Email()])
    first_name = StringField('名字', validators=[Length(max=64)])
    last_name = StringField('姓氏', validators=[Length(max=64)])
    bio = TextAreaField('个人简介', validators=[Length(max=500)])
    location = StringField('所在地', validators=[Length(max=64)])
    website = StringField('个人网站', validators=[Length(max=200)])
    avatar = FileField('头像', validators=[
        FileAllowed(['jpg', 'png', 'jpeg', 'gif'], '只支持 JPG, PNG, JPEG, GIF 格式的图片文件！')
    ])
    submit = SubmitField('保存修改')

    def __init__(self, original_username=None, original_email=None, *args, **kwargs):
        super(EditProfileForm, self).__init__(*args, **kwargs)
        self.original_username = original_username or ''
        self.original_email = original_email or ''

    def validate_username(self, username):
        if self.original_username and username.data != self.original_username:
            user = User.query.filter_by(username=username.data).first()
            if user is not None:
                raise ValidationError('用户名已存在，请选择其他用户名。')

    def validate_email(self, email):
        if self.original_email and email.data != self.original_email:
            user = User.query.filter_by(email=email.data).first()
            if user is not None:
                raise ValidationError('邮箱已被注册，请使用其他邮箱。')
