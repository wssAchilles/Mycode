"""
机器学习模型实验平台 - Firebase Cloud Functions 后端入口
"""

from firebase_functions import https_fn, options, params
from firebase_admin import initialize_app

# 初始化 Firebase Admin (一次性)
initialize_app()

# 定义 Secret 参数
GOOGLE_API_KEY = params.SecretParam("GOOGLE_API_KEY")

@https_fn.on_call(
    cors=options.CorsOptions(
        cors_origins="*",
        cors_methods=["POST"],
    ),
    max_instances=10,
    memory=options.MemoryOption.GB_4,
    timeout_sec=900  # 15 分钟超时，支持更大数据集
)
def train_ml_model(req: https_fn.CallableRequest) -> any:
    """机器学习模型训练API (Callable)"""
    from api.ml_handlers import handle_train_model
    return handle_train_model(req)

@https_fn.on_call(
    cors=options.CorsOptions(
        cors_origins="*",
        cors_methods=["POST"],
    )
)
def get_experiment_history(req: https_fn.CallableRequest) -> any:
    """获取用户的实验历史记录 (Callable)"""
    from api.ml_handlers import handle_get_history
    return handle_get_history(req)

@https_fn.on_call(
    cors=options.CorsOptions(
        cors_origins="*",
        cors_methods=["POST"],
    ),
    max_instances=10,
    memory=options.MemoryOption.GB_1,
    timeout_sec=120,
    secrets=[GOOGLE_API_KEY]
)
def mcp_chat_assistant(req: https_fn.CallableRequest) -> any:
    """MCP 聊天助手 API (Callable)"""
    from api.mcp_handlers import handle_mcp_chat
    # 从 Secret 获取 API Key
    api_key = GOOGLE_API_KEY.value.strip() if GOOGLE_API_KEY.value else None
    return handle_mcp_chat(req, api_key)
