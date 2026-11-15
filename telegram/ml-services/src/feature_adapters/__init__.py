"""V3 特征张量适配器：6x256 SID Wire<->Model 转换与列式历史行为打包。"""

from src.feature_adapters.history_packer import (
    PackedHistoryBatch,
    pack_columnar_history_sequence,
    stable_id_hash_u64,
)
from src.feature_adapters.sid_wire_adapter import (
    batch_model_to_wire_sids,
    batch_pack_wire_sids_u64,
    batch_wire_to_model_sids,
)

__all__ = [
    "PackedHistoryBatch",
    "batch_model_to_wire_sids",
    "batch_pack_wire_sids_u64",
    "batch_wire_to_model_sids",
    "pack_columnar_history_sequence",
    "stable_id_hash_u64",
]
