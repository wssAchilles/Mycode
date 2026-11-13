"""Phoenix V2 多任务排序训练器：支持严格 PIT 历史分桶、CUDA 混合精度与 CPU 推理基准验证。"""

from __future__ import annotations

import argparse
from contextlib import nullcontext
from dataclasses import dataclass
import gzip
import json
import math
import pickle
import random
import resource
import shutil
import sys
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim
from sklearn.metrics import roc_auc_score
from torch.utils.data import DataLoader, Dataset
from tqdm import tqdm

from recsys.contracts.actions import (
    ACTION_LOSS_WEIGHTS,
    ACTION_TYPE_MAP,
    PREDICTED_ACTIONS,
    canonicalize_action_name,
)
from recsys.models.phoenix_v2 import (
    PhoenixV2Ranker,
    create_medium_phoenix,
    create_mini_phoenix,
    create_phoenix_for_scale,
    stable_id_hash,
)

_DEFAULT_ML_DIR = Path(__file__).resolve().parent.parent.parent
_DWELL_LOG_DENOM = math.log1p(120_000.0)


@dataclass
class PhoenixV2TrainConfig:
    """Phoenix V2 训练超参数与导出目录配置。"""

    data_dir: Path = _DEFAULT_ML_DIR / "data"
    models_dir: Path = _DEFAULT_ML_DIR / "models"
    samples_path: Optional[Path] = None
    eval_samples_path: Optional[Path] = None
    aux_samples_path: Optional[Path] = None
    aux_sample_max_groups: int = 0
    init_from: Optional[Path] = None
    reset_id_hash_embeddings_on_init: bool = False
    backbone_lr_scale: float = 1.0
    checkpoint_role: str = "serving"  # "serving" | "pretrain_only"
    scale: str = "auto"  # "auto" | "mini" | "medium"
    epochs: int = 8
    batch_size: int = 32
    lr: float = 3e-4
    weight_decay: float = 1e-2
    max_history: int = 64
    max_candidates: int = 32
    val_ratio: float = 0.1
    dwell_loss_weight: float = 0.5
    num_workers: int = 0
    max_steps_per_epoch: int = 0
    seed: int = 42


def _resolve_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def _set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def _normalize_history_entry(item: Any) -> Tuple[int, int, int, int]:
    """将 3 元组/4 元组或字典形式的历史动作统一转为哈希整型特征。"""
    if isinstance(item, dict):
        pid = stable_id_hash(item.get("post_id") or item.get("targetPostId") or item.get("postId"))
        aid = stable_id_hash(item.get("author_id") or item.get("targetAuthorId") or item.get("authorId"))
        raw_action = item.get("action_type", item.get("action", "click"))
        action_id = (
            int(raw_action)
            if isinstance(raw_action, int) and not isinstance(raw_action, bool)
            else ACTION_TYPE_MAP.get(canonicalize_action_name(str(raw_action)), 0)
        )
        time_bucket = max(0, min(15, int(item.get("time_bucket", 0) or 0)))
        return pid, aid, max(0, min(len(ACTION_TYPE_MAP) - 1, action_id)), time_bucket

    seq = list(item)
    pid = stable_id_hash(seq[0]) if len(seq) > 0 else 0
    aid = stable_id_hash(seq[1]) if len(seq) > 1 else 0
    raw_action = seq[2] if len(seq) > 2 else 0
    action_id = (
        int(raw_action)
        if isinstance(raw_action, int) and not isinstance(raw_action, bool)
        else ACTION_TYPE_MAP.get(canonicalize_action_name(str(raw_action)), 0)
    )
    time_bucket = max(0, min(15, int(seq[3] or 0))) if len(seq) > 3 else 0
    return pid, aid, max(0, min(len(ACTION_TYPE_MAP) - 1, action_id)), time_bucket


def _extract_candidate_entry(sample: Dict[str, Any]) -> Dict[str, Any]:
    raw_labels = sample.get("labels") if isinstance(sample.get("labels"), dict) else {}
    labels: Dict[str, float] = {}
    for action in PREDICTED_ACTIONS:
        if action in raw_labels:
            labels[action] = 1.0 if float(raw_labels[action] or 0.0) > 0.0 else 0.0
        elif action == "click" and sample.get("label", 0) == 1:
            labels[action] = 1.0
        else:
            labels[action] = 0.0

    dwell_ms = float(sample.get("dwell_ms") or sample.get("dwellTimeMs") or 0.0)
    dwell_norm = min(1.0, math.log1p(max(0.0, dwell_ms)) / _DWELL_LOG_DENOM)
    # 若上游样本已显式给出 dwell 布尔标签（例如 KuaiRand 对被动短滑过 <3s 置 0），绝不强制覆盖
    if "dwell" not in raw_labels and dwell_ms >= 3000.0:
        labels["dwell"] = 1.0

    return {
        "post_id": stable_id_hash(sample.get("candidate_post_id") or sample.get("postId")),
        "author_id": stable_id_hash(sample.get("candidate_author_id") or sample.get("authorId")),
        "in_network": 1 if sample.get("in_network") or sample.get("inNetwork") else 0,
        "has_video": 1 if sample.get("has_video") or sample.get("hasVideo") else 0,
        "labels": labels,
        "dwell_target": dwell_norm,
    }


