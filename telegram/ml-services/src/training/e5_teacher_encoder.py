"""Stage 1 多语言 `intfloat/multilingual-e5-base` 教师语义编码与多模态特征对齐投影模块。"""

from __future__ import annotations

import hashlib
from typing import Dict, List, Mapping, Optional, Sequence

import numpy as np
import torch


def deterministic_semantic_projection(
    texts: Sequence[str],
    *,
    dim: int = 256,
    seed: int = 42,
) -> np.ndarray:
    """无外网或纯单测离线回退路径：构建稳定的字符 n-gram 随机投影归一化向量。"""
    _ = seed
    n = len(texts)
    if n == 0:
        return np.zeros((0, dim), dtype=np.float32)
    mat = np.zeros((n, dim), dtype=np.float32)
    for row_idx, raw in enumerate(texts):
        s = str(raw or "").lower().strip()
        if not s:
            mat[row_idx, 0] = 1.0
            continue
        # 融合 unigram 与 trigram 确定性哈希投影，保持无网络环境下同主题短文本余弦结构
        tokens = s.split()
        grams: List[str] = list(tokens)
        for ch_i in range(len(s)):
            grams.append(s[ch_i : ch_i + 3])
        if not grams:
            grams = [s]
        for g in grams[:128]:
            h = int.from_bytes(hashlib.blake2b(g.encode("utf-8"), digest_size=8).digest(), "little")
            col = h % dim
            sign = 1.0 if ((h >> 8) & 1) == 0 else -1.0
            mat[row_idx, col] += sign
    norms = np.linalg.norm(mat, axis=1, keepdims=True) + 1e-12
    return (mat / norms).astype(np.float32)


def project_embeddings_orthogonal(
    raw_embs: np.ndarray,
    *,
    dim: int = 256,
    seed: int = 42,
) -> np.ndarray:
    """将高维语义向量通过主成分正交基或确定性正交矩阵压缩至 `dim` 维并做 L2 归一化。"""
    arr = np.asarray(raw_embs, dtype=np.float32)
    if arr.ndim != 2:
        raise ValueError(f"expected 2D embeddings, got shape {arr.shape}")
    n, src_dim = arr.shape
    if n == 0:
        return np.zeros((0, dim), dtype=np.float32)

    if src_dim == dim:
        projected = arr.copy()
    elif src_dim > dim and n >= dim:
        # 中心化后执行紧凑 SVD 取主成分，最大化保留 768d e5-base 的语义方差
        centered = arr - np.mean(arr, axis=0, keepdims=True)
        _, _, vt = np.linalg.svd(centered, full_matrices=False)
        proj_basis = vt[:dim].T  # (src_dim, dim)
        projected = centered @ proj_basis
    else:
        rng = np.random.default_rng(seed)
        rand_mat = rng.standard_normal((src_dim, max(src_dim, dim))).astype(np.float32)
        q_mat, _ = np.linalg.qr(rand_mat)
        projected = arr @ q_mat[:, :dim]

    norms = np.linalg.norm(projected, axis=1, keepdims=True)
    # 极端全零向量安全兜底为单位基向量
    zero_mask = (norms[:, 0] < 1e-12)
    if np.any(zero_mask):
        projected[zero_mask, 0] = 1.0
        norms = np.linalg.norm(projected, axis=1, keepdims=True)
    return (projected / (norms + 1e-12)).astype(np.float32)


