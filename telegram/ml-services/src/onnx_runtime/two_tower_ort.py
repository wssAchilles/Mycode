"""Two-Tower V3 用户编码 ONNX Runner 与 FAISS HNSW-SQ8 召回执行器。"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Sequence

import numpy as np

from src.feature_adapters.history_packer import PackedHistoryBatch, pack_columnar_history_sequence


class TwoTowerOrtRunner:
    """基于纯 ONNX Runtime 执行 Two-Tower V3 用户无 ID 序列编码并查 FAISS 召回。"""

    def __init__(
        self,
        session_pool: Any,
        *,
        session_name: str = "two_tower_user",
        max_history_len: int = 128,
        embedding_dim: int = 256,
    ) -> None:
        self._pool = session_pool
        self._session_name = session_name
        self._max_history_len = int(max_history_len)
        self._embedding_dim = int(embedding_dim)

    @property
    def is_ready(self) -> bool:
        return self._pool.get(self._session_name) is not None

    def encode_user_embeddings(self, packed: PackedHistoryBatch) -> np.ndarray:
        """运行无 ID 用户塔 ONNX 图并返回 L2 归一化的用户表达向量（单向量或 MoL K 向量展开）。"""
        feeds = {
            "history_post_hashes": packed.post_hashes,
            "history_author_hashes": packed.author_hashes,
            "history_action_types": packed.action_types,
            "history_time_buckets": packed.time_buckets,
            "history_sids": packed.history_sids,
            "history_action_masks": packed.action_masks.astype(np.float32),
            "attention_mask": packed.attention_mask,
        }
        outputs = self._pool.run(self._session_name, feeds)
        user_vecs = np.asarray(outputs[0], dtype=np.float32)
        if user_vecs.ndim == 1:
            user_vecs = user_vecs.reshape(1, -1)
        elif user_vecs.ndim == 3:
            # 支持 MoL (B, K, D) 输出展开后进行多头检索再合并得分
            user_vecs = user_vecs.reshape(-1, user_vecs.shape[-1])
        norms = np.linalg.norm(user_vecs, axis=1, keepdims=True) + 1e-12
        return user_vecs / norms

    def retrieve(
        self,
        *,
        faiss_index: Any,
        idx_to_post_id: Mapping[int, str],
        columnar_sequence: Optional[Sequence[Mapping[str, Any]]] = None,
        legacy_actions: Optional[Sequence[Mapping[str, Any]]] = None,
        top_k: int = 100,
    ) -> List[Dict[str, Any]]:
        """执行从用户序列打包 -> ONNX 编码 -> FAISS IP/HNSW-SQ8 召回的全链路。"""
        if faiss_index is None:
            raise RuntimeError("FAISS index not loaded")
        packed = pack_columnar_history_sequence(
            columnar_sequence=columnar_sequence,
            legacy_actions=legacy_actions,
            max_seq_len=self._max_history_len,
        )
        user_vecs = self.encode_user_embeddings(packed)
        k = max(1, int(top_k))
        distances, indices = faiss_index.search(user_vecs, k)

        best_by_post: Dict[str, float] = {}
        for head_idx in range(distances.shape[0]):
            for raw_score, raw_idx in zip(distances[head_idx].tolist(), indices[head_idx].tolist()):
                if int(raw_idx) < 0:
                    continue
                post_id = str(idx_to_post_id.get(int(raw_idx), "")).strip()
                if not post_id or post_id in ("<PAD>", "<UNK>"):
                    continue
                score = float(raw_score)
                if post_id not in best_by_post or score > best_by_post[post_id]:
                    best_by_post[post_id] = score

        ranked = sorted(best_by_post.items(), key=lambda kv: kv[1], reverse=True)[:k]
        return [{"postId": pid, "score": float(sc)} for pid, sc in ranked]
