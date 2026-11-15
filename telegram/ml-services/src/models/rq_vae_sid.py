"""6x256 Semantic ID (RQ-KMeans / RQ-VAE + EMA 死码复活 + SidEntityEmbedder + 蒸馏文本编码器)。

严格对标 x-algorithm `sid_codebook.py` / `sid_io.py` / `recsys_sid.py` 架构规范，
所有模块前向计算均保持纯标准张量算子以兼容 `opset_version=17, dynamo=False` ONNX 导出与 INT8 量化。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from src.contracts.sid import SID_CODEBOOK_SIZE, SID_NUM_LEVELS, validate_wire_sids
from src.onnx_runtime.text_encoder_ort import SidCodebookQuantizer, simple_byte_ngram_tokenize


@dataclass
class RQVaeArtifact:
    """6x256 RQ-VAE / RQ-KMeans 可序列化码本与可选编解码 MLP 参数包。"""

    stages: np.ndarray  # float32 (L, K, D_latent)
    enc_params: Optional[Dict[str, np.ndarray]] = None
    dec_params: Optional[Dict[str, np.ndarray]] = None
    model_type: str = "rqvae"
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_quantizer(self) -> SidCodebookQuantizer:
        """转换为纯 NumPy 在线推理量化器。"""
        return SidCodebookQuantizer(
            self.stages,
            enc_params=self.enc_params,
            dec_params=self.dec_params,
        )


def _sample_initial_centroids(
    residuals: np.ndarray,
    codebook_size: int,
    rng: np.random.Generator,
    *,
    kmeans_pp: bool = True,
) -> np.ndarray:
    """稳健选取 K-Means 初始质心，兼容 N < codebook_size 小样本场景避免 replace=False 崩溃。"""
    n, dim = residuals.shape
    if n == 0:
        return rng.normal(0.0, 0.02, size=(codebook_size, dim)).astype(np.float32)

    if n < codebook_size:
        indices = rng.choice(n, size=codebook_size, replace=True)
        centroids = residuals[indices].astype(np.float32).copy()
        # 对重复采样的微小数据集叠加轻微扰动，保证死码可分
        noise_scale = max(1e-4, float(np.std(residuals)) * 0.05)
        centroids += rng.normal(0.0, noise_scale, size=centroids.shape).astype(np.float32)
        return centroids

    if not kmeans_pp or n > 8192:
        # 大样本优先使用均匀随机选点，兼具 O(K*D) 低开销与良好初期分散性
        indices = rng.choice(n, size=codebook_size, replace=False)
        return residuals[indices].astype(np.float32).copy()

    # K-Means++ 分层距离采样初始化
    centroids = np.empty((codebook_size, dim), dtype=np.float32)
    first_idx = int(rng.integers(0, n))
    centroids[0] = residuals[first_idx]
    min_sq_dist = np.sum((residuals - centroids[0]) ** 2, axis=1)
    for k in range(1, codebook_size):
        total = float(np.sum(min_sq_dist))
        if total <= 1e-12:
            pick = int(rng.integers(0, n))
        else:
            probs = np.maximum(min_sq_dist / total, 0.0)
            probs /= float(np.sum(probs))
            pick = int(rng.choice(n, p=probs))
        centroids[k] = residuals[pick]
        dist_k = np.sum((residuals - centroids[k]) ** 2, axis=1)
        min_sq_dist = np.minimum(min_sq_dist, dist_k)
    return centroids


def train_rq_kmeans(
    embeddings: np.ndarray,
    *,
    num_levels: int = SID_NUM_LEVELS,
    codebook_size: int = SID_CODEBOOK_SIZE,
    iters: int = 20,
    seed: int = 42,
    kmeans_pp: bool = True,
) -> Tuple[np.ndarray, np.ndarray]:
    """多层残差 K-Means 码本训练（可直接独立产出轻量码本或为 RQ-VAE 提供高质量初始态）。"""
    arr = np.asarray(embeddings, dtype=np.float32)
    if arr.ndim != 2:
        raise ValueError(f"expected 2D embeddings matrix, got {arr.shape}")
    n, dim = arr.shape
    rng = np.random.default_rng(seed)
    stages = np.zeros((num_levels, codebook_size, dim), dtype=np.float32)
    codes = np.zeros((n, num_levels), dtype=np.int32)
    residuals = arr.copy()

    for level in range(num_levels):
        centroids = _sample_initial_centroids(residuals, codebook_size, rng, kmeans_pp=kmeans_pp)
        assign = np.zeros(n, dtype=np.int32)

        for _ in range(max(1, iters)):
            # 分块计算最近质心 ||r - c||^2，降低大矩阵内存峰值
            c_sq = np.sum(centroids * centroids, axis=1)  # (K,)
            dists = np.sum(residuals * residuals, axis=1, keepdims=True) + c_sq[None, :] - 2.0 * (residuals @ centroids.T)
            assign = np.argmin(dists, axis=1).astype(np.int32)
            min_dists = dists[np.arange(n), assign]

            counts = np.bincount(assign, minlength=codebook_size)
            sums = np.zeros_like(centroids)
            np.add.at(sums, assign, residuals)

            nonzero = counts > 0
            centroids[nonzero] = sums[nonzero] / counts[nonzero, None]

            # 空簇复活：用当前误差最大的残差样本替换死质心并加微扰
            dead_indices = np.flatnonzero(~nonzero)
            if dead_indices.size > 0 and n > 0:
                hardest = np.argsort(min_dists)[::-1]
                for idx_pos, dead_k in enumerate(dead_indices):
                    src_i = int(hardest[idx_pos % n])
                    noise = rng.normal(0.0, 1e-4, size=(dim,)).astype(np.float32)
                    centroids[dead_k] = residuals[src_i] + noise

        stages[level] = centroids
        codes[:, level] = assign
        residuals = residuals - centroids[assign]

    return stages, codes


class _RqVaePyTorchNet(nn.Module):
    """对齐 x-algorithm `sid_io.py` 扁平权重的 6 层 EMA-STE RQ-VAE 网络。"""

    def __init__(
        self,
        input_dim: int,
        hidden_dim: int,
        latent_dim: int,
        num_levels: int = SID_NUM_LEVELS,
        codebook_size: int = SID_CODEBOOK_SIZE,
        ema_decay: float = 0.99,
        eps: float = 1e-5,
    ) -> None:
        super().__init__()
        self.input_dim = int(input_dim)
        self.hidden_dim = int(hidden_dim)
        self.latent_dim = int(latent_dim)
        self.num_levels = int(num_levels)
        self.codebook_size = int(codebook_size)
        self.ema_decay = float(ema_decay)
        self.eps = float(eps)

        # 显式使用 (in, out) 权重布局以便与 NumPy SidCodebookQuantizer 完全无缝互通
        self.enc_w0 = nn.Parameter(torch.empty(input_dim, hidden_dim))
        self.enc_b0 = nn.Parameter(torch.zeros(hidden_dim))
        self.enc_w1 = nn.Parameter(torch.empty(hidden_dim, latent_dim))
        self.enc_b1 = nn.Parameter(torch.zeros(latent_dim))

        self.dec_w0 = nn.Parameter(torch.empty(latent_dim, hidden_dim))
        self.dec_b0 = nn.Parameter(torch.zeros(hidden_dim))
        self.dec_w1 = nn.Parameter(torch.empty(hidden_dim, input_dim))
        self.dec_b1 = nn.Parameter(torch.zeros(input_dim))

        nn.init.xavier_uniform_(self.enc_w0)
        nn.init.xavier_uniform_(self.enc_w1)
        nn.init.xavier_uniform_(self.dec_w0)
        nn.init.xavier_uniform_(self.dec_w1)

        self.register_buffer("stages", torch.zeros(num_levels, codebook_size, latent_dim))
        self.register_buffer("cluster_size", torch.ones(num_levels, codebook_size))
        self.register_buffer("embed_avg", torch.zeros(num_levels, codebook_size, latent_dim))

    def encode(self, x: torch.Tensor) -> torch.Tensor:
        h = F.silu(x @ self.enc_w0 + self.enc_b0)
        return h @ self.enc_w1 + self.enc_b1

    def decode(self, z_q: torch.Tensor) -> torch.Tensor:
        h = F.silu(z_q @ self.dec_w0 + self.dec_b0)
        return h @ self.dec_w1 + self.dec_b1

    @torch.no_grad()
    def init_codebooks_from_stages(self, stages_np: np.ndarray) -> None:
        tensor = torch.from_numpy(np.asarray(stages_np, dtype=np.float32)).to(self.stages.device)
        self.stages.copy_(tensor)
        self.embed_avg.copy_(tensor)
        self.cluster_size.fill_(1.0)

    def forward_quantize(
        self,
        z_e: torch.Tensor,
        *,
        update_ema: bool = True,
        dead_code_threshold: float = 0.25,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """残差量化前向：返回 (STE 量化向量, L2 commit loss, 整数码词 indices (B, L))。"""
        residual = z_e
        quantized_sum = torch.zeros_like(z_e)
        all_codes: List[torch.Tensor] = []
        commit_loss = z_e.new_zeros(())

        for level in range(self.num_levels):
            book = self.stages[level]  # (K, D_latent)
            # 计算欧氏距离平方：||r||^2 + ||c||^2 - 2 r.c
            r_sq = torch.sum(residual * residual, dim=-1, keepdim=True)
            b_sq = torch.sum(book * book, dim=-1).unsqueeze(0)
            dists = r_sq + b_sq - 2.0 * (residual @ book.t())
            indices = torch.argmin(dists, dim=-1)  # (B,)
            chosen = F.embedding(indices, book)

            # 对当前层目标累加残差 commitment 损失（保护梯度回传至 encoder）
            commit_loss = commit_loss + F.mse_loss(residual, chosen.detach())

            if update_ema and self.training:
                with torch.no_grad():
                    one_hot = F.one_hot(indices, num_classes=self.codebook_size).to(residual.dtype)
                    counts = one_hot.sum(dim=0)  # (K,)
                    dw = one_hot.t() @ residual.detach()  # (K, D)

                    self.cluster_size[level].mul_(self.ema_decay).add_(counts, alpha=1.0 - self.ema_decay)
                    self.embed_avg[level].mul_(self.ema_decay).add_(dw, alpha=1.0 - self.ema_decay)

                    # Laplace 平滑归一化码本更新
                    n_total = self.cluster_size[level].sum()
                    smoothed_size = (
                        (self.cluster_size[level] + self.eps)
                        / (n_total + self.codebook_size * self.eps)
                        * n_total
                    )
                    self.stages[level].copy_(self.embed_avg[level] / smoothed_size.unsqueeze(-1).clamp_min(1e-6))

                    # 死码复活：识别低活跃码字并使用高重构残差样本重置
                    dead_mask = self.cluster_size[level] < dead_code_threshold
                    num_dead = int(dead_mask.sum().item())
                    if num_dead > 0 and residual.shape[0] > 0:
                        batch_n = residual.shape[0]
                        err_per_sample = torch.sum((residual.detach() - chosen.detach()) ** 2, dim=-1)
                        top_order = torch.argsort(err_per_sample, descending=True)
                        # 样本少于死码数时循环采样并叠加小噪声避免多死码坍缩同一点
                        pick_pos = torch.arange(num_dead, device=residual.device) % batch_n
                        replacements = residual.detach()[top_order[pick_pos]].clone()
                        replacements = replacements + 1e-3 * torch.randn_like(replacements)
                        self.stages[level][dead_mask] = replacements
                        self.embed_avg[level][dead_mask] = replacements * dead_code_threshold
                        self.cluster_size[level][dead_mask] = dead_code_threshold

            residual = residual - chosen
            quantized_sum = quantized_sum + chosen
            all_codes.append(indices)

        # Straight-Through Estimator
        z_st = z_e + (quantized_sum - z_e).detach()
        codes_tensor = torch.stack(all_codes, dim=-1)
        return z_st, commit_loss / float(self.num_levels), codes_tensor


def train_rqvae_codebook(
    embeddings: np.ndarray,
    *,
    num_levels: int = SID_NUM_LEVELS,
    codebook_size: int = SID_CODEBOOK_SIZE,
    hidden_dim: int = 256,
    latent_dim: int = 64,
    epochs: int = 30,
    batch_size: int = 256,
    lr: float = 3e-3,
    commitment_weight: float = 0.25,
    cosine_weight: float = 0.5,
    ema_decay: float = 0.99,
    dead_code_threshold: float = 0.1,
    seed: int = 42,
    device: Optional[str] = None,
) -> Tuple[RQVaeArtifact, Dict[str, Any]]:
    """训练 6x256 RQ-VAE（预热编解码器 + RQ-KMeans 码本初始化 + EMA/死码复活联合优化）。"""
    arr = np.asarray(embeddings, dtype=np.float32)
    if arr.ndim != 2 or arr.shape[0] == 0:
        raise ValueError(f"expected non-empty 2D embeddings, got {arr.shape}")

    torch.manual_seed(seed)
    np_rng = np.random.default_rng(seed)
    target_device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))

    input_dim = int(arr.shape[1])
    net = _RqVaePyTorchNet(
        input_dim=input_dim,
        hidden_dim=hidden_dim,
        latent_dim=latent_dim,
        num_levels=num_levels,
        codebook_size=codebook_size,
        ema_decay=ema_decay,
    ).to(target_device)

    x_all = torch.from_numpy(arr).to(target_device)
    optimizer = torch.optim.AdamW(net.parameters(), lr=lr, weight_decay=1e-4)

    # 第一步：无量化自编码器短预热，得到语义结构稳定的初始潜向量再做 RQ-KMeans 初始化
    warmup_epochs = max(3, epochs // 5)
    n_samples = arr.shape[0]
    eff_bs = max(1, min(batch_size, n_samples))
    net.train()
    for _ in range(warmup_epochs):
        perm = torch.from_numpy(np_rng.permutation(n_samples)).to(target_device)
        for start in range(0, n_samples, eff_bs):
            xb = x_all[perm[start : start + eff_bs]]
            z_e = net.encode(xb)
            recon = net.decode(z_e)
            loss = F.mse_loss(recon, xb)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()

    with torch.no_grad():
        net.eval()
        latent_chunks = [
            net.encode(x_all[start : start + eff_bs]).detach().cpu().numpy()
            for start in range(0, n_samples, eff_bs)
        ]
        latent_init = (
            np.concatenate(latent_chunks, axis=0)
            if latent_chunks
            else np.zeros((0, latent_dim), dtype=np.float32)
        )
    init_stages, _ = train_rq_kmeans(
        latent_init,
        num_levels=num_levels,
        codebook_size=codebook_size,
        iters=15,
        seed=seed,
        kmeans_pp=(n_samples <= 4096),
    )
    net.init_codebooks_from_stages(init_stages)

    # 第二步：EMA + STE + Commitment + Cosine 重建联合微调
    last_loss = 0.0
    net.train()
    for _ in range(max(1, epochs - warmup_epochs)):
        perm = torch.from_numpy(np_rng.permutation(n_samples)).to(target_device)
        for start in range(0, n_samples, eff_bs):
            xb = x_all[perm[start : start + eff_bs]]
            z_e = net.encode(xb)
            z_st, commit_loss, _ = net.forward_quantize(
                z_e,
                update_ema=True,
                dead_code_threshold=dead_code_threshold,
            )
            recon = net.decode(z_st)
            mse_loss = F.mse_loss(recon, xb)
            cos_loss = 1.0 - F.cosine_similarity(recon, xb, dim=-1).mean()
            total_loss = mse_loss + cosine_weight * cos_loss + commitment_weight * commit_loss

            optimizer.zero_grad(set_to_none=True)
            total_loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), max_norm=1.0)
            optimizer.step()
            last_loss = float(total_loss.item())

    net.eval()
    artifact = RQVaeArtifact(
        stages=net.stages.detach().cpu().numpy().astype(np.float32),
        enc_params={
            "w0": net.enc_w0.detach().cpu().numpy().astype(np.float32),
            "b0": net.enc_b0.detach().cpu().numpy().astype(np.float32),
            "w1": net.enc_w1.detach().cpu().numpy().astype(np.float32),
            "b1": net.enc_b1.detach().cpu().numpy().astype(np.float32),
        },
        dec_params={
            "w0": net.dec_w0.detach().cpu().numpy().astype(np.float32),
            "b0": net.dec_b0.detach().cpu().numpy().astype(np.float32),
            "w1": net.dec_w1.detach().cpu().numpy().astype(np.float32),
            "b1": net.dec_b1.detach().cpu().numpy().astype(np.float32),
        },
        model_type="rqvae",
        metadata={
            "num_levels": str(num_levels),
            "codebook_size": str(codebook_size),
            "input_dim": str(input_dim),
            "hidden_dim": str(hidden_dim),
            "latent_dim": str(latent_dim),
            "final_train_loss": f"{last_loss:.6f}",
        },
    )
    eval_metrics = evaluate_rqvae_codebook(artifact, arr)
    artifact.metadata["recon_cosine"] = f"{eval_metrics['recon_cosine']:.6f}"
    artifact.metadata["collision_rate"] = f"{eval_metrics['collision_rate']:.6f}"
    return artifact, eval_metrics


def _artifact_to_tensor_dict(artifact: RQVaeArtifact) -> Dict[str, np.ndarray]:
    tensors: Dict[str, np.ndarray] = {
        "stages": np.asarray(artifact.stages, dtype=np.float32),
    }
    if artifact.enc_params:
        for k in ("w0", "b0", "w1", "b1"):
            if k in artifact.enc_params:
                tensors[f"enc_{k}"] = np.asarray(artifact.enc_params[k], dtype=np.float32)
    if artifact.dec_params:
        for k in ("w0", "b0", "w1", "b1"):
            if k in artifact.dec_params:
                tensors[f"dec_{k}"] = np.asarray(artifact.dec_params[k], dtype=np.float32)
    return tensors


def save_rqvae_safetensors(artifact: RQVaeArtifact, path: Path) -> Path:
    """按 x-algorithm `sid_io.py` 键规范将码本及编解码权重存为 .safetensors。"""
    from safetensors.numpy import save_file

    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tensors = _artifact_to_tensor_dict(artifact)
    meta = {str(k): str(v) for k, v in artifact.metadata.items()}
    meta["model_type"] = str(artifact.model_type)
    save_file(tensors, str(target), metadata=meta)
    return target


def save_rqvae_npz(artifact: RQVaeArtifact, path: Path) -> Path:
    """备份或轻量归档为 .npz 格式（保持与 .safetensors 相同张量键）。"""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tensors = _artifact_to_tensor_dict(artifact)
    np.savez(target, **tensors)
    return target


def load_rqvae_artifact(path: Path) -> RQVaeArtifact:
    """从 .safetensors 或 .npz 读取完整 `RQVaeArtifact`。"""
    q = SidCodebookQuantizer.from_npz_or_json(path)
    meta: Dict[str, Any] = {}
    if Path(path).suffix == ".safetensors":
        from safetensors import safe_open

        with safe_open(str(path), framework="numpy") as handle:
            meta = dict(handle.metadata() or {})
    return RQVaeArtifact(
        stages=q.codebooks,
        enc_params=q.enc_params,
        dec_params=q.dec_params,
        model_type=str(meta.get("model_type", "rqvae")),
        metadata=meta,
    )


def evaluate_rqvae_codebook(artifact: RQVaeArtifact, embeddings: np.ndarray) -> Dict[str, Any]:
    """评估 6x256 码本的重建保真度、前缀碰撞率与各层级码字激活利用率。"""
    arr = np.asarray(embeddings, dtype=np.float32)
    quantizer = artifact.to_quantizer()
    wire_codes, recon = quantizer.batch_encode(arr)

    diff = arr - recon
    mse = float(np.mean(diff * diff))
    norm_a = np.linalg.norm(arr, axis=1)
    norm_r = np.linalg.norm(recon, axis=1)
    denom = norm_a * norm_r
    cos_vals = np.sum(arr * recon, axis=1) / np.where(denom > 1e-12, denom, 1.0)
    recon_cosine = float(np.mean(cos_vals))

    unique_tuples = {tuple(c) for c in wire_codes}
    total = len(wire_codes)
    collision_rate = 1.0 - (float(len(unique_tuples)) / float(max(1, total)))

    codes_arr = np.asarray(wire_codes, dtype=np.int32)
    per_level_utilization: List[float] = []
    if total == 0:
        per_level_utilization = [0.0] * quantizer.codebooks.shape[0]
    else:
        for level in range(quantizer.codebooks.shape[0]):
            active = np.unique(codes_arr[:, level]).size
            per_level_utilization.append(float(active) / float(quantizer.codebooks.shape[1]))

    return {
        "total_items": total,
        "unique_sids": len(unique_tuples),
        "collision_rate": collision_rate,
        "recon_mse": mse,
        "recon_cosine": recon_cosine,
        "per_level_utilization": per_level_utilization,
        "mean_utilization": float(np.mean(per_level_utilization)),
    }


def sid_prefix2_lookup(sids: torch.Tensor, num_buckets: int = 4096) -> torch.Tensor:
    """提取 1-indexed 6 级 SID 的前 2 级组合桶 ID（0 恒保留给 PAD/缺失）。"""
    valid = (sids[..., 0] > 0) & (sids[..., 1] > 0)
    s0 = (sids[..., 0] - 1).clamp_min(0)
    s1 = (sids[..., 1] - 1).clamp_min(0)
    bucket = 1 + ((s0 * 256 + s1) % max(1, num_buckets - 1))
    return torch.where(valid, bucket, torch.zeros_like(bucket))


def sid_prefix3_lookup(sids: torch.Tensor, num_buckets: int = 16384) -> torch.Tensor:
    """提取 1-indexed 6 级 SID 的前 3 级组合桶 ID（0 恒保留给 PAD/缺失）。"""
    valid = (sids[..., 0] > 0) & (sids[..., 1] > 0) & (sids[..., 2] > 0)
    s0 = (sids[..., 0] - 1).clamp_min(0)
    s1 = (sids[..., 1] - 1).clamp_min(0)
    s2 = (sids[..., 2] - 1).clamp_min(0)
    hashed = (s0 * 65536 + s1 * 256 + s2) % max(1, num_buckets - 1)
    return torch.where(valid, 1 + hashed, torch.zeros_like(hashed))


class SidEntityEmbedder(nn.Module):
    """基于 6x256 SID 的分层语义嵌入器（对照 `x-algorithm/phoenix/xrex/models/recsys_sid.py`）。

    融合三路信息并严格屏蔽 PAD（`sids[..., 0] == 0`）：
    1. 前 2 级 / 前 3 级组合前缀可学习嵌入；
    2. 全 6 级可微码字残差池化；
    3. 冻结码本+解码器重建语义向量的 `stop_gradient` 锚点残差投影。
    """

    def __init__(
        self,
        out_dim: int = 256,
        *,
        num_levels: int = SID_NUM_LEVELS,
        codebook_size: int = SID_CODEBOOK_SIZE,
        prefix2_buckets: int = 4096,
        prefix3_buckets: int = 16384,
        artifact: Optional[RQVaeArtifact] = None,
    ) -> None:
        super().__init__()
        self.out_dim = int(out_dim)
        self.num_levels = int(num_levels)
        self.codebook_size = int(codebook_size)
        self.prefix2_buckets = int(prefix2_buckets)
        self.prefix3_buckets = int(prefix3_buckets)

        # index 0 固定作全 0 padding
        self.level_embeddings = nn.ModuleList(
            [nn.Embedding(codebook_size + 1, out_dim, padding_idx=0) for _ in range(num_levels)]
        )
        self.prefix2_emb = nn.Embedding(prefix2_buckets, out_dim, padding_idx=0)
        self.prefix3_emb = nn.Embedding(prefix3_buckets, out_dim, padding_idx=0)

        # 冻结可选 RQ-VAE 码本与解码 MLP，确保仅靠可微投影适配下游，梯度不污染离线码本
        if artifact is not None:
            stages = np.asarray(artifact.stages, dtype=np.float32)
            latent_dim = int(stages.shape[2])
            dec_out_dim = int(artifact.dec_params["w1"].shape[1]) if artifact.dec_params else latent_dim
        else:
            latent_dim = out_dim
            dec_out_dim = out_dim
            stages = np.zeros((num_levels, codebook_size, latent_dim), dtype=np.float32)

        zeros = np.zeros((num_levels, 1, latent_dim), dtype=np.float32)
        padded_stages = np.concatenate([zeros, stages], axis=1)  # (L, K+1, latent_dim)
        self.register_buffer("frozen_codebooks", torch.from_numpy(padded_stages))

        self._has_decoder = artifact is not None and artifact.dec_params is not None
        if self._has_decoder and artifact is not None and artifact.dec_params is not None:
            self.register_buffer("dec_w0", torch.from_numpy(artifact.dec_params["w0"].astype(np.float32)))
            self.register_buffer("dec_b0", torch.from_numpy(artifact.dec_params["b0"].astype(np.float32)))
            self.register_buffer("dec_w1", torch.from_numpy(artifact.dec_params["w1"].astype(np.float32)))
            self.register_buffer("dec_b1", torch.from_numpy(artifact.dec_params["b1"].astype(np.float32)))
        else:
            self.register_buffer("dec_w0", torch.zeros(latent_dim, latent_dim))
            self.register_buffer("dec_b0", torch.zeros(latent_dim))
            self.register_buffer("dec_w1", torch.zeros(latent_dim, dec_out_dim))
            self.register_buffer("dec_b1", torch.zeros(dec_out_dim))

        self.recon_proj = nn.Linear(dec_out_dim, out_dim)
        self.out_norm = nn.LayerNorm(out_dim)

    def _run_sid_decoder(self, sids: torch.Tensor) -> torch.Tensor:
        """从冻结码本和解码器前向重构连续语义特征（返回张量已与参数分离/detach）。"""
        z_q = self.frozen_codebooks.new_zeros((*sids.shape[:-1], self.frozen_codebooks.shape[-1]))
        for level in range(self.num_levels):
            idx = sids[..., level].clamp(0, self.codebook_size)
            z_q = z_q + F.embedding(idx, self.frozen_codebooks[level])
        if not self._has_decoder:
            return z_q.detach()
        h = F.silu(z_q @ self.dec_w0 + self.dec_b0)
        decoded = h @ self.dec_w1 + self.dec_b1
        # stop_gradient 语义锚点：只由可学习 recon_proj 吸收下游信号
        return decoded.detach()

    def forward(self, model_sids: torch.Tensor) -> torch.Tensor:
        """输入 1-indexed uint16/int64 SID 张量 (..., 6)，返回语义嵌入 (..., out_dim)。"""
        sids = model_sids.long().clamp(0, self.codebook_size)
        valid_mask = (sids[..., 0] > 0).unsqueeze(-1).to(dtype=self.out_norm.weight.dtype)

        emb = self.prefix2_emb(sid_prefix2_lookup(sids, self.prefix2_buckets))
        emb = emb + self.prefix3_emb(sid_prefix3_lookup(sids, self.prefix3_buckets))
        for level, tbl in enumerate(self.level_embeddings):
            emb = emb + tbl(sids[..., level])

        recon_anchor = self._run_sid_decoder(sids)
        emb = emb + self.recon_proj(recon_anchor)
        return self.out_norm(emb) * valid_mask


class DistilledTextEncoderV3(nn.Module):
    """轻量可导出 INT8 ONNX 的多语言文本语义蒸馏学生编码器。

    对齐 `V3RQVaeSpec` 在线入口：`input_ids: int64 (B, S)`, `attention_mask: int64 (B, S)` -> `embedding (B, 256)`。
    """

    def __init__(
        self,
        *,
        vocab_size: int = 512,
        hidden_dim: int = 256,
        embedding_dim: int = 256,
        max_length: int = 128,
        num_layers: int = 2,
        num_heads: int = 4,
    ) -> None:
        super().__init__()
        self.vocab_size = int(vocab_size)
        self.hidden_dim = int(hidden_dim)
        self.embedding_dim = int(embedding_dim)
        self.max_length = int(max_length)
        self.num_heads = int(num_heads)
        self.head_dim = hidden_dim // num_heads

        self.token_emb = nn.Embedding(vocab_size, hidden_dim, padding_idx=0)
        self.pos_emb = nn.Embedding(max_length, hidden_dim)
        self.blocks = nn.ModuleList(
            [
                nn.ModuleDict(
                    {
                        "norm1": nn.LayerNorm(hidden_dim),
                        "qkv": nn.Linear(hidden_dim, hidden_dim * 3, bias=False),
                        "o_proj": nn.Linear(hidden_dim, hidden_dim, bias=False),
                        "norm2": nn.LayerNorm(hidden_dim),
                        "ffn_up": nn.Linear(hidden_dim, hidden_dim * 2),
                        "ffn_down": nn.Linear(hidden_dim * 2, hidden_dim),
                    }
                )
                for _ in range(num_layers)
            ]
        )
        self.out_norm = nn.LayerNorm(hidden_dim)
        self.out_proj = nn.Linear(hidden_dim, embedding_dim)

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        bsz, seq_len = input_ids.shape
        safe_ids = input_ids.clamp(0, self.vocab_size - 1)
        pos_ids = torch.arange(seq_len, device=input_ids.device, dtype=torch.long).clamp(0, self.max_length - 1)
        x = self.token_emb(safe_ids) + self.pos_emb(pos_ids).unsqueeze(0)

        attn_f = attention_mask.to(dtype=x.dtype)
        # 构造 ONNX-safe 加法注意力偏置 (B, 1, 1, S)
        attn_bias = (1.0 - attn_f).unsqueeze(1).unsqueeze(2) * -1e4

        for blk in self.blocks:
            h = blk["norm1"](x)
            qkv = blk["qkv"](h).view(bsz, seq_len, 3, self.num_heads, self.head_dim)
            q = qkv[:, :, 0].transpose(1, 2)
            k = qkv[:, :, 1].transpose(1, 2)
            v = qkv[:, :, 2].transpose(1, 2)
            scores = torch.matmul(q, k.transpose(-2, -1)) * (float(self.head_dim) ** -0.5) + attn_bias
            probs = torch.softmax(scores, dim=-1)
            ctx = torch.matmul(probs, v).transpose(1, 2).contiguous().view(bsz, seq_len, self.hidden_dim)
            x = x + blk["o_proj"](ctx)

            h2 = blk["norm2"](x)
            x = x + blk["ffn_down"](F.silu(blk["ffn_up"](h2)))

        x = self.out_norm(x) * attn_f.unsqueeze(-1)
        denom = attn_f.sum(dim=1, keepdim=True).clamp_min(1.0)
        pooled = x.sum(dim=1) / denom
        raw_emb = self.out_proj(pooled)
        # 使用显式平方和归一化以确保 opset=17 ONNX 数值与形状稳定
        norm = torch.sqrt((raw_emb * raw_emb).sum(dim=-1, keepdim=True) + 1e-12)
        return raw_emb / norm


def train_distilled_text_encoder(
    texts: Sequence[str],
    teacher_embeddings: np.ndarray,
    *,
    vocab_size: int = 512,
    hidden_dim: int = 256,
    embedding_dim: int = 256,
    max_length: int = 128,
    num_layers: int = 2,
    epochs: int = 20,
    batch_size: int = 64,
    lr: float = 2e-3,
    seed: int = 42,
    device: Optional[str] = None,
) -> Tuple[DistilledTextEncoderV3, Dict[str, float]]:
    """训练学生文本编码器拟合教师语义表征，对齐向量供线上纯 ONNX INT8 使用。"""
    targets_np = np.asarray(teacher_embeddings, dtype=np.float32)
    if targets_np.ndim != 2 or targets_np.shape[0] != len(texts):
        raise ValueError(f"texts len {len(texts)} mismatches teacher_embeddings shape {targets_np.shape}")
    if targets_np.shape[1] != embedding_dim:
        raise ValueError(f"expected teacher embedding_dim {embedding_dim}, got {targets_np.shape[1]}")

    # 确保目标教师向量单位化
    norms = np.linalg.norm(targets_np, axis=1, keepdims=True) + 1e-12
    targets_np = (targets_np / norms).astype(np.float32)

    input_ids_np, attn_np = simple_byte_ngram_tokenize(texts, max_len=max_length)
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    target_device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    if target_device.type == "cuda":
        torch.set_float32_matmul_precision("high")
    amp_enabled = target_device.type == "cuda" and torch.cuda.is_bf16_supported()

    model = DistilledTextEncoderV3(
        vocab_size=vocab_size,
        hidden_dim=hidden_dim,
        embedding_dim=embedding_dim,
        max_length=max_length,
        num_layers=num_layers,
    ).to(target_device)

    x_ids = torch.from_numpy(input_ids_np).to(target_device)
    x_mask = torch.from_numpy(attn_np).to(target_device)
    y_true = torch.from_numpy(targets_np).to(target_device)

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    n = len(texts)
    eff_bs = max(1, min(batch_size, n))
    final_loss = 0.0

    model.train()
    for _ in range(max(1, epochs)):
        perm = torch.from_numpy(rng.permutation(n)).to(target_device)
        for start in range(0, n, eff_bs):
            idx = perm[start : start + eff_bs]
            with torch.amp.autocast("cuda", dtype=torch.bfloat16, enabled=amp_enabled):
                pred = model(x_ids[idx], x_mask[idx])
            pred_f = pred.float()
            tgt = y_true[idx]
            cos_loss = 1.0 - (pred_f * tgt).sum(dim=-1).mean()
            mse_loss = F.mse_loss(pred_f, tgt)
            loss = cos_loss + 0.5 * mse_loss
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            final_loss = float(loss.item())

    model.eval()
    eval_preds: List[torch.Tensor] = []
    eval_bs = max(1, min(512, n))
    with torch.no_grad():
        for start in range(0, n, eval_bs):
            with torch.amp.autocast("cuda", dtype=torch.bfloat16, enabled=amp_enabled):
                out_p = model(x_ids[start : start + eval_bs], x_mask[start : start + eval_bs])
            eval_preds.append(out_p.float())
        all_pred = torch.cat(eval_preds, dim=0)
        mean_cos = float((all_pred * y_true).sum(dim=-1).mean().item())
        mae = float(torch.abs(all_pred - y_true).mean().item())

    return model, {
        "final_loss": final_loss,
        "distill_cosine": mean_cos,
        "distill_mae": mae,
    }
