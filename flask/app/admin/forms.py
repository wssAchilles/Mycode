from flask_wtf import FlaskForm
from wtforms import StringField, BooleanField, SubmitField
from wtforms.validators import DataRequired, Email

class EditUserForm(FlaskForm):
    username = StringField('用户名', validators=[DataRequired()])
    email = StringField('邮箱', validators=[DataRequired(), Email()])
    is_admin = BooleanField('管理员')
    confirmed = BooleanField('已验证')
    submit = SubmitField('保存')
