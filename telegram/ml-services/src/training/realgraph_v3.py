"""RealGraph V3 无泄漏 16 维 PIT GBT、局部 PageRank `authorCredScore` 与 `SnapshotSafeguard` 守护器。

关键架构修复：
- V2 中 `dwellTimeMs` 属于当前目标产生后的结果泄漏特征；V3 严格将其物理踢除并锁定为 16 维纯 PIT 先验特征；
- 强制校验特征表禁止含 `dwellTimeMs`；引入因果图局部 PageRank 计算作者声誉度 `authorCredScore`；
- 通过 `SnapshotSafeguard` 校验非退化分布、AUC 门槛与原子化落盘后再覆盖旧快照。
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import log_loss, roc_auc_score

# 严格 16 维纯 PIT 历史/静态特征（严禁出现 dwellTimeMs 等目标后泄漏列）
REALGRAPH_V3_FEATURES: Tuple[str, ...] = (
    "followScore",
    "histAuthorLikeCount",
    "histAuthorReplyCount",
    "histAuthorRepostCount",
    "histAuthorClickCount",
    "histAuthorShareCount",
    "histAuthorNegCount",
    "histAuthorTotalInteractions",
    "histAuthorAffinityRatio",
    "histAuthorRecencyScore",
    "histTotalLenLog",
    "histUserPosRate",
    "histUserNegRate",
    "sidPrefix2OverlapCount",
    "authorPageRankCredScore",
    "isVideoPost",
)

FORBIDDEN_LEAKAGE_FEATURES = frozenset({"dwellTimeMs", "dwell_ms", "action_labels", "served_position"})


def _serialize_tree(tree_obj: Any) -> List[Dict[str, Any]]:
    tree_ = tree_obj.tree_
    nodes: List[Dict[str, Any]] = []
    for idx in range(tree_.node_count):
        left = int(tree_.children_left[idx])
        right = int(tree_.children_right[idx])
        is_leaf = left == right
        nodes.append(
            {
                "nodeId": idx,
                "isLeaf": is_leaf,
                "featureIndex": None if is_leaf else int(tree_.feature[idx]),
                "threshold": None if is_leaf else round(float(tree_.threshold[idx]), 8),
                "leftChild": None if is_leaf else left,
                "rightChild": None if is_leaf else right,
                "value": round(float(tree_.value[idx][0][0]), 8),
            }
        )
    return nodes


def compute_local_pagerank_author_cred(
    samples: Sequence[Mapping[str, Any]],
    *,
    damping: float = 0.85,
    iters: int = 30,
) -> Dict[str, float]:
    """基于每条样本的因果历史交互 (`history_author_hashes`) 构造作者加权共现图并跑局部 PageRank。"""
    # 只消耗 history_* 历史交互边（正向动作加边权重，负向扣减/阻断），彻底避免使用目标行未来标签
    pos_acts = {1, 2, 3, 4, 5, 6, 8, 9, 10}
    user_to_authors: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    author_set: set[str] = set()

    for row in samples:
        uid = str(row.get("user_hash_id") or row.get("userId") or "")
        cand_a = str(row.get("candidate_author_hash") or "")
        if cand_a:
            author_set.add(cand_a)
        h_auths = row.get("history_author_hashes") or []
        h_acts = row.get("history_action_types") or []
        for idx, raw_aid in enumerate(h_auths):
            aid = str(raw_aid or "")
            if not aid:
                continue
            author_set.add(aid)
            act = int(h_acts[idx]) if idx < len(h_acts) else 1
            if act in pos_acts and uid:
                user_to_authors[uid][aid] += 1.0

    authors = sorted(author_set)
    n_auth = len(authors)
    if n_auth == 0:
        return {}
    if n_auth == 1:
        return {authors[0]: 1.0}

    a_idx = {a: i for i, a in enumerate(authors)}
    # 构建用户中继后的 Author->Author 共享受众转移矩阵 W[src, dst]
    trans = np.zeros((n_auth, n_auth), dtype=np.float64)
    in_deg = np.zeros(n_auth, dtype=np.float64)

    for _, auth_weights in user_to_authors.items():
        items = list(auth_weights.items())
        for aid, w in items:
            in_deg[a_idx[aid]] += w
        if len(items) < 2:
            continue
        for a1, w1 in items:
            for a2, w2 in items:
                if a1 != a2:
                    trans[a_idx[a1], a_idx[a2]] += min(w1, w2)

    row_sums = trans.sum(axis=1, keepdims=True)
    # 阻尼悬挂节点采用历史交互度数比例作个性化重置向量，避免冷启动归零
    deg_sum = float(in_deg.sum())
    personalize = (in_deg / deg_sum) if deg_sum > 0.0 else np.full(n_auth, 1.0 / float(n_auth))
    stochastic = np.where(row_sums > 0.0, trans / np.where(row_sums > 0.0, row_sums, 1.0), personalize[None, :])

    rank = personalize.copy()
    for _ in range(max(5, int(iters))):
        rank = (1.0 - damping) * personalize + damping * (rank @ stochastic)

    max_r = float(np.max(rank))
    min_r = float(np.min(rank))
    if max_r - min_r <= 1e-12:
        return {aid: 0.5 for aid in a_idx}
    span = max_r - min_r
    return {aid: round(float((rank[idx] - min_r) / span), 6) for aid, idx in a_idx.items()}


def extract_realgraph_v3_matrix(
    samples: Sequence[Mapping[str, Any]],
    *,
    author_cred_map: Optional[Mapping[str, float]] = None,
    post_sid_wire_map: Optional[Mapping[str, Sequence[int]]] = None,
) -> Tuple[np.ndarray, np.ndarray]:
    """提取无泄漏 16 维 `REALGRAPH_V3_FEATURES` 特征矩阵 `(N, 16)` 与二分类综合互动真值 `y (N,)`。"""
    if len(REALGRAPH_V3_FEATURES) != 16:
        raise AssertionError(f"REALGRAPH_V3_FEATURES must have exact len 16, got {len(REALGRAPH_V3_FEATURES)}")
    if any(bad in REALGRAPH_V3_FEATURES for bad in FORBIDDEN_LEAKAGE_FEATURES):
        raise ValueError("Forbidden leakage column detected in REALGRAPH_V3_FEATURES")

    cred = author_cred_map if author_cred_map is not None else compute_local_pagerank_author_cred(samples)
    pos_acts = {1, 2, 3, 4, 5, 6, 8, 9, 10}
    neg_acts = {12, 13, 14, 15}

    X = np.zeros((len(samples), len(REALGRAPH_V3_FEATURES)), dtype=np.float64)
    y = np.zeros(len(samples), dtype=np.int64)

    for row_idx, row in enumerate(samples):
        cand_author = str(row.get("candidate_author_hash") or "")
        cand_pid = str(row.get("candidate_post_id") or "")
        cand_sid = (
            post_sid_wire_map[cand_pid]
            if post_sid_wire_map is not None and cand_pid in post_sid_wire_map
            else row.get("candidate_sids")
        )
        cand_p2 = (int(cand_sid[0]), int(cand_sid[1])) if cand_sid and len(cand_sid) >= 2 and int(cand_sid[0]) >= 0 else None

        h_auths = list(row.get("history_author_hashes") or [])
        h_acts = list(row.get("history_action_types") or [])
        h_tbs = list(row.get("history_time_buckets") or [])
        h_pids = list(row.get("history_post_ids") or [])
        h_sids = list(row.get("history_sids") or [])

        a_like = a_reply = a_repost = a_click = a_share = a_neg = a_total = 0.0
        min_tb = 15
        user_pos = user_neg = 0.0
        sid_p2_hits = 0.0

        total_len = max(len(h_auths), len(h_acts), len(h_pids))
        for t_i in range(total_len):
            act = int(h_acts[t_i]) if t_i < len(h_acts) else 1
            if act in pos_acts:
                user_pos += 1.0
            elif act in neg_acts:
                user_neg += 1.0

            aid = str(h_auths[t_i]) if t_i < len(h_auths) else ""
            if cand_author and aid == cand_author:
                a_total += 1.0
                if act == 2:
                    a_like += 1.0
                elif act == 3:
                    a_reply += 1.0
                elif act in (4, 5):
                    a_repost += 1.0
                elif act == 1:
                    a_click += 1.0
                elif act == 6:
                    a_share += 1.0
                elif act in neg_acts:
                    a_neg += 1.0
                if t_i < len(h_tbs):
                    min_tb = min(min_tb, max(0, int(h_tbs[t_i])))

            if cand_p2 is not None:
                h_pid = str(h_pids[t_i]) if t_i < len(h_pids) else ""
                hs = (
                    post_sid_wire_map[h_pid]
                    if post_sid_wire_map is not None and h_pid in post_sid_wire_map
                    else (h_sids[t_i] if t_i < len(h_sids) else None)
                )
                if hs and len(hs) >= 2 and (int(hs[0]), int(hs[1])) == cand_p2:
                    sid_p2_hits += 1.0

        denom_h = float(max(1, total_len))
        X[row_idx] = [
            1.0 if int(row.get("candidate_in_network") or 0) > 0 else 0.0,
            a_like,
            a_reply,
            a_repost,
            a_click,
            a_share,
            a_neg,
            a_total,
            a_total / denom_h,
            max(0.0, 1.0 - float(min_tb) / 15.0) if a_total > 0 else 0.0,
            math.log1p(float(total_len)),
            user_pos / denom_h,
            user_neg / denom_h,
            sid_p2_hits,
            float(cred.get(cand_author, 0.0)),
            1.0 if int(row.get("candidate_has_video") or 0) > 0 else 0.0,
        ]

        # 二分类真实综合正交互标签
        labels = row.get("action_labels") or []
        masks = row.get("action_mask") or []
        engaged = any(
            int(labels[i]) > 0 and (int(masks[i]) > 0 if i < len(masks) else True)
            for i in range(min(9, len(labels)))
        )
        y[row_idx] = 1 if engaged else 0

    return X, y


class SnapshotSafeguard:
    """RealGraph V3 快照安全闸门：拦截特征泄漏、维度错位与退化模型写入。"""

    def __init__(self, *, min_samples: int = 8, min_auc: float = 0.45) -> None:
        self.min_samples = int(min_samples)
        self.min_auc = float(min_auc)

    def validate(self, artifact: Mapping[str, Any]) -> Tuple[bool, List[str]]:
        reasons: List[str] = []
        feats = list(artifact.get("features") or [])
        if len(feats) != 16:
            reasons.append(f"feature_count_mismatch:{len(feats)}!=16")
        leaked = [f for f in feats if f in FORBIDDEN_LEAKAGE_FEATURES]
        if leaked:
            reasons.append(f"forbidden_leakage_features:{leaked}")
        metrics = artifact.get("metrics") or {}
        samples = int(metrics.get("samples", 0) or 0)
        if samples < self.min_samples:
            reasons.append(f"insufficient_samples:{samples}<{self.min_samples}")
        auc = metrics.get("auc")
        if auc is not None:
            if not math.isfinite(float(auc)) or float(auc) < self.min_auc:
                reasons.append(f"auc_below_guard:{auc}<{self.min_auc}")
        return len(reasons) == 0, reasons

    def save_atomic(self, artifact: Mapping[str, Any], target_path: Path) -> Path:
        ok, reasons = self.validate(artifact)
        if not ok:
            raise RuntimeError(f"SnapshotSafeguard blocked realgraph_v3 write: {reasons}")
        target = Path(target_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(str(tmp), str(target))
        return target


def train_realgraph_v3_gbt(
    samples: Sequence[Mapping[str, Any]],
    *,
    models_dir: Optional[Path] = None,
    post_sid_wire_map: Optional[Mapping[str, Sequence[int]]] = None,
    n_estimators: int = 32,
    max_depth: int = 3,
    learning_rate: float = 0.08,
    seed: int = 42,
    min_samples_guard: int = 8,
    min_auc_guard: float = 0.45,
) -> Dict[str, Any]:
    """训练 16 维零泄漏 RealGraph V3 GBT 侧车与作者 PageRank 声誉表，过 `SnapshotSafeguard` 落盘。"""
    if not samples:
        raise ValueError("RealGraph V3 训练样本不能为空")

    author_cred = compute_local_pagerank_author_cred(samples)
    X, y = extract_realgraph_v3_matrix(
        samples,
        author_cred_map=author_cred,
        post_sid_wire_map=post_sid_wire_map,
    )
    pos_count = int(y.sum())
    neg_count = int(len(y) - pos_count)
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + "000Z"

    if pos_count == 0 or neg_count == 0:
        prior = float(math.log((pos_count + 0.5) / (neg_count + 0.5)))
        artifact: Dict[str, Any] = {
            "schemaVersion": 3,
            "trainedAt": now_iso,
            "features": list(REALGRAPH_V3_FEATURES),
            "baseScore": round(prior, 8),
            "learningRate": float(learning_rate),
            "trees": [],
            "authorCredScores": author_cred,
            "metrics": {"samples": int(len(y)), "positives": pos_count, "auc": None, "logLoss": None},
        }
    else:
        gbt = GradientBoostingClassifier(
            n_estimators=max(4, int(n_estimators)),
            max_depth=max(1, int(max_depth)),
            learning_rate=float(learning_rate),
            random_state=seed,
        )
        gbt.fit(X, y)
        probs = gbt.predict_proba(X)[:, 1]
        init_prob = float(np.clip(np.mean(y), 1e-6, 1.0 - 1e-6))
        base_score = float(math.log(init_prob / (1.0 - init_prob)))
        trees = [_serialize_tree(est[0]) for est in gbt.estimators_]
        artifact = {
            "schemaVersion": 3,
            "trainedAt": now_iso,
            "features": list(REALGRAPH_V3_FEATURES),
            "baseScore": round(base_score, 8),
            "learningRate": float(learning_rate),
            "trees": trees,
            "authorCredScores": author_cred,
            "metrics": {
                "samples": int(len(y)),
                "positives": pos_count,
                "auc": round(float(roc_auc_score(y, probs)), 6),
                "logLoss": round(float(log_loss(y, probs, labels=[0, 1])), 6),
            },
        }

    if models_dir is not None:
        safeguard = SnapshotSafeguard(min_samples=min_samples_guard, min_auc=min_auc_guard)
        safeguard.save_atomic(artifact, Path(models_dir) / "realgraph_v3.json")

    return artifact