def _load_raw_samples(samples_path: Path) -> List[Dict[str, Any]]:
    """从单个 .pkl/.pkl.gz 文件或包含分片文件的目录顺序读取训练样本。"""
    target = Path(samples_path)
    if target.is_dir():
        shard_files = sorted(
            [p for p in target.iterdir() if p.is_file() and (p.name.endswith(".pkl") or p.name.endswith(".pkl.gz"))]
        )
        if not shard_files:
            raise FileNotFoundError(f"目录 {target} 下未找到任何 .pkl / .pkl.gz 样本分片")
        merged: List[Dict[str, Any]] = []
        for sf in shard_files:
            opener = gzip.open if sf.name.endswith(".gz") else open
            with opener(sf, "rb") as f:
                part = pickle.load(f)
            if isinstance(part, list):
                merged.extend(part)
        return merged

    opener = gzip.open if target.name.endswith(".gz") else open
    with opener(target, "rb") as f:
        loaded = pickle.load(f)
    return list(loaded)


class PhoenixV2Dataset(Dataset):
    """
    Phoenix V2 排序样本集：
      - 按“用户 + 完全一致的 PIT 历史签名”安全分桶，绝不跨时刻混拼未来动作
      - 支持单样本流、预分组多候选 slate 样本与分片目录三种输入
    """

    def __init__(
        self,
        samples_path: Optional[Path] = None,
        *,
        samples: Optional[Sequence[Dict[str, Any]]] = None,
        max_history: int = 64,
        max_candidates: int = 32,
    ):
        if samples is not None:
            raw_samples = list(samples)
        elif samples_path is not None:
            raw_samples = _load_raw_samples(Path(samples_path))
        else:
            raise ValueError("必须提供 samples_path 或 samples 序列")

        self.max_history = max(1, int(max_history))
        self.max_candidates = max(1, int(max_candidates))
        self.groups: List[Dict[str, Any]] = []
        self.unique_users: set[int] = set()
        self.unique_posts: set[int] = set()

        bucket_index: Dict[Tuple[int, Tuple[Tuple[int, int, int, int], ...]], int] = {}

        for sample in raw_samples:
            uid_hash = stable_id_hash(sample.get("user_id") or sample.get("userId"))
            if uid_hash:
                self.unique_users.add(uid_hash)

            raw_hist = sample.get("history", [])[-self.max_history :]
            norm_hist = tuple(_normalize_history_entry(h) for h in raw_hist)
            for pid_h, _, _, _ in norm_hist:
                if pid_h:
                    self.unique_posts.add(pid_h)

            if isinstance(sample.get("candidates"), list) and sample["candidates"]:
                cand_list = [_extract_candidate_entry(c) for c in sample["candidates"]]
            else:
                cand_list = [_extract_candidate_entry(sample)]

            for cand in cand_list:
                if cand["post_id"]:
                    self.unique_posts.add(cand["post_id"])

            key = (uid_hash, norm_hist)
            existing_pos = bucket_index.get(key)
            if existing_pos is not None and len(self.groups[existing_pos]["candidates"]) + len(cand_list) <= self.max_candidates:
                self.groups[existing_pos]["candidates"].extend(cand_list)
                continue

            # 按 max_candidates 切片，避免高活跃用户在旧版逻辑中被截断丢弃样本
            for start in range(0, len(cand_list), self.max_candidates):
                chunk = cand_list[start : start + self.max_candidates]
                group_idx = len(self.groups)
                self.groups.append(
                    {
                        "user_id": uid_hash,
                        "history": list(norm_hist),
                        "candidates": list(chunk),
                        "action_time": str(sample.get("action_time") or ""),
                    }
                )
                if len(chunk) < self.max_candidates:
                    bucket_index[key] = group_idx

    def __len__(self) -> int:
        return len(self.groups)

    def __getitem__(self, idx: int) -> Dict[str, Any]:
        return self.groups[idx]