def encode_texts_with_hf_e5(
    texts: Sequence[str],
    *,
    model_name: str = "intfloat/multilingual-e5-base",
    dim: int = 256,
    batch_size: int = 256,
    max_length: int = 128,
    device: Optional[str] = None,
    allow_fallback: bool = True,
) -> tuple[np.ndarray, Dict[str, object]]:
    """使用 `intfloat/multilingual-e5-base` 在 GPU/CPU 上分批提取 768d 语义向量并降维至 `dim` 维。"""
    n = len(texts)
    if n == 0:
        return np.zeros((0, dim), dtype=np.float32), {"backend": "empty", "model_name": model_name, "fallback": False}

    target_device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    try:
        from transformers import AutoModel, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(model_name)
        model = AutoModel.from_pretrained(model_name).to(target_device)
        model.eval()
    except Exception as exc:
        if not allow_fallback:
            raise RuntimeError(f"failed to load HuggingFace E5 model '{model_name}': {exc}") from exc
        print(
            f"[e5-encoder] fallback to deterministic projection because loading '{model_name}' failed: {exc}",
            flush=True,
        )
        return deterministic_semantic_projection(texts, dim=dim), {
            "backend": "deterministic_fallback",
            "model_name": model_name,
            "fallback": True,
            "reason": str(exc),
        }

    # 按 E5 论文规范为语料文本统一添加 passage 前缀
    prefixed = [f"passage: {str(t or '').strip() or 'empty'}" for t in texts]
    chunks: List[np.ndarray] = []
    use_amp = target_device.type == "cuda"
    amp_dtype = torch.bfloat16 if (use_amp and torch.cuda.is_bf16_supported()) else torch.float16

    with torch.inference_mode():
        for start in range(0, n, max(1, int(batch_size))):
            batch_texts = prefixed[start : start + max(1, int(batch_size))]
            encoded = tokenizer(
                batch_texts,
                padding=True,
                truncation=True,
                max_length=max_length,
                return_tensors="pt",
            ).to(target_device)
            if use_amp:
                with torch.amp.autocast("cuda", dtype=amp_dtype):
                    outputs = model(**encoded)
            else:
                outputs = model(**encoded)

            last_hidden = outputs.last_hidden_state.float()
            mask = encoded["attention_mask"].unsqueeze(-1).expand(last_hidden.size()).float()
            summed = (last_hidden * mask).sum(dim=1)
            counts = mask.sum(dim=1).clamp_min(1e-9)
            pooled = summed / counts
            pooled = torch.nn.functional.normalize(pooled, p=2, dim=-1)
            chunks.append(pooled.cpu().numpy().astype(np.float32))

    # 及时释放教师大模型显存供后续 RQ-VAE / Two-Tower / Phoenix 使用
    raw_dim = int(chunks[0].shape[1]) if chunks else 768
    del model
    if target_device.type == "cuda":
        torch.cuda.empty_cache()

    full_raw = np.concatenate(chunks, axis=0)
    projected = project_embeddings_orthogonal(full_raw, dim=dim)
    return projected, {
        "backend": "hf_e5",
        "model_name": model_name,
        "raw_dim": raw_dim,
        "target_dim": int(dim),
        "encoded_count": int(n),
        "fallback": False,
    }


def align_and_blend_multimodal_embeddings(
    base_embs: np.ndarray,
    post_ids: Sequence[str],
    *,
    multimodal_post_vectors: Optional[Mapping[str, np.ndarray]] = None,
    text_weight: float = 0.72,
) -> tuple[np.ndarray, int]:
    """将文本向量与 MicroLens 等多模态视觉特征在共同 L2 球面上加权融合。"""
    out = np.asarray(base_embs, dtype=np.float32).copy()
    if not multimodal_post_vectors or out.shape[0] == 0:
        return out, 0

    dim = int(out.shape[1])
    w_txt = float(np.clip(text_weight, 0.05, 0.95))
    w_mm = 1.0 - w_txt
    blended_count = 0

    for idx, pid in enumerate(post_ids):
        mm_raw = multimodal_post_vectors.get(str(pid))
        if mm_raw is None:
            continue
        vec = np.asarray(mm_raw, dtype=np.float32).reshape(-1)
        if vec.shape[0] != dim:
            continue
        mm_norm = float(np.linalg.norm(vec))
        if mm_norm < 1e-12:
            continue
        unit_mm = vec / mm_norm
        combined = w_txt * out[idx] + w_mm * unit_mm
        c_norm = float(np.linalg.norm(combined))
        if c_norm >= 1e-12:
            out[idx] = (combined / c_norm).astype(np.float32)
            blended_count += 1

    return out, blended_count
