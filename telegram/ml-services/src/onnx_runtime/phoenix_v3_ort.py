"""Phoenix V3 Student INT8 ONNX Runner：输出真实 13+1 动作概率与 CREAD-30 期望停留秒数。"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Mapping, Optional, Sequence

import numpy as np

from src.contracts.actions import (
    CREAD_NUM_BINS,
    PREDICTED_ACTIONS,
    build_cread_bin_edges_ms,
    cread_probs_to_expected_sec,
)
from src.contracts.sid import SID_NUM_LEVELS
from src.feature_adapters.history_packer import pack_columnar_history_sequence, stable_id_hash_u64
from src.feature_adapters.sid_wire_adapter import batch_wire_to_model_sids

_FIELD_BY_SNAKE_ACTION: Mapping[str, str] = {
    "click": "click",
    "like": "like",
    "reply": "reply",
    "repost": "repost",
    "quote": "quote",
    "share": "share",
    "dwell": "dwell",
    "video_view": "videoView",
    "follow_author": "followAuthor",
    "not_interested": "notInterested",
    "block_author": "blockAuthor",
    "mute_author": "muteAuthor",
    "report": "report",
    "video_quality_view": "videoQualityView",
}


def _sigmoid(x: np.ndarray) -> np.ndarray:
    clipped = np.clip(x, -30.0, 30.0)
    return 1.0 / (1.0 + np.exp(-clipped))


def _softmax(logits: np.ndarray, axis: int = -1) -> np.ndarray:
    shifted = logits - np.max(logits, axis=axis, keepdims=True)
    exp = np.exp(shifted)
    return exp / (np.sum(exp, axis=axis, keepdims=True) + 1e-12)


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def apply_platt_calibration(action: str, raw_prob: float, calibrator: Optional[Mapping[str, Any]]) -> float:
    """对真实预测头概率施加 Platt 校准；未命中有效校准配置时原样安全夹紧返回。"""
    p = _clamp01(raw_prob)
    if not isinstance(calibrator, Mapping):
        return p
    actions = calibrator.get("actions")
    if not isinstance(actions, Mapping):
        return p
    cfg = actions.get(action)
    if not isinstance(cfg, Mapping) or int(cfg.get("count", 0) or 0) <= 0:
        return p
    scale = float(cfg.get("scale", 1.0))
    bias = float(cfg.get("bias", 0.0))
    clipped = max(1e-5, min(1.0 - 1e-5, p))
    logit = math.log(clipped / (1.0 - clipped))
    return _clamp01(1.0 / (1.0 + math.exp(-(scale * logit + bias))))


class PhoenixV3OrtRunner:
    """纯 ONNX Runtime 推理 Phoenix V3 Student，彻底移除 6 个启发式伪造头。"""

    def __init__(
        self,
        session_pool: Any,
        *,
        session_name: str = "phoenix_v3_student",
        max_history_len: int = 128,
        max_candidates_per_batch: int = 64,
        cread_edges_ms: Optional[Sequence[float]] = None,
        calibrator: Optional[Mapping[str, Any]] = None,
    ) -> None:
        self._pool = session_pool
        self._session_name = session_name
        self._max_history_len = max(1, int(max_history_len))
        self._max_candidates_per_batch = max(1, int(max_candidates_per_batch))
        self._cread_edges_ms = list(cread_edges_ms) if cread_edges_ms else build_cread_bin_edges_ms()
        self._calibrator = calibrator

    @property
    def is_ready(self) -> bool:
        return self._pool.get(self._session_name) is not None

    def set_calibrator(self, calibrator: Optional[Mapping[str, Any]]) -> None:
        self._calibrator = calibrator

    def predict(
        self,
        *,
        candidates: Sequence[Mapping[str, Any]],
        columnar_sequence: Optional[Sequence[Mapping[str, Any]]] = None,
        legacy_actions: Optional[Sequence[Mapping[str, Any]]] = None,
    ) -> List[Dict[str, Any]]:
        """执行分块推理，输出真实多头概率 + CREAD-30 expectedDwellSec + dwellProbs。"""
        if not candidates:
            return []

        packed = pack_columnar_history_sequence(
            columnar_sequence=columnar_sequence,
            legacy_actions=legacy_actions,
            max_seq_len=self._max_history_len,
        )

        results: List[Dict[str, Any]] = []
        for start in range(0, len(candidates), self._max_candidates_per_batch):
            chunk = candidates[start : start + self._max_candidates_per_batch]
            c_len = len(chunk)

            cand_post_hashes = np.asarray(
                [[stable_id_hash_u64(c.get("postId")) for c in chunk]],
                dtype=np.int64,
            )
            cand_author_hashes = np.asarray(
                [[stable_id_hash_u64(c.get("authorId")) for c in chunk]],
                dtype=np.int64,
            )
            cand_in_net = np.asarray(
                [[1 if bool(c.get("inNetwork", False)) else 0 for c in chunk]],
                dtype=np.int64,
            )
            cand_has_vid = np.asarray(
                [[1 if bool(c.get("hasVideo", False)) else 0 for c in chunk]],
                dtype=np.int64,
            )
            # 推理期 PAL 位置特征强制置 0 以消除训练展示位偏差
            cand_served_pos = np.zeros((1, c_len), dtype=np.int64)
            cand_mask = np.ones((1, c_len), dtype=np.int64)
            raw_sids = [c.get("semanticIds") for c in chunk]
            cand_sids = batch_wire_to_model_sids(raw_sids).astype(np.int64).reshape(1, c_len, SID_NUM_LEVELS)

            feeds = {
                "history_post_hashes": packed.post_hashes,
                "history_author_hashes": packed.author_hashes,
                "history_action_types": packed.action_types,
                "history_time_buckets": packed.time_buckets,
                "history_sids": packed.history_sids,
                "history_action_masks": packed.action_masks.astype(np.float32),
                "history_mask": packed.attention_mask,
                "cand_post_hashes": cand_post_hashes,
                "cand_author_hashes": cand_author_hashes,
                "cand_sids": cand_sids,
                "cand_in_network": cand_in_net,
                "cand_has_video": cand_has_vid,
                "cand_served_position": cand_served_pos,
                "cand_mask": cand_mask,
            }

            outputs = self._pool.run(self._session_name, feeds)
            # 约定 ONNX 输出张量：
            # out[0]: action_logits shape=(1, C, 13 或 14)
            # out[1] (可选): cread_logits shape=(1, C, 30)
            action_logits = np.asarray(outputs[0], dtype=np.float32)
            if action_logits.ndim == 2:
                action_logits = action_logits[np.newaxis, :, :]
            action_probs = _sigmoid(action_logits)[0]  # (C, num_heads)

            cread_probs: Optional[np.ndarray] = None
            if len(outputs) >= 2:
                cread_raw = np.asarray(outputs[1], dtype=np.float32)
                if cread_raw.ndim == 2:
                    cread_raw = cread_raw[np.newaxis, :, :]
                if cread_raw.shape[-1] == CREAD_NUM_BINS:
                    cread_probs = _softmax(cread_raw, axis=-1)[0]  # (C, 30)

            num_heads = int(action_probs.shape[1])
            for idx, cand in enumerate(chunk):
                row_probs = action_probs[idx]
                item: Dict[str, Any] = {"postId": str(cand.get("postId") or "")}

                for head_idx, action_name in enumerate(PREDICTED_ACTIONS):
                    raw_val = float(row_probs[head_idx]) if head_idx < num_heads else 0.0
                    cal_val = apply_platt_calibration(action_name, raw_val, self._calibrator)
                    item[_FIELD_BY_SNAKE_ACTION[action_name]] = cal_val

                # 第 14 路真头：若导出图包含第 14 列直接读取校准，否则严格置 0.0（禁止用 click 伪造）
                vqv_idx = len(PREDICTED_ACTIONS)
                if num_heads > vqv_idx:
                    vqv_prob = apply_platt_calibration("video_quality_view", float(row_probs[vqv_idx]), self._calibrator)
                else:
                    vqv_prob = 0.0
                item["videoQualityView"] = vqv_prob

                # 兼容别名与 CREAD-30 期望停留还原
                item["dismiss"] = item["notInterested"]
                item["block"] = item["blockAuthor"]
                if cread_probs is not None:
                    probs_list = [float(x) for x in cread_probs[idx].tolist()]
                    exp_sec = cread_probs_to_expected_sec(probs_list, self._cread_edges_ms)
                    item["expectedDwellSec"] = round(float(exp_sec), 4)
                    item["dwellTime"] = _clamp01(float(exp_sec) / 60.0)
                    item["dwellProbs"] = probs_list
                else:
                    item["expectedDwellSec"] = round(float(item["dwell"]) * 15.0, 4)
                    item["dwellTime"] = item["dwell"]

                results.append(item)

        return results