def collate_phoenix_v2_batch(
    batch: Sequence[Dict[str, Any]],
    *,
    max_history: int,
    max_candidates: int,
) -> Dict[str, Any]:
    """将不等长历史与候选分组对齐填充为模型批量张量。"""
    batch_size = len(batch)
    hist_len = min(max_history, max((len(g["history"]) for g in batch), default=1))
    hist_len = max(1, hist_len)
    cand_len = min(max_candidates, max((len(g["candidates"]) for g in batch), default=1))
    cand_len = max(1, cand_len)

    user_ids = torch.zeros((batch_size,), dtype=torch.long)
    hist_posts = torch.zeros((batch_size, hist_len), dtype=torch.long)
    hist_authors = torch.zeros((batch_size, hist_len), dtype=torch.long)
    hist_actions = torch.zeros((batch_size, hist_len), dtype=torch.long)
    hist_buckets = torch.zeros((batch_size, hist_len), dtype=torch.long)
    hist_mask = torch.zeros((batch_size, hist_len), dtype=torch.long)

    cand_posts = torch.zeros((batch_size, cand_len), dtype=torch.long)
    cand_authors = torch.zeros((batch_size, cand_len), dtype=torch.long)
    cand_in_net = torch.zeros((batch_size, cand_len), dtype=torch.long)
    cand_has_video = torch.zeros((batch_size, cand_len), dtype=torch.long)
    cand_mask = torch.zeros((batch_size, cand_len), dtype=torch.long)
    dwell_target = torch.zeros((batch_size, cand_len), dtype=torch.float32)

    labels = {action: torch.zeros((batch_size, cand_len), dtype=torch.float32) for action in PREDICTED_ACTIONS}

    for b_idx, group in enumerate(batch):
        user_ids[b_idx] = int(group["user_id"])
        for h_idx, (pid, aid, act_id, t_bucket) in enumerate(group["history"][-hist_len:]):
            hist_posts[b_idx, h_idx] = pid
            hist_authors[b_idx, h_idx] = aid
            hist_actions[b_idx, h_idx] = act_id
            hist_buckets[b_idx, h_idx] = t_bucket
            hist_mask[b_idx, h_idx] = 1

        for c_idx, cand in enumerate(group["candidates"][:cand_len]):
            cand_posts[b_idx, c_idx] = cand["post_id"]
            cand_authors[b_idx, c_idx] = cand["author_id"]
            cand_in_net[b_idx, c_idx] = cand["in_network"]
            cand_has_video[b_idx, c_idx] = cand["has_video"]
            cand_mask[b_idx, c_idx] = 1
            dwell_target[b_idx, c_idx] = cand["dwell_target"]
            for action in PREDICTED_ACTIONS:
                labels[action][b_idx, c_idx] = cand["labels"][action]

    return {
        "user_ids": user_ids,
        "history_post_ids": hist_posts,
        "history_author_ids": hist_authors,
        "history_action_types": hist_actions,
        "history_time_buckets": hist_buckets,
        "history_mask": hist_mask,
        "candidate_post_ids": cand_posts,
        "candidate_author_ids": cand_authors,
        "candidate_in_network": cand_in_net,
        "candidate_has_video": cand_has_video,
        "candidate_mask": cand_mask,
        "dwell_target": dwell_target,
        "labels": labels,
    }


def _compute_multitask_loss(
    outputs: Dict[str, torch.Tensor],
    labels: Dict[str, torch.Tensor],
    cand_mask: torch.Tensor,
    dwell_target: torch.Tensor,
    dwell_loss_weight: float,
) -> torch.Tensor:
    mask_float = cand_mask.float()
    valid_count = mask_float.sum().clamp(min=1.0)

    total_loss = torch.zeros((), device=cand_mask.device, dtype=torch.float32)
    weight_sum = 0.0
    for action in PREDICTED_ACTIONS:
        if action not in outputs:
            continue
        weight = float(ACTION_LOSS_WEIGHTS.get(action, 1.0))
        bce = F.binary_cross_entropy_with_logits(
            outputs[action].float(),
            labels[action].float(),
            reduction="none",
        )
        masked_bce = (bce * mask_float).sum() / valid_count
        total_loss = total_loss + weight * masked_bce
        weight_sum += weight

    if weight_sum > 0.0:
        total_loss = total_loss / weight_sum

    if "dwell_time" in outputs and dwell_loss_weight > 0.0:
        pred_dwell = torch.sigmoid(outputs["dwell_time"].float())
        huber = F.smooth_l1_loss(pred_dwell, dwell_target.float(), reduction="none")
        dwell_loss = (huber * mask_float).sum() / valid_count
        total_loss = total_loss + float(dwell_loss_weight) * dwell_loss

    return total_loss


