"""轻量化侧车模型与校准产物训练：SocialPhoenix Linear、RealGraph GBT 与 Platt 校准器。"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import math
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score

from recsys.contracts.actions import (
    ACTION_TYPE_MAP,
    NEGATIVE_ACTIONS,
    POSITIVE_ACTIONS,
    PREDICTED_ACTIONS,
)

SOCIAL_PHOENIX_TASKS: Tuple[str, ...] = (
    "click",
    "like",
    "reply",
    "repost",
    "quote",
    "share",
    "engagement",
    "negative",
)

REALGRAPH_FEATURES: Tuple[str, ...] = (
    "followScore",
    "likeCount",
    "replyCount",
    "retweetCount",
    "profileViewCount",
    "dwellTimeMs",
    "recency",
)

_MAX_SOCIAL_FEATURES = 4096
_MAX_FEATURE_BYTES = 128

_ACTION_ID_TO_NAME: Dict[int, str] = {idx: name for name, idx in ACTION_TYPE_MAP.items()}


def format_js_iso_timestamp(dt: Optional[datetime] = None) -> str:
    """生成与 JavaScript Date.prototype.toISOString() 完全严格匹配的 UTC 时间字符串。"""
    target = (dt or datetime.now(timezone.utc)).astimezone(timezone.utc)
    millis = target.microsecond // 1000
    return f"{target.strftime('%Y-%m-%dT%H:%M:%S')}.{millis:03d}Z"


def validate_social_phoenix_linear_artifact(artifact: Mapping[str, Any]) -> Tuple[bool, List[str]]:
    """
    严格对齐 TypeScript `developmentContract.ts` 对 SocialPhoenixLinearModel v1 的校验逻辑：
      - version === 1
      - trainedAt 严格匹配 UTC `.000Z` 格式
      - features 非空、去重、<= 4096 项、每项 UTF-8 <= 128 字节
      - tasks 精确包含 8 个任务，且每个任务 weights 键集合与 features 一一对应且全为有限浮点数
    """
    errors: List[str] = []
    if artifact.get("version") != 1:
        errors.append(f"invalid_version:{artifact.get('version')}")

    trained_at = artifact.get("trainedAt")
    if not isinstance(trained_at, str) or not trained_at.endswith("Z"):
        errors.append("invalid_trainedAt_format")
    else:
        try:
            parsed = datetime.fromisoformat(trained_at.replace("Z", "+00:00"))
            if format_js_iso_timestamp(parsed) != trained_at:
                errors.append("trainedAt_not_canonical_js_iso")
        except Exception:
            errors.append("invalid_trainedAt_parse")

    raw_features = artifact.get("features")
    if not isinstance(raw_features, list) or len(raw_features) == 0 or len(raw_features) > _MAX_SOCIAL_FEATURES:
        errors.append("invalid_features_length")
        return False, errors

    seen: set[str] = set()
    for feat in raw_features:
        if not isinstance(feat, str) or not feat or len(feat.encode("utf-8")) > _MAX_FEATURE_BYTES:
            errors.append(f"invalid_feature_name:{feat!r}")
            break
        if feat in seen:
            errors.append(f"duplicate_feature:{feat}")
            break
        seen.add(feat)

    tasks = artifact.get("tasks")
    if not isinstance(tasks, Mapping):
        errors.append("missing_tasks")
        return False, errors

    for task in SOCIAL_PHOENIX_TASKS:
        entry = tasks.get(task)
        if not isinstance(entry, Mapping):
            errors.append(f"missing_task:{task}")
            continue
        bias = entry.get("bias")
        if not isinstance(bias, (int, float)) or isinstance(bias, bool) or not math.isfinite(float(bias)):
            errors.append(f"invalid_bias:{task}")
        weights = entry.get("weights")
        if not isinstance(weights, Mapping):
            errors.append(f"missing_weights:{task}")
            continue
        if set(weights.keys()) != seen:
            errors.append(f"weights_feature_key_mismatch:{task}")
            continue
        for fname, val in weights.items():
            if not isinstance(val, (int, float)) or isinstance(val, bool) or not math.isfinite(float(val)):
                errors.append(f"non_finite_weight:{task}:{fname}")
                break

    return len(errors) == 0, errors


def extract_social_phoenix_features(sample: Mapping[str, Any]) -> Dict[str, float]:
    """从 PIT 样本或在线特征快照抽取干净的有界数值特征映射。"""
    feats: Dict[str, float] = {}
    precomputed = sample.get("features")
    if isinstance(precomputed, Mapping):
        for k, v in precomputed.items():
            key = str(k).strip()
            if not key or len(key.encode("utf-8")) > _MAX_FEATURE_BYTES:
                continue
            try:
                num = float(v)
            except Exception:
                continue
            if math.isfinite(num):
                feats[key] = num

    history = sample.get("history") or []
    hist_len = len(history)
    feats.setdefault("in_network", 1.0 if sample.get("in_network") or sample.get("inNetwork") else 0.0)
    feats.setdefault("has_video", 1.0 if sample.get("has_video") or sample.get("hasVideo") else 0.0)
    feats.setdefault("history_len_log", math.log1p(hist_len))

    cand_author = str(sample.get("candidate_author_id") or sample.get("authorId") or "")
    same_author = 0
    action_counts: Dict[str, int] = {}
    recent_hits = 0
    for item in history:
        if isinstance(item, Mapping):
            aid = str(item.get("author_id") or item.get("targetAuthorId") or "")
            act = str(item.get("action") or _ACTION_ID_TO_NAME.get(int(item.get("action_type", 0) or 0), "impression"))
            bucket = int(item.get("time_bucket", 15) or 15)
        else:
            seq = list(item)
            aid = str(seq[1]) if len(seq) > 1 else ""
            raw_act = seq[2] if len(seq) > 2 else 0
            act = _ACTION_ID_TO_NAME.get(int(raw_act), "impression") if isinstance(raw_act, int) else str(raw_act)
            bucket = int(seq[3] or 15) if len(seq) > 3 else 15
        if cand_author and aid == cand_author:
            same_author += 1
        action_counts[act] = action_counts.get(act, 0) + 1
        if bucket <= 3:
            recent_hits += 1

    denom = float(max(1, hist_len))
    feats.setdefault("same_author_hist_ratio", same_author / denom)
    feats.setdefault("recent_1h_hist_ratio", recent_hits / denom)
    for act_name in ("click", "like", "reply", "repost", "share", "not_interested"):
        feats.setdefault(f"hist_{act_name}_rate", action_counts.get(act_name, 0) / denom)
    return feats


def _task_target(sample: Mapping[str, Any], task: str) -> int:
    raw_labels = sample.get("labels") if isinstance(sample.get("labels"), Mapping) else {}
    if task == "engagement":
        return 1 if any(float(raw_labels.get(a, 0.0) or 0.0) > 0.0 for a in POSITIVE_ACTIONS) or sample.get("label") == 1 else 0
    if task == "negative":
        return 1 if any(float(raw_labels.get(a, 0.0) or 0.0) > 0.0 for a in NEGATIVE_ACTIONS) else 0
    return 1 if float(raw_labels.get(task, 0.0) or 0.0) > 0.0 else 0


def train_social_phoenix_linear(
    samples: Sequence[Mapping[str, Any]],
    *,
    models_dir: Optional[Path] = None,
    c_reg: float = 1.0,
    trained_at: Optional[datetime] = None,
) -> Dict[str, Any]:
    """训练轻量多任务逻辑回归 SocialPhoenix v1 模型，并按 TS 开发契约完成自检后落盘。"""
    if not samples:
        raise ValueError("SocialPhoenix 线性模型训练样本不能为空")

    feat_dicts = [extract_social_phoenix_features(s) for s in samples]
    feature_names = sorted({k for d in feat_dicts for k in d.keys()})[:_MAX_SOCIAL_FEATURES]
    if not feature_names:
        raise ValueError("未能从样本中提取任何合法的 SocialPhoenix 特征")

    X = np.array([[float(d.get(fname, 0.0)) for fname in feature_names] for d in feat_dicts], dtype=np.float64)
    tasks_out: Dict[str, Dict[str, Any]] = {}

    for task in SOCIAL_PHOENIX_TASKS:
        y = np.array([_task_target(s, task) for s in samples], dtype=np.int64)
        pos_count = int(y.sum())
        neg_count = int(len(y) - pos_count)

        if pos_count == 0 or neg_count == 0:
            # 退化场景：仅平滑先验对数几率，确保不因单一类别触发 sklearn 异常
            prior_bias = float(math.log((pos_count + 0.5) / (neg_count + 0.5)))
            tasks_out[task] = {
                "bias": round(prior_bias, 8),
                "weights": {fname: 0.0 for fname in feature_names},
            }
            continue

        clf = LogisticRegression(C=c_reg, max_iter=500, class_weight="balanced", solver="lbfgs")
        clf.fit(X, y)
        bias = float(clf.intercept_[0])
        coefs = clf.coef_[0]
        tasks_out[task] = {
            "bias": round(bias, 8),
            "weights": {fname: round(float(coefs[idx]), 8) for idx, fname in enumerate(feature_names)},
        }

    artifact: Dict[str, Any] = {
        "version": 1,
        "trainedAt": format_js_iso_timestamp(trained_at),
        "features": feature_names,
        "tasks": tasks_out,
    }
    valid, errors = validate_social_phoenix_linear_artifact(artifact)
    if not valid:
        raise ValueError(f"SocialPhoenix 产物校验失败: {errors}")

    if models_dir is not None:
        out_path = Path(models_dir) / "social_phoenix_linear.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")

    return artifact


def _serialize_decision_tree(tree_obj) -> List[Dict[str, Any]]:
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


def extract_realgraph_records_from_samples(samples: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    """当离线缺少显式 real_graph_edges 表时，从 PIT 样本历史聚合构造零泄漏的作者交互特征样本。"""
    records: List[Dict[str, Any]] = []
    for sample in samples:
        cand_author = str(sample.get("candidate_author_id") or sample.get("authorId") or "")
        history = sample.get("history") or []
        like_cnt = 0
        reply_cnt = 0
        repost_cnt = 0
        min_bucket = 15
        for item in history:
            if isinstance(item, Mapping):
                aid = str(item.get("author_id") or "")
                act = str(item.get("action") or _ACTION_ID_TO_NAME.get(int(item.get("action_type", 0) or 0), "impression"))
                bucket = int(item.get("time_bucket", 15) or 15)
            else:
                seq = list(item)
                aid = str(seq[1]) if len(seq) > 1 else ""
                raw_act = seq[2] if len(seq) > 2 else 0
                act = _ACTION_ID_TO_NAME.get(int(raw_act), "impression") if isinstance(raw_act, int) else str(raw_act)
                bucket = int(seq[3] or 15) if len(seq) > 3 else 15
            if cand_author and aid == cand_author:
                if act == "like":
                    like_cnt += 1
                elif act == "reply":
                    reply_cnt += 1
                elif act == "repost":
                    repost_cnt += 1
                min_bucket = min(min_bucket, bucket)

        recency_score = max(0.0, 1.0 - min_bucket / 15.0)
        label = _task_target(sample, "engagement")
        records.append(
            {
                "followScore": 1.0 if sample.get("in_network") or sample.get("inNetwork") else 0.0,
                "likeCount": float(like_cnt),
                "replyCount": float(reply_cnt),
                "retweetCount": float(repost_cnt),
                "profileViewCount": 0.0,
                "dwellTimeMs": float(sample.get("dwell_ms") or 0.0),
                "recency": recency_score,
                "label": label,
            }
        )
    return records


def train_realgraph_gbt(
    records: Sequence[Mapping[str, Any]],
    *,
    models_dir: Optional[Path] = None,
    n_estimators: int = 32,
    max_depth: int = 3,
    learning_rate: float = 0.08,
    seed: int = 42,
) -> Dict[str, Any]:
    """训练并导出结构化 RealGraph GBT 模型 JSON（支持跨语言确定性前向评估）。"""
    if not records:
        raise ValueError("RealGraph GBT 训练样本不能为空")

    X = np.array(
        [[float(rec.get(feat, 0.0) or 0.0) for feat in REALGRAPH_FEATURES] for rec in records],
        dtype=np.float64,
    )
    y = np.array([1 if float(rec.get("label", rec.get("engaged", 0)) or 0.0) > 0.0 else 0 for rec in records], dtype=np.int64)

    pos_count = int(y.sum())
    neg_count = int(len(y) - pos_count)
    if pos_count == 0 or neg_count == 0:
        prior = float(math.log((pos_count + 0.5) / (neg_count + 0.5)))
        artifact: Dict[str, Any] = {
            "schemaVersion": 1,
            "trainedAt": format_js_iso_timestamp(),
            "features": list(REALGRAPH_FEATURES),
            "baseScore": round(prior, 8),
            "learningRate": float(learning_rate),
            "trees": [],
            "metrics": {"samples": len(y), "positives": pos_count, "auc": None, "logLoss": None},
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
        trees = [_serialize_decision_tree(est[0]) for est in gbt.estimators_]
        artifact = {
            "schemaVersion": 1,
            "trainedAt": format_js_iso_timestamp(),
            "features": list(REALGRAPH_FEATURES),
            "baseScore": round(base_score, 8),
            "learningRate": float(learning_rate),
            "trees": trees,
            "metrics": {
                "samples": len(y),
                "positives": pos_count,
                "auc": round(float(roc_auc_score(y, probs)), 6),
                "logLoss": round(float(log_loss(y, probs, labels=[0, 1])), 6),
            },
        }

    if models_dir is not None:
        out_path = Path(models_dir) / "realgraph_gbt.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")

    return artifact


def _expected_calibration_error(y_true: np.ndarray, y_prob: np.ndarray, bins: int = 10) -> float:
    if len(y_true) == 0:
        return 0.0
    ece = 0.0
    edges = np.linspace(0.0, 1.0, bins + 1)
    for idx in range(bins):
        lo, hi = edges[idx], edges[idx + 1]
        mask = (y_prob >= lo) & (y_prob <= hi if idx == bins - 1 else y_prob < hi)
        if not np.any(mask):
            continue
        conf = float(np.mean(y_prob[mask]))
        acc = float(np.mean(y_true[mask]))
        ece += (float(np.sum(mask)) / float(len(y_true))) * abs(acc - conf)
    return float(ece)


def fit_weighted_calibrator(
    records: Sequence[Mapping[str, Any]],
    *,
    models_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """
    为各互动目标拟合 1D Platt 校准参数：logit(p_cal) = scale * logit(p_raw) + bias。
    输入 records 可为离线回放日志 [{"action": "like", "rawProb": 0.2, "label": 1}, ...]
    或带 "predictions"/"labels" 字段的样本字典。
    """
    by_action: Dict[str, Tuple[List[float], List[int]]] = {a: ([], []) for a in PREDICTED_ACTIONS}

    for rec in records:
        if "action" in rec and "rawProb" in rec:
            act = str(rec["action"])
            if act in by_action:
                by_action[act][0].append(float(rec["rawProb"]))
                by_action[act][1].append(1 if float(rec.get("label", 0)) > 0.0 else 0)
            continue

        preds = rec.get("predictions") if isinstance(rec.get("predictions"), Mapping) else {}
        labels = rec.get("labels") if isinstance(rec.get("labels"), Mapping) else {}
        for act in PREDICTED_ACTIONS:
            if act in labels:
                raw_p = float(preds.get(act, 0.5) if preds else (0.7 if float(labels[act] or 0.0) > 0.0 else 0.2))
                by_action[act][0].append(raw_p)
                by_action[act][1].append(1 if float(labels[act] or 0.0) > 0.0 else 0)

    actions_cfg: Dict[str, Dict[str, Any]] = {}
    for act in PREDICTED_ACTIONS:
        probs_list, labels_list = by_action[act]
        if not labels_list:
            actions_cfg[act] = {"scale": 1.0, "bias": 0.0, "posRate": 0.0, "count": 0, "eceBefore": None, "eceAfter": None}
            continue

        p_arr = np.clip(np.asarray(probs_list, dtype=np.float64), 1e-5, 1.0 - 1e-5)
        y_arr = np.asarray(labels_list, dtype=np.int64)
        logits = np.log(p_arr / (1.0 - p_arr)).reshape(-1, 1)
        pos_rate = float(np.mean(y_arr))
        ece_before = _expected_calibration_error(y_arr, p_arr)

        if len(np.unique(y_arr)) < 2:
            scale = 1.0
            bias = 0.0
            p_after = p_arr
        else:
            lr = LogisticRegression(C=1.0, max_iter=300, solver="lbfgs")
            lr.fit(logits, y_arr)
            scale = float(lr.coef_[0][0])
            bias = float(lr.intercept_[0])
            p_after = 1.0 / (1.0 + np.exp(-(scale * logits.reshape(-1) + bias)))

        ece_after = _expected_calibration_error(y_arr, p_after)
        actions_cfg[act] = {
            "scale": round(scale, 6),
            "bias": round(bias, 6),
            "posRate": round(pos_rate, 6),
            "count": int(len(y_arr)),
            "eceBefore": round(ece_before, 6),
            "eceAfter": round(ece_after, 6),
        }

    artifact = {
        "schemaVersion": 1,
        "trainedAt": format_js_iso_timestamp(),
        "method": "platt",
        "actions": actions_cfg,
    }
    if models_dir is not None:
        out_path = Path(models_dir) / "weighted_calibrator.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    return artifact


def extract_realgraph_records_from_mongo(
    db: Any,
    *,
    limit: int = 100_000,
    now: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """从 MongoDB `real_graph_edges`（支持 rollupCounts 嵌套结构与平滑 recency 衰减）提取 RealGraph 训练边。"""
    if db is None or "real_graph_edges" not in db.list_collection_names():
        return []

    ref_now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    records: List[Dict[str, Any]] = []
    for doc in db["real_graph_edges"].find({}).limit(max(1, int(limit))):
        rollup = doc.get("rollupCounts") if isinstance(doc.get("rollupCounts"), Mapping) else {}
        follow_raw = doc.get("followScore")
        follow_score = (
            float(follow_raw)
            if follow_raw is not None
            else (1.0 if float(rollup.get("followCount") or 0.0) > 0.0 else 0.0)
        )

        recency_raw = doc.get("recency")
        if recency_raw is not None:
            recency_score = float(recency_raw)
        else:
            last_ts = doc.get("lastInteractionAt")
            if isinstance(last_ts, str):
                try:
                    last_ts = datetime.fromisoformat(last_ts.replace("Z", "+00:00"))
                except ValueError:
                    last_ts = None
            if isinstance(last_ts, datetime):
                ts_utc = last_ts.replace(tzinfo=timezone.utc) if last_ts.tzinfo is None else last_ts.astimezone(timezone.utc)
                age_days = max(0.0, (ref_now - ts_utc).total_seconds() / 86400.0)
                recency_score = math.exp(-age_days / 7.0)
            else:
                recency_score = 0.0

        records.append(
            {
                "followScore": follow_score,
                "likeCount": float(doc["likeCount"]) if doc.get("likeCount") is not None else float(rollup.get("likeCount") or 0.0),
                "replyCount": float(doc["replyCount"]) if doc.get("replyCount") is not None else float(rollup.get("replyCount") or 0.0),
                "retweetCount": float(doc["retweetCount"]) if doc.get("retweetCount") is not None else float(rollup.get("retweetCount") or 0.0),
                "profileViewCount": float(doc["profileViewCount"]) if doc.get("profileViewCount") is not None else float(rollup.get("profileViewCount") or 0.0),
                "dwellTimeMs": float(doc["dwellTimeMs"]) if doc.get("dwellTimeMs") is not None else float(rollup.get("dwellTimeMs") or 0.0),
                "recency": float(recency_score),
                "label": 1 if float(doc.get("decayedSum") or 0.0) > 0.0 else 0,
            }
        )
    return records


def run_sidecar_training(
    *,
    samples_path: Path,
    models_dir: Path,
    mongo_uri: str = "",
    db_name: Optional[str] = None,
) -> Dict[str, Any]:
    """一键从导出的 PIT 样本（及可选 Mongo RealGraph 边表）训练全部侧车轻量产物。"""
    import pickle

    with open(samples_path, "rb") as f:
        samples = pickle.load(f)
    if not samples:
        raise ValueError(f"侧车训练样本为空: {samples_path}")

    models_dir = Path(models_dir)
    models_dir.mkdir(parents=True, exist_ok=True)

    social_artifact = train_social_phoenix_linear(samples, models_dir=models_dir)

    edge_records: List[Dict[str, Any]] = []
    if mongo_uri:
        try:
            from recsys.data.pit_export import connect_mongo

            db = connect_mongo(mongo_uri, db_name)
            edge_records = extract_realgraph_records_from_mongo(db)
        except Exception:
            edge_records = []

    sample_edge_records = extract_realgraph_records_from_samples(samples)
    if edge_records:
        edge_records.extend(sample_edge_records)
    else:
        edge_records = sample_edge_records

    realgraph_artifact = train_realgraph_gbt(edge_records, models_dir=models_dir)
    calibrator_artifact = fit_weighted_calibrator(samples, models_dir=models_dir)

    report = {
        "socialPhoenixFeatures": len(social_artifact["features"]),
        "realGraphMetrics": realgraph_artifact.get("metrics", {}),
        "calibratorActions": {
            k: v for k, v in calibrator_artifact["actions"].items() if v.get("count", 0) > 0
        },
        "modelsDir": str(models_dir),
    }
    (models_dir / "sidecars_train_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return report


def main() -> None:
    import argparse

    default_ml_dir = Path(__file__).resolve().parent.parent.parent
    parser = argparse.ArgumentParser(description="Train SocialPhoenix Linear, RealGraph GBT and Platt Calibrator")
    parser.add_argument("--samples", type=Path, default=default_ml_dir / "data" / "phoenix_v2_samples.pkl")
    parser.add_argument("--models-dir", type=Path, default=default_ml_dir / "models")
    parser.add_argument("--mongo-uri", default="")
    parser.add_argument("--db-name", default=None)
    args = parser.parse_args()
    report = run_sidecar_training(
        samples_path=args.samples,
        models_dir=args.models_dir,
        mongo_uri=args.mongo_uri,
        db_name=args.db_name,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
