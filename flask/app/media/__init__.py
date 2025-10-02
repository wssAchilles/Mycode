from flask import Blueprint

bp = Blueprint('media', __name__, url_prefix='/media')

from app.media import routes