@torch.no_grad()
def _evaluate_validation(
    model: PhoenixV2Ranker,
    val_loader: Optional[DataLoader],
    device: torch.device,
    dwell_loss_weight: float,
) -> Dict[str, Any]:
    if val_loader is None:
        return {}

    model.eval()
    total_loss = 0.0
    steps = 0
    action_preds: Dict[str, List[np.ndarray]] = {a: [] for a in PREDICTED_ACTIONS}
    action_trues: Dict[str, List[np.ndarray]] = {a: [] for a in PREDICTED_ACTIONS}

    for batch in val_loader:
        cand_mask = batch["candidate_mask"].to(device)
        labels_dev = {a: batch["labels"][a].to(device) for a in PREDICTED_ACTIONS}
        dwell_dev = batch["dwell_target"].to(device)

        outputs = model(
            batch["user_ids"].to(device),
            batch["history_post_ids"].to(device),
            batch["history_author_ids"].to(device),
            batch["history_action_types"].to(device),
            batch["history_mask"].to(device),
            batch["candidate_post_ids"].to(device),
            batch["candidate_author_ids"].to(device),
            cand_mask,
            history_time_buckets=batch["history_time_buckets"].to(device),
            candidate_in_network=batch["candidate_in_network"].to(device),
            candidate_has_video=batch["candidate_has_video"].to(device),
        )
        loss = _compute_multitask_loss(outputs, labels_dev, cand_mask, dwell_dev, dwell_loss_weight)
        total_loss += float(loss.item())
        steps += 1

        valid_bool = (cand_mask > 0).detach().cpu().numpy().reshape(-1)
        for action in PREDICTED_ACTIONS:
            probs = torch.sigmoid(outputs[action].float()).detach().cpu().numpy().reshape(-1)[valid_bool]
            trues = labels_dev[action].detach().cpu().numpy().reshape(-1)[valid_bool]
            if len(probs) > 0:
                action_preds[action].append(probs)
                action_trues[action].append(trues)

    per_action_auc: Dict[str, Optional[float]] = {}
    valid_aucs: List[float] = []
    for action in PREDICTED_ACTIONS:
        if not action_preds[action]:
            per_action_auc[action] = None
            continue
        y_pred = np.concatenate(action_preds[action])
        y_true = np.concatenate(action_trues[action])
        if len(np.unique(y_true)) < 2:
            per_action_auc[action] = None
            continue
        auc = float(roc_auc_score(y_true, y_pred))
        per_action_auc[action] = auc
        valid_aucs.append(auc)

    return {
        "valLoss": total_loss / max(1, steps),
        "macroRocAuc": float(sum(valid_aucs) / len(valid_aucs)) if valid_aucs else None,
        "actionAuc": per_action_auc,
    }


def _benchmark_cpu_inference(
    cpu_model: PhoenixV2Ranker,
    max_history: int,
    max_candidates: int,
) -> Dict[str, Any]:
    """评估导出模型在 CPU FP32 与动态 INT8 量化下的单请求延迟与内存占用。"""
    cpu_model.eval()
    hist_len = min(max_history, 32)
    cand_len = min(max_candidates, 16)

    dummy_args = (
        torch.ones((1,), dtype=torch.long),
        torch.randint(2, 1000, (1, hist_len), dtype=torch.long),
        torch.randint(2, 1000, (1, hist_len), dtype=torch.long),
        torch.randint(0, len(ACTION_TYPE_MAP), (1, hist_len), dtype=torch.long),
        torch.ones((1, hist_len), dtype=torch.long),
        torch.randint(2, 1000, (1, cand_len), dtype=torch.long),
        torch.randint(2, 1000, (1, cand_len), dtype=torch.long),
        torch.ones((1, cand_len), dtype=torch.long),
    )

    def _time_runs(target_model: nn.Module, runs: int = 8) -> Tuple[float, float]:
        with torch.no_grad():
            target_model(*dummy_args)
            timings: List[float] = []
            for _ in range(runs):
                t0 = time.perf_counter()
                target_model(*dummy_args)
                timings.append((time.perf_counter() - t0) * 1000.0)
        arr = np.sort(np.asarray(timings, dtype=np.float64))
        return float(np.percentile(arr, 50)), float(np.percentile(arr, 95))

    fp32_p50, fp32_p95 = _time_runs(cpu_model)
    int8_p50: Optional[float] = None
    int8_p95: Optional[float] = None
    try:
        quantized = torch.ao.quantization.quantize_dynamic(cpu_model, {nn.Linear}, dtype=torch.qint8)
        int8_p50, int8_p95 = _time_runs(quantized)
    except Exception:
        pass

    rss_raw = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # macOS ru_maxrss 单位为字节，Linux 为 KiB
    rss_mb = float(rss_raw) / (1024.0 * 1024.0) if sys.platform == "darwin" else float(rss_raw) / 1024.0

    return {
        "cpuFp32P50Ms": round(fp32_p50, 3),
        "cpuFp32P95Ms": round(fp32_p95, 3),
        "cpuInt8P50Ms": round(int8_p50, 3) if int8_p50 is not None else None,
        "cpuInt8P95Ms": round(int8_p95, 3) if int8_p95 is not None else None,
        "peakRssMb": round(rss_mb, 2),
    }


