"""Phoenix 推理适配器：统一调度 Phoenix V1 与 Phoenix V2 多任务排序模型。"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import math
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import torch

from recsys.contracts.actions import ACTION_TYPE_MAP, PREDICTED_ACTIONS, canonicalize_action_name
from recsys.data.pit_export import compute_time_bucket
from recsys.models.phoenix_v2 import PhoenixV2Ranker, stable_id_hash


def _clamp01(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return float(value)


def is_phoenix_v2_model(model: Any) -> bool:
    """判断当前挂载的排序模型是否为 Phoenix V2 架构。"""
    return isinstance(model, PhoenixV2Ranker)


def resolve_phoenix_max_candidates(model: Any, phoenix_max_history: int = 50) -> int:
    """统一返回当前 Phoenix 模型单批安全容纳的最大候选数。"""
    if isinstance(model, PhoenixV2Ranker):
        return max(1, int(model.max_candidates))
    try:
        max_seq = int(getattr(getattr(model, "position_embedding", None), "num_embeddings", 512))
    except Exception:
        max_seq = 512
    return max(1, max_seq - int(phoenix_max_history))


def load_phoenix_model(
    *,
    models_dir: Path,
    scripts_dir: Path,
    news_vocab: Mapping[str, int],
    device: torch.device,
    artifact_profile: str = "full",
    v1_checkpoint_path: Optional[Path] = None,
    embedding_dim: int = 128,
    num_heads: int = 4,
    num_layers: int = 4,
) -> Tuple[Any, str, Path]:
    """
    按 profile 与本地可用权重自动加载 Phoenix V2 或 V1 模型：
      - ARTIFACT_PROFILE=phoenix-v2 强制加载 Phoenix V2（phoenix_v2_inference.pt + phoenix_v2_config.json）
      - ARTIFACT_PROFILE=full 时若本地已齐备 V2 推理包则优先启用 V2，否则回退至 V1
    """
    import sys

    v2_weights = models_dir / "phoenix_v2_inference.pt"
    if not v2_weights.exists():
        v2_weights = models_dir / "phoenix_v2_epoch_latest.pt"
    v2_config_path = models_dir / "phoenix_v2_config.json"

    use_v2 = artifact_profile == "phoenix-v2" or (
        artifact_profile == "full" and v2_weights.exists() and v2_config_path.exists()
    )

    if use_v2:
        if not v2_weights.exists():
            raise FileNotFoundError(f"Phoenix V2 weights not found in {models_dir}")
        cfg: Dict[str, Any] = {}
        if v2_config_path.exists():
            cfg = json.loads(v2_config_path.read_text(encoding="utf-8"))
        model = PhoenixV2Ranker(
            dim=int(cfg.get("dim", 128)),
            num_heads=int(cfg.get("num_heads", 4)),
            num_layers=int(cfg.get("num_layers", 4)),
            max_history_len=int(cfg.get("max_history_len", 64)),
            max_candidates=int(cfg.get("max_candidates", 32)),
            num_hashes=int(cfg.get("num_hashes", 2)),
        ).to(device)
        model.load_state_dict(torch.load(v2_weights, map_location=device, weights_only=True))
        model.eval()
        return model, "v2", v2_weights

    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    from phoenix_model import PhoenixRanker

    if v1_checkpoint_path is None or not v1_checkpoint_path.exists():
        raise FileNotFoundError(f"Phoenix V1 model not found: {v1_checkpoint_path}")

    model = PhoenixRanker(
        num_news=len(news_vocab),
        embedding_dim=embedding_dim,
        num_heads=num_heads,
        num_layers=num_layers,
    ).to(device)
    model.load_state_dict(torch.load(v1_checkpoint_path, map_location=device, weights_only=True))
    model.eval()
    return model, "v1", v1_checkpoint_path


def _parse_action_ts(raw_ts: Any) -> Optional[float]:
    if isinstance(raw_ts, datetime):
        dt = raw_ts if raw_ts.tzinfo else raw_ts.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    if isinstance(raw_ts, (int, float)) and not isinstance(raw_ts, bool):
        val = float(raw_ts)
        return val / 1000.0 if val > 1e12 else val
    if isinstance(raw_ts, str) and raw_ts.strip():
        try:
            dt = datetime.fromisoformat(raw_ts.strip().replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp()
        except Exception:
            return None
    return None


def apply_platt_calibration(action: str, raw_prob: float, calibrator: Optional[Mapping[str, Any]]) -> float:
    """按 weighted_calibrator.json 对单动作概率执行安全 Platt 校准。"""
    p = _clamp01(raw_prob)
    if not calibrator:
        return p
    actions = calibrator.get("actions") if isinstance(calibrator, Mapping) else None
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


def _predict_v2(
    model: PhoenixV2Ranker,
    *,
    user_id: str,
    user_action_sequence: Optional[Sequence[Mapping[str, Any]]],
    candidates: Sequence[Any],
    device: torch.device,
    calibrator: Optional[Mapping[str, Any]] = None,
) -> List[Dict[str, Any]]:
    if not candidates:
        return []

    now_sec = datetime.now(timezone.utc).timestamp()
    max_hist = max(1, int(model.max_history_len))
    raw_seq = list(user_action_sequence or [])[-max_hist:]

    hist_posts: List[int] = []
    hist_authors: List[int] = []
    hist_actions: List[int] = []
    hist_buckets: List[int] = []
    hist_mask: List[int] = []

    for idx, act in enumerate(raw_seq):
        if not isinstance(act, Mapping):
            continue
        pid = act.get("targetPostId") or act.get("modelPostId") or act.get("postId")
        aid = act.get("targetAuthorId") or act.get("authorId")
        act_name = canonicalize_action_name(str(act.get("action") or act.get("actionType") or "click"))
        act_id = ACTION_TYPE_MAP.get(act_name, ACTION_TYPE_MAP["click"])
        parsed_ts = _parse_action_ts(act.get("timestamp") or act.get("actionTime"))
        if parsed_ts is not None:
            bucket = compute_time_bucket(max(0.0, now_sec - parsed_ts))
        else:
            # 无时间戳时按倒序距离构造单调退化分桶
            rev_pos = max(0, len(raw_seq) - 1 - idx)
            bucket = min(15, rev_pos)

        hist_posts.append(stable_id_hash(pid))
        hist_authors.append(stable_id_hash(aid))
        hist_actions.append(act_id)
        hist_buckets.append(bucket)
        hist_mask.append(1)

    if not hist_posts:
        hist_posts, hist_authors, hist_actions, hist_buckets, hist_mask = [0], [0], [0], [15], [0]

    user_t = torch.tensor([stable_id_hash(user_id)], dtype=torch.long, device=device)
    hist_post_t = torch.tensor([hist_posts], dtype=torch.long, device=device)
    hist_auth_t = torch.tensor([hist_authors], dtype=torch.long, device=device)
    hist_act_t = torch.tensor([hist_actions], dtype=torch.long, device=device)
    hist_bkt_t = torch.tensor([hist_buckets], dtype=torch.long, device=device)
    hist_mask_t = torch.tensor([hist_mask], dtype=torch.long, device=device)

    predictions: List[Dict[str, Any]] = []
    chunk_size = max(1, int(model.max_candidates))

    with torch.no_grad():
        for start in range(0, len(candidates), chunk_size):
            chunk = candidates[start : start + chunk_size]
            cand_posts = [stable_id_hash(getattr(c, "postId", None)) for c in chunk]
            cand_authors = [stable_id_hash(getattr(c, "authorId", None)) for c in chunk]
            cand_in_net = [1 if bool(getattr(c, "inNetwork", False)) else 0 for c in chunk]
            cand_has_video = [1 if bool(getattr(c, "hasVideo", False)) else 0 for c in chunk]
            cand_mask = [1] * len(chunk)

            outputs = model(
                user_t,
                hist_post_t,
                hist_auth_t,
                hist_act_t,
                hist_mask_t,
                torch.tensor([cand_posts], dtype=torch.long, device=device),
                torch.tensor([cand_authors], dtype=torch.long, device=device),
                torch.tensor([cand_mask], dtype=torch.long, device=device),
                history_time_buckets=hist_bkt_t,
                candidate_in_network=torch.tensor([cand_in_net], dtype=torch.long, device=device),
                candidate_has_video=torch.tensor([cand_has_video], dtype=torch.long, device=device),
            )

            probs_by_action: Dict[str, List[float]] = {
                act: torch.sigmoid(outputs[act].float()).cpu().numpy()[0].tolist()
                for act in PREDICTED_ACTIONS
                if act in outputs
            }
            dwell_cont = (
                torch.sigmoid(outputs["dwell_time"].float()).cpu().numpy()[0].tolist()
                if "dwell_time" in outputs
                else probs_by_action.get("dwell", [0.0] * len(chunk))
            )

            for i, cand in enumerate(chunk):
                def _p(act: str) -> float:
                    raw = float(probs_by_action.get(act, [0.0] * len(chunk))[i])
                    return apply_platt_calibration(act, raw, calibrator)

                click = _p("click")
                like = _p("like")
                reply = _p("reply")
                repost = _p("repost")
                quote = _p("quote")
                share = _p("share")
                dwell = _p("dwell")
                video_view = _p("video_view")
                follow_author = _p("follow_author")
                not_interested = _p("not_interested")
                block_author = _p("block_author")
                mute_author = _p("mute_author")
                report = _p("report")
                dwell_time = _clamp01(float(dwell_cont[i]))

                has_video = bool(getattr(cand, "hasVideo", False))
                video_dur = getattr(cand, "videoDurationSec", None)
                try:
                    vqv = _clamp01(video_view) if (has_video and video_dur is not None and float(video_dur) > 5.0) else 0.0
                except Exception:
                    vqv = 0.0

                predictions.append(
                    {
                        "postId": str(getattr(cand, "postId", "")),
                        "click": click,
                        "like": like,
                        "reply": reply,
                        "repost": repost,
                        "quote": quote,
                        "quotedClick": _clamp01(click * 0.25 + quote * 0.50),
                        "photoExpand": _clamp01(click * 0.35),
                        "profileClick": _clamp01(click * 0.20 + follow_author * 0.60),
                        "share": share,
                        "shareViaDm": _clamp01(share * 0.35),
                        "shareViaCopyLink": _clamp01(share * 0.30),
                        "dwell": dwell,
                        "videoQualityView": vqv,
                        "dwellTime": dwell_time,
                        "followAuthor": follow_author,
                        "notInterested": not_interested,
                        "blockAuthor": block_author,
                        "muteAuthor": mute_author,
                        "report": report,
                        "dismiss": not_interested,
                        "block": block_author,
                    }
                )

    return predictions


def _predict_v1(
    model: Any,
    *,
    user_action_sequence: Optional[Sequence[Mapping[str, Any]]],
    candidates: Sequence[Any],
    news_vocab: Mapping[str, int],
    device: torch.device,
    phoenix_max_history: int = 50,
    calibrator: Optional[Mapping[str, Any]] = None,
) -> List[Dict[str, Any]]:
    unk_idx = int(news_vocab.get("<UNK>", 1))
    history_ids: List[str] = []
    if user_action_sequence:
        for action in user_action_sequence:
            if isinstance(action, Mapping) and "targetPostId" in action:
                history_ids.append(str(action["targetPostId"]))

    history_indices = [news_vocab.get(nid, unk_idx) for nid in history_ids]
    if len(history_indices) > phoenix_max_history:
        history_indices = history_indices[-phoenix_max_history:]
    else:
        history_indices = history_indices + [0] * (phoenix_max_history - len(history_indices))

    max_candidates = resolve_phoenix_max_candidates(model, phoenix_max_history)
    payload_candidates = list(candidates)[:max_candidates]
    candidate_ids = [str(getattr(c, "postId", "")) for c in payload_candidates]
    if not candidate_ids:
        return []
    candidate_indices = [news_vocab.get(nid, unk_idx) for nid in candidate_ids]

    history_tensor = torch.tensor([history_indices], dtype=torch.long, device=device)
    candidate_tensor = torch.tensor([candidate_indices], dtype=torch.long, device=device)

    with torch.no_grad():
        outputs = model(history_tensor, candidate_tensor)
        click_probs = torch.sigmoid(outputs["click"]).cpu().numpy()[0]
        like_probs = torch.sigmoid(outputs["like"]).cpu().numpy()[0]
        reply_probs = torch.sigmoid(outputs["reply"]).cpu().numpy()[0]
        repost_probs = torch.sigmoid(outputs["repost"]).cpu().numpy()[0]

    predictions: List[Dict[str, Any]] = []
    for i, cid in enumerate(candidate_ids):
        cand = payload_candidates[i]
        in_net = bool(getattr(cand, "inNetwork", False))
        has_video = bool(getattr(cand, "hasVideo", False))
        video_dur = getattr(cand, "videoDurationSec", None)

        click = apply_platt_calibration("click", float(click_probs[i]), calibrator)
        like = apply_platt_calibration("like", float(like_probs[i]), calibrator)
        reply = apply_platt_calibration("reply", float(reply_probs[i]), calibrator)
        repost = apply_platt_calibration("repost", float(repost_probs[i]), calibrator)

        quote = _clamp01(repost * 0.25)
        profile_click = _clamp01(click * 0.15)
        share = _clamp01(repost * 0.20 + like * 0.10 + click * 0.05)
        share_via_dm = _clamp01(share * 0.25)
        share_via_copy = _clamp01(share * 0.20)
        photo_expand = _clamp01(click * 0.10)
        quoted_click = _clamp01(click * 0.10)
        dwell = _clamp01(click * 0.20 + 0.02)
        dwell_time = _clamp01(dwell)
        follow_author = _clamp01(like * 0.03 + reply * 0.02)

        not_interested = _clamp01(0.02 + (0.01 if (not in_net) else 0.0) + (0.02 if click < 0.05 else 0.0))
        block_author = _clamp01(0.001 + (0.001 if (not in_net) else 0.0) + (0.001 if not_interested > 0.04 else 0.0))
        mute_author = _clamp01(0.002 + (0.001 if (not in_net) else 0.0))
        report = _clamp01(0.0005 + (0.0005 if (not in_net) else 0.0))

        vqv = 0.0
        try:
            if has_video and video_dur is not None and float(video_dur) > 5.0:
                vqv = _clamp01(click * 0.20)
        except Exception:
            vqv = 0.0

        predictions.append(
            {
                "postId": cid,
                "click": click,
                "like": like,
                "reply": reply,
                "repost": repost,
                "quote": quote,
                "quotedClick": quoted_click,
                "photoExpand": photo_expand,
                "profileClick": profile_click,
                "share": share,
                "shareViaDm": share_via_dm,
                "shareViaCopyLink": share_via_copy,
                "dwell": dwell,
                "videoQualityView": vqv,
                "dwellTime": dwell_time,
                "followAuthor": follow_author,
                "notInterested": not_interested,
                "blockAuthor": block_author,
                "muteAuthor": mute_author,
                "report": report,
                "dismiss": not_interested,
                "block": block_author,
            }
        )

    return predictions


def predict_with_phoenix(
    model: Any,
    *,
    user_id: str,
    user_action_sequence: Optional[Sequence[Mapping[str, Any]]],
    candidates: Sequence[Any],
    news_vocab: Mapping[str, int],
    device: torch.device,
    phoenix_max_history: int = 50,
    calibrator: Optional[Mapping[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """根据当前已加载模型架构自动分派 V2 或 V1 推理路径并返回标准化预测结果。"""
    if is_phoenix_v2_model(model):
        return _predict_v2(
            model,
            user_id=user_id,
            user_action_sequence=user_action_sequence,
            candidates=candidates,
            device=device,
            calibrator=calibrator,
        )
    return _predict_v1(
        model,
        user_action_sequence=user_action_sequence,
        candidates=candidates,
        news_vocab=news_vocab,
        device=device,
        phoenix_max_history=phoenix_max_history,
        calibrator=calibrator,
    )
