"""V3 多源数据集适配器子包：将异构源统一转换为带严格 action_mask[13] 与零 PIT 泄漏的 Parquet 样本。"""

from src.data.adapters.kuairec_adapter import convert_kuairec_to_v3_records
from src.data.adapters.kuairand_adapter import convert_kuairand_to_v3_records
from src.data.adapters.microlens_adapter import convert_microlens_to_v3_records
from src.data.adapters.mind_adapter import convert_mind_to_v3_records
from src.data.adapters.prod_pit_adapter import load_prod_pit_v3_records

__all__ = [
    "convert_kuairec_to_v3_records",
    "convert_kuairand_to_v3_records",
    "convert_microlens_to_v3_records",
    "convert_mind_to_v3_records",
    "load_prod_pit_v3_records",
]