_ID_HASH_PREFIXES = (
    "user_emb.",
    "history_tokenizer.post_emb.",
    "history_tokenizer.author_emb.",
    "candidate_tokenizer.post_emb.",
    "candidate_tokenizer.author_emb.",
)


def _select_model(
    config: PhoenixV2TrainConfig,
    num_users: int,
    num_posts: int,
) -> PhoenixV2Ranker:
    """依据 scale 或初始化检查点旁路配置构建 PhoenixV2Ranker 实例。"""
    if config.scale == "mini":
        return create_mini_phoenix(max_history_len=config.max_history, max_candidates=config.max_candidates)
    if config.scale == "medium":
        return create_medium_phoenix(max_history_len=config.max_history, max_candidates=config.max_candidates)

    if config.init_from is not None:
        sibling_cfg = Path(config.init_from).parent / "phoenix_v2_config.json"
        if sibling_cfg.exists():
            raw = json.loads(sibling_cfg.read_text(encoding="utf-8"))
            return PhoenixV2Ranker(
                dim=int(raw["dim"]),
                num_heads=int(raw["num_heads"]),
                num_layers=int(raw["num_layers"]),
                max_history_len=int(raw.get("max_history_len", config.max_history)),
                max_candidates=int(raw.get("max_candidates", config.max_candidates)),
                num_hashes=int(raw.get("num_hashes", 2)),
            )

    return create_phoenix_for_scale(
        num_users,
        num_posts,
        max_history_len=config.max_history,
        max_candidates=config.max_candidates,
    )


def _load_pretrained_weights(
    model: PhoenixV2Ranker,
    init_from: Path,
    *,
    reset_id_hashes: bool,
) -> Dict[str, Any]:
    """从预训练检查点严格对齐并加载权重，支持按需重置域相关 ID 哈希嵌入表。"""
    ckpt_path = Path(init_from)
    if not ckpt_path.exists():
        raise FileNotFoundError(f"预训练检查点不存在: {ckpt_path}")

    loaded = torch.load(ckpt_path, map_location="cpu", weights_only=True)
    if not isinstance(loaded, dict):
        raise ValueError(f"预训练检查点格式无效，期望 state_dict 字典: {ckpt_path}")

    target_state = model.state_dict()
    missing = set(target_state.keys()) - set(loaded.keys())
    unexpected = set(loaded.keys()) - set(target_state.keys())
    if missing or unexpected:
        raise ValueError(
            "预训练检查点与当前模型结构键集合不一致: "
            f"missing={sorted(missing)[:5]}, unexpected={sorted(unexpected)[:5]}"
        )

    for key, current_tensor in target_state.items():
        incoming = loaded[key]
        if tuple(incoming.shape) != tuple(current_tensor.shape):
            raise ValueError(
                f"预训练检查点参数形状不匹配 ({key}): "
                f"checkpoint={tuple(incoming.shape)} vs model={tuple(current_tensor.shape)}"
            )

    loaded_keys = 0
    reset_keys = 0
    merged_state: Dict[str, torch.Tensor] = {}
    for key, current_tensor in target_state.items():
        if reset_id_hashes and key.startswith(_ID_HASH_PREFIXES):
            merged_state[key] = current_tensor
            reset_keys += 1
        else:
            merged_state[key] = loaded[key]
            loaded_keys += 1

    model.load_state_dict(merged_state, strict=True)
    return {"loadedKeys": loaded_keys, "resetIdHashKeys": reset_keys}


def _build_optimizer_param_groups(
    model: PhoenixV2Ranker,
    *,
    lr: float,
    backbone_lr_scale: float,
) -> List[Dict[str, Any]]:
    """按参数域构建差分学习率优化器参数组，避免微调阶段遗忘主干表征。"""
    if backbone_lr_scale <= 0:
        raise ValueError(f"backbone_lr_scale 必须大于 0，当前为: {backbone_lr_scale}")
    if backbone_lr_scale == 1.0:
        return [{"params": [p for p in model.parameters() if p.requires_grad], "lr": lr}]

    id_hash_params: List[torch.Tensor] = []
    backbone_params: List[torch.Tensor] = []
    for name, param in model.named_parameters():
        if not param.requires_grad:
            continue
        if name.startswith(_ID_HASH_PREFIXES):
            id_hash_params.append(param)
        else:
            backbone_params.append(param)

    groups: List[Dict[str, Any]] = []
    if id_hash_params:
        groups.append({"params": id_hash_params, "lr": lr})
    if backbone_params:
        groups.append({"params": backbone_params, "lr": lr * backbone_lr_scale})
    return groups


