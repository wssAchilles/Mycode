"""V3 模型体系契约接口定义（Phase 28B/C 实现 PyTorch 训练主体并导出 ONNX INT8）。"""

from src.models.interfaces import V3PhoenixSpec, V3RQVaeSpec, V3TwoTowerSpec

__all__ = [
    "V3PhoenixSpec",
    "V3RQVaeSpec",
    "V3TwoTowerSpec",
]