def train_phoenix_v2(
    config: PhoenixV2TrainConfig,
    *,
    samples: Optional[Sequence[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """执行 Phoenix V2 训练、迁移微调、无偏评估与推理产物导出，并返回完整结构化报告。"""
    if config.checkpoint_role not in {"serving", "pretrain_only"}:
        raise ValueError(f"无效 checkpoint_role: {config.checkpoint_role}")

    _set_seed(config.seed)
    device = _resolve_device()

    data_dir = Path(config.data_dir)
    models_dir = Path(config.models_dir)
    models_dir.mkdir(parents=True, exist_ok=True)

    resolved_samples_path = Path(config.samples_path) if config.samples_path else (data_dir / "phoenix_v2_samples.pkl")
    dataset = PhoenixV2Dataset(
        None if samples is not None else resolved_samples_path,
        samples=samples,
        max_history=config.max_history,
        max_candidates=config.max_candidates,
    )
    if len(dataset) == 0:
        raise ValueError("Phoenix V2 训练数据集为空")

    # 按时间顺序划分验证集，避免随机打乱造成未来窗口交叉泄漏
    sorted_groups = sorted(dataset.groups, key=lambda g: g.get("action_time", ""))
    total_groups = len(sorted_groups)
    val_count = int(total_groups * config.val_ratio) if (total_groups >= 10 and config.val_ratio > 0) else 0
    val_count = min(val_count, max(0, total_groups - 1))

    primary_train_groups = sorted_groups[: total_groups - val_count] if val_count > 0 else list(sorted_groups)
    val_groups = sorted_groups[total_groups - val_count :] if val_count > 0 else []

    all_users = set(dataset.unique_users)
    all_posts = set(dataset.unique_posts)

    # 可选仅训练回放锚点数据：严格只混入 train_groups，避免污染主验证集分布
    train_groups = list(primary_train_groups)
    aux_groups_used = 0
    if config.aux_samples_path is not None:
        aux_dataset = PhoenixV2Dataset(
            Path(config.aux_samples_path),
            max_history=config.max_history,
            max_candidates=config.max_candidates,
        )
        aux_groups = list(aux_dataset.groups)
        if config.aux_sample_max_groups > 0 and len(aux_groups) > config.aux_sample_max_groups:
            aux_groups = random.Random(config.seed).sample(aux_groups, config.aux_sample_max_groups)
        train_groups.extend(aux_groups)
        aux_groups_used = len(aux_groups)
        all_users |= aux_dataset.unique_users
        all_posts |= aux_dataset.unique_posts

    unbiased_eval_groups: List[Dict[str, Any]] = []
    if config.eval_samples_path is not None:
        eval_dataset = PhoenixV2Dataset(
            Path(config.eval_samples_path),
            max_history=config.max_history,
            max_candidates=config.max_candidates,
        )
        if len(eval_dataset) == 0:
            raise ValueError(f"显式评估数据集为空: {config.eval_samples_path}")
        unbiased_eval_groups = list(eval_dataset.groups)

    class _GroupSliceDataset(Dataset):
        def __init__(self, items: Sequence[Dict[str, Any]]):
            self.items = list(items)

        def __len__(self) -> int:
            return len(self.items)

        def __getitem__(self, idx: int) -> Dict[str, Any]:
            return self.items[idx]

    collate = lambda b: collate_phoenix_v2_batch(
        b,
        max_history=config.max_history,
        max_candidates=config.max_candidates,
    )
    loader_kwargs: Dict[str, Any] = {
        "batch_size": config.batch_size,
        "num_workers": config.num_workers,
        "pin_memory": device.type == "cuda",
        "collate_fn": collate,
    }
    if config.num_workers > 0:
        loader_kwargs["persistent_workers"] = True
        loader_kwargs["prefetch_factor"] = 2

    train_loader = DataLoader(_GroupSliceDataset(train_groups), shuffle=True, **loader_kwargs)
    val_loader = DataLoader(_GroupSliceDataset(val_groups), shuffle=False, **loader_kwargs) if val_groups else None
    unbiased_eval_loader = (
        DataLoader(_GroupSliceDataset(unbiased_eval_groups), shuffle=False, **loader_kwargs)
        if unbiased_eval_groups
        else None
    )

    model = _select_model(config, len(all_users), len(all_posts))
    init_summary: Optional[Dict[str, Any]] = None
    if config.init_from is not None:
        init_summary = _load_pretrained_weights(
            model,
            Path(config.init_from),
            reset_id_hashes=config.reset_id_hash_embeddings_on_init,
        )
    model = model.to(device)

    param_groups = _build_optimizer_param_groups(
        model,
        lr=config.lr,
        backbone_lr_scale=config.backbone_lr_scale,
    )
    optimizer = optim.AdamW(param_groups, lr=config.lr, weight_decay=config.weight_decay)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(1, config.epochs))

    use_amp = device.type == "cuda"
    amp_dtype = torch.bfloat16 if (use_amp and torch.cuda.is_bf16_supported()) else torch.float16
    scaler = torch.amp.GradScaler("cuda", enabled=(use_amp and amp_dtype == torch.float16))

    gpu_info: Optional[Dict[str, Any]] = None
    if device.type == "cuda":
        props = torch.cuda.get_device_properties(0)
        gpu_info = {
            "name": props.name,
            "totalMemoryGb": round(float(props.total_memory) / (1024.0**3), 2),
        }

    history_metrics: List[Dict[str, Any]] = []
    latest_path = models_dir / "phoenix_v2_epoch_latest.pt"
    best_val_loss = float("inf")
    best_unbiased_metrics: Optional[Dict[str, Any]] = None

    for epoch in range(config.epochs):
        model.train()
        total_loss = 0.0
        steps = 0

        pbar = tqdm(train_loader, desc=f"PhoenixV2 Epoch {epoch + 1}/{config.epochs}")
        for batch in pbar:
            if config.max_steps_per_epoch > 0 and steps >= config.max_steps_per_epoch:
                break

            optimizer.zero_grad(set_to_none=True)
            cand_mask = batch["candidate_mask"].to(device, non_blocking=True)
            labels_dev = {a: batch["labels"][a].to(device, non_blocking=True) for a in PREDICTED_ACTIONS}
            dwell_dev = batch["dwell_target"].to(device, non_blocking=True)

            autocast_ctx = torch.amp.autocast("cuda", dtype=amp_dtype) if use_amp else nullcontext()
            with autocast_ctx:
                outputs = model(
                    batch["user_ids"].to(device, non_blocking=True),
                    batch["history_post_ids"].to(device, non_blocking=True),
                    batch["history_author_ids"].to(device, non_blocking=True),
                    batch["history_action_types"].to(device, non_blocking=True),
                    batch["history_mask"].to(device, non_blocking=True),
                    batch["candidate_post_ids"].to(device, non_blocking=True),
                    batch["candidate_author_ids"].to(device, non_blocking=True),
                    cand_mask,
                    history_time_buckets=batch["history_time_buckets"].to(device, non_blocking=True),
                    candidate_in_network=batch["candidate_in_network"].to(device, non_blocking=True),
                    candidate_has_video=batch["candidate_has_video"].to(device, non_blocking=True),
                )
                loss = _compute_multitask_loss(
                    outputs,
                    labels_dev,
                    cand_mask,
                    dwell_dev,
                    config.dwell_loss_weight,
                )

            if scaler.is_enabled():
                scaler.scale(loss).backward()
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(optimizer)
                scaler.update()
            else:
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()

            steps += 1
            total_loss += float(loss.item())
            pbar.set_postfix({"loss": f"{loss.item():.4f}"})

        scheduler.step()
        train_loss = total_loss / max(1, steps)
        val_metrics = _evaluate_validation(model, val_loader, device, config.dwell_loss_weight)
        unbiased_metrics = _evaluate_validation(model, unbiased_eval_loader, device, config.dwell_loss_weight)

        effective_eval = val_metrics or unbiased_metrics
        epoch_record: Dict[str, Any] = {
            "epoch": epoch + 1,
            "trainLoss": round(train_loss, 6),
        }
        if effective_eval:
            epoch_record["valLoss"] = round(float(effective_eval["valLoss"]), 6)
            epoch_record["macroRocAuc"] = (
                round(float(effective_eval["macroRocAuc"]), 6) if effective_eval["macroRocAuc"] is not None else None
            )
        if unbiased_metrics:
            epoch_record["unbiasedEvalLoss"] = round(float(unbiased_metrics["valLoss"]), 6)
            epoch_record["unbiasedMacroRocAuc"] = (
                round(float(unbiased_metrics["macroRocAuc"]), 6)
                if unbiased_metrics["macroRocAuc"] is not None
                else None
            )
        history_metrics.append(epoch_record)

        epoch_path = models_dir / f"phoenix_v2_epoch_{epoch + 1}.pt"
        torch.save(model.state_dict(), epoch_path)
        selection_loss = float(effective_eval["valLoss"]) if effective_eval else train_loss
        if not effective_eval or selection_loss <= best_val_loss:
            best_val_loss = selection_loss
            best_unbiased_metrics = unbiased_metrics
            shutil.copyfile(epoch_path, latest_path)

    # 导出标准 CPU float32 推理权重与模型结构配置
    cpu_model = _select_model(config, len(all_users), len(all_posts)).cpu()
    cpu_model.load_state_dict(torch.load(latest_path, map_location="cpu", weights_only=True))
    cpu_model.eval()

    inference_path = models_dir / "phoenix_v2_inference.pt"
    config_path = models_dir / "phoenix_v2_config.json"
    torch.save(cpu_model.state_dict(), inference_path)
    cpu_model.save_config(config_path)

    bench = _benchmark_cpu_inference(cpu_model, config.max_history, config.max_candidates)
    total_params = sum(p.numel() for p in cpu_model.parameters())

    unbiased_eval_summary: Optional[Dict[str, Any]] = None
    if unbiased_eval_loader is not None:
        final_unbiased = best_unbiased_metrics or _evaluate_validation(
            cpu_model,
            DataLoader(_GroupSliceDataset(unbiased_eval_groups), shuffle=False, batch_size=config.batch_size, collate_fn=collate),
            torch.device("cpu"),
            config.dwell_loss_weight,
        )
        if final_unbiased:
            unbiased_eval_summary = {
                "numGroups": len(unbiased_eval_groups),
                "valLoss": round(float(final_unbiased["valLoss"]), 6),
                "macroRocAuc": (
                    round(float(final_unbiased["macroRocAuc"]), 6)
                    if final_unbiased["macroRocAuc"] is not None
                    else None
                ),
            }

    report = {
        "model": "phoenix_v2",
        "device": str(device),
        "gpuInfo": gpu_info,
        "scale": config.scale,
        "checkpointRole": config.checkpoint_role,
        "initFrom": str(config.init_from) if config.init_from else None,
        "initSummary": init_summary,
        "resetIdHashesOnInit": bool(config.reset_id_hash_embeddings_on_init),
        "backboneLrScale": float(config.backbone_lr_scale),
        "evalSamplesPath": str(config.eval_samples_path) if config.eval_samples_path else None,
        "auxSamplesPath": str(config.aux_samples_path) if config.aux_samples_path else None,
        "auxGroupsUsed": aux_groups_used,
        "unbiasedEval": unbiased_eval_summary,
        "modelConfig": cpu_model.export_config(),
        "totalParams": int(total_params),
        "numGroups": total_groups,
        "trainGroups": len(train_groups),
        "valGroups": len(val_groups),
        "epochs": history_metrics,
        "cpuBenchmark": bench,
        "latestModelPath": str(latest_path),
        "inferenceModelPath": str(inference_path),
        "configPath": str(config_path),
    }
    report_path = models_dir / "phoenix_v2_train_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train Phoenix V2 multi-task ranking model")
    parser.add_argument("--data-dir", type=Path, default=_DEFAULT_ML_DIR / "data")
    parser.add_argument("--models-dir", type=Path, default=_DEFAULT_ML_DIR / "models")
    parser.add_argument("--samples", type=Path, default=None)
    parser.add_argument("--eval-samples", type=Path, default=None)
    parser.add_argument("--aux-samples", type=Path, default=None)
    parser.add_argument("--aux-max-groups", type=int, default=0)
    parser.add_argument("--init-from", type=Path, default=None)
    parser.add_argument("--reset-id-hashes", action="store_true")
    parser.add_argument("--backbone-lr-scale", type=float, default=1.0)
    parser.add_argument("--checkpoint-role", choices=["serving", "pretrain_only"], default="serving")
    parser.add_argument("--scale", choices=["auto", "mini", "medium"], default="auto")
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-2)
    parser.add_argument("--max-history", type=int, default=64)
    parser.add_argument("--max-candidates", type=int, default=32)
    parser.add_argument("--val-ratio", type=float, default=0.1)
    parser.add_argument("--dwell-loss-weight", type=float, default=0.5)
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--max-steps-per-epoch", type=int, default=0)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    cfg = PhoenixV2TrainConfig(
        data_dir=args.data_dir,
        models_dir=args.models_dir,
        samples_path=args.samples,
        eval_samples_path=args.eval_samples,
        aux_samples_path=args.aux_samples,
        aux_sample_max_groups=args.aux_max_groups,
        init_from=args.init_from,
        reset_id_hash_embeddings_on_init=args.reset_id_hashes,
        backbone_lr_scale=args.backbone_lr_scale,
        checkpoint_role=args.checkpoint_role,
        scale=args.scale,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        weight_decay=args.weight_decay,
        max_history=args.max_history,
        max_candidates=args.max_candidates,
        val_ratio=args.val_ratio,
        dwell_loss_weight=args.dwell_loss_weight,
        num_workers=args.num_workers,
        max_steps_per_epoch=args.max_steps_per_epoch,
        seed=args.seed,
    )
    report = train_phoenix_v2(cfg)
    print(json.dumps(report, ensure_ascii=False, indent=2))
