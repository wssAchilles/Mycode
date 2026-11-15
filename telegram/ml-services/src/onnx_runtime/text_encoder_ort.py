"""多语言文本编码器 INT8 ONNX Runner 与 6x256 残差码本定量编码器。"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import numpy as np

from src.contracts.sid import SID_CODEBOOK_SIZE, SID_NUM_LEVELS, validate_wire_sids


def _silu_np(x: np.ndarray) -> np.ndarray:
    """数值稳定的纯 NumPy SiLU 激活函数。"""
    clipped = np.clip(x, -60.0, 60.0)
    return x * (1.0 / (1.0 + np.exp(-clipped)))


class SidCodebookQuantizer:
    """基于 6 层 x 256 码词的纯 NumPy 残差矢量量化器（RQ-VAE 在线编码热路径）。"""

    def __init__(
        self,
        codebooks: np.ndarray,
        *,
        enc_params: Optional[Dict[str, np.ndarray]] = None,
        dec_params: Optional[Dict[str, np.ndarray]] = None,
    ) -> None:
        arr = np.asarray(codebooks, dtype=np.float32)
        if arr.ndim != 3 or arr.shape[0] != SID_NUM_LEVELS or arr.shape[1] != SID_CODEBOOK_SIZE:
            raise ValueError(
                f"expected codebook shape ({SID_NUM_LEVELS}, {SID_CODEBOOK_SIZE}, D), got {arr.shape}"
            )
        self.codebooks = arr
        self.dim = int(arr.shape[2])
        self.enc_params: Optional[Dict[str, np.ndarray]] = (
            {k: np.asarray(v, dtype=np.float32) for k, v in enc_params.items()}
            if enc_params is not None
            else None
        )
        self.dec_params: Optional[Dict[str, np.ndarray]] = (
            {k: np.asarray(v, dtype=np.float32) for k, v in dec_params.items()}
            if dec_params is not None
            else None
        )
        self.input_dim = int(self.enc_params["w0"].shape[0]) if self.enc_params else self.dim
        self.output_dim = int(self.dec_params["w1"].shape[1]) if self.dec_params else self.dim
        # 预先为每层 0-padding 构造 257 行查表矩阵（行 0 恒为全 0，1..256 对应码本）
        zeros = np.zeros((SID_NUM_LEVELS, 1, self.dim), dtype=np.float32)
        self._padded_codebooks = np.concatenate([zeros, self.codebooks], axis=1)

    @classmethod
    def from_npz_or_json(cls, path: Path) -> "SidCodebookQuantizer":
        """从 .safetensors / .npz / .npy / .json 加载量化码本矩阵与可选编码/解码 MLP 参数。"""
        resolved = Path(path)
        tensors: Dict[str, np.ndarray]
        if resolved.suffix == ".npy":
            return cls(np.load(resolved))
        if resolved.suffix == ".npz":
            with np.load(resolved) as archive:
                tensors = {k: archive[k] for k in archive.files}
        elif resolved.suffix == ".safetensors":
            try:
                from safetensors.numpy import load_file
            except ImportError as exc:
                raise RuntimeError("safetensors package required to load .safetensors codebook") from exc
            tensors = dict(load_file(str(resolved)))
        elif resolved.suffix == ".json":
            import json

            payload = json.loads(resolved.read_text(encoding="utf-8"))
            if not isinstance(payload, dict) or ("stages" not in payload and "codebooks" not in payload):
                raise ValueError("json codebook must contain 'stages' or 'codebooks'")
            tensors = {k: np.asarray(v, dtype=np.float32) for k, v in payload.items() if isinstance(v, list)}
        else:
            raise ValueError(f"unsupported codebook file extension: {resolved.suffix}")

        # 优先检测 x-algorithm 风格的 stages 键，再回退到 codebooks 键
        if "stages" in tensors:
            codebooks = tensors["stages"]
        elif "codebooks" in tensors:
            codebooks = tensors["codebooks"]
        else:
            fallback_keys = [k for k in tensors.keys() if not k.startswith("enc_") and not k.startswith("dec_")]
            if not fallback_keys:
                raise ValueError(f"no codebook tensor found in {resolved}")
            codebooks = tensors[fallback_keys[0]]

        enc_keys = ("enc_w0", "enc_b0", "enc_w1", "enc_b1")
        dec_keys = ("dec_w0", "dec_b0", "dec_w1", "dec_b1")
        enc_params = (
            {k.removeprefix("enc_"): tensors[k] for k in enc_keys}
            if all(k in tensors for k in enc_keys)
            else None
        )
        dec_params = (
            {k.removeprefix("dec_"): tensors[k] for k in dec_keys}
            if all(k in tensors for k in dec_keys)
            else None
        )
        return cls(codebooks, enc_params=enc_params, dec_params=dec_params)

    def _encode_mlp(self, vec: np.ndarray) -> np.ndarray:
        """若存在 RQ-VAE 编码器 MLP，则将输入向量投影至码本隐空间。"""
        if self.enc_params is None:
            return vec
        h = _silu_np(vec @ self.enc_params["w0"] + self.enc_params["b0"])
        return h @ self.enc_params["w1"] + self.enc_params["b1"]

    def _decode_mlp(self, z_q: np.ndarray) -> np.ndarray:
        """若存在 RQ-VAE 解码器 MLP，则将量化潜向量映射回语义输入空间。"""
        if self.dec_params is None:
            return z_q
        h = _silu_np(z_q @ self.dec_params["w0"] + self.dec_params["b0"])
        return h @ self.dec_params["w1"] + self.dec_params["b1"]

    def encode_vector(self, embedding: np.ndarray) -> Tuple[List[int], np.ndarray]:
        """对单个语义向量逐层残差寻找最近码字，返回 (Wire int32[6], 重建向量)。"""
        vec = np.asarray(embedding, dtype=np.float32).reshape(-1)
        if vec.shape[0] != self.input_dim:
            raise ValueError(f"expected embedding dim {self.input_dim}, got {vec.shape[0]}")

        latent = self._encode_mlp(vec)
        residual = latent.copy()
        quantized_latent = np.zeros_like(latent)
        codes: List[int] = []
        for level in range(SID_NUM_LEVELS):
            book = self.codebooks[level]  # (256, D_latent)
            # ||r - c||^2 = ||r||^2 + ||c||^2 - 2 r.c；省略 ||r||^2 常数项加速 ARGMIN
            book_sq = np.sum(book * book, axis=1)
            dists = book_sq - 2.0 * (book @ residual)
            idx = int(np.argmin(dists))
            chosen = book[idx]
            codes.append(idx)
            residual = residual - chosen
            quantized_latent = quantized_latent + chosen

        reconstructed = self._decode_mlp(quantized_latent)
        return validate_wire_sids(codes), np.asarray(reconstructed, dtype=np.float32)

    def batch_encode(self, embeddings: np.ndarray) -> Tuple[List[List[int]], np.ndarray]:
        """批量编码多个向量为 Wire SID 与重建向量矩阵。"""
        arr = np.asarray(embeddings, dtype=np.float32)
        if arr.ndim != 2 or arr.shape[1] != self.input_dim:
            raise ValueError(f"expected shape (N, {self.input_dim}), got {arr.shape}")
        all_codes: List[List[int]] = []
        all_recon = np.zeros((arr.shape[0], self.output_dim), dtype=np.float32)
        for row_idx in range(arr.shape[0]):
            c, r = self.encode_vector(arr[row_idx])
            all_codes.append(c)
            all_recon[row_idx] = r
        return all_codes, all_recon

    def reconstruct_from_model_sids(self, model_sids: np.ndarray) -> np.ndarray:
        """从 1-indexed uint16[0, 1..256] SID 重建向量；Level-0 为 0 的行按掩码清零。"""
        sids = np.asarray(model_sids, dtype=np.int64)
        if sids.ndim < 1 or sids.shape[-1] != SID_NUM_LEVELS:
            raise ValueError(f"expected model_sids trailing dim {SID_NUM_LEVELS}, got {sids.shape}")
        clamped = np.clip(sids, 0, SID_CODEBOOK_SIZE)
        valid_mask = (clamped[..., 0] > 0).astype(np.float32)[..., None]

        z_q = np.zeros((*sids.shape[:-1], self.dim), dtype=np.float32)
        for level in range(SID_NUM_LEVELS):
            z_q = z_q + self._padded_codebooks[level][clamped[..., level]]
        z_q = z_q * valid_mask
        recon = self._decode_mlp(z_q) * valid_mask
        return np.asarray(recon, dtype=np.float32)


def simple_byte_ngram_tokenize(texts: Sequence[str], max_len: int = 128) -> Tuple[np.ndarray, np.ndarray]:
    """轻量确定性字节/词片索引编码（供无分词器场景的占位与 ONNX 测试图对齐使用）。"""
    n = len(texts)
    input_ids = np.zeros((n, max_len), dtype=np.int64)
    attention_mask = np.zeros((n, max_len), dtype=np.int64)
    for row_idx, raw in enumerate(texts):
        encoded = str(raw or "").encode("utf-8", errors="ignore")[: max_len - 2]
        # 保留 0=PAD, 101=CLS, 102=SEP 常用偏移，字节映射到 [200..455]
        input_ids[row_idx, 0] = 101
        attention_mask[row_idx, 0] = 1
        for pos, byte_val in enumerate(encoded, start=1):
            input_ids[row_idx, pos] = 200 + int(byte_val)
            attention_mask[row_idx, pos] = 1
        end_pos = min(max_len - 1, len(encoded) + 1)
        input_ids[row_idx, end_pos] = 102
        attention_mask[row_idx, end_pos] = 1
    return input_ids, attention_mask


class TextEncoderOrtRunner:
    """运行多语言文本编码 ONNX 图并叠加 6x256 SID 量化。"""

    def __init__(
        self,
        session_pool: Any,
        *,
        session_name: str = "text_encoder",
        quantizer: Optional[SidCodebookQuantizer] = None,
        embedding_dim: int = 256,
        max_length: int = 128,
    ) -> None:
        self._pool = session_pool
        self._session_name = session_name
        self._quantizer = quantizer
        self._embedding_dim = int(embedding_dim)
        self._max_length = int(max_length)

    @property
    def is_ready(self) -> bool:
        return self._pool.get(self._session_name) is not None

    def encode_texts(
        self,
        texts: Sequence[str],
        *,
        input_ids: Optional[np.ndarray] = None,
        attention_mask: Optional[np.ndarray] = None,
    ) -> Tuple[np.ndarray, List[List[int]]]:
        """返回 (L2 归一化 256d 语义向量矩阵, Wire 6x256 SID 列表)。"""
        if not texts and input_ids is None:
            return np.zeros((0, self._embedding_dim), dtype=np.float32), []

        if input_ids is None or attention_mask is None:
            input_ids, attention_mask = simple_byte_ngram_tokenize(texts, max_len=self._max_length)

        outputs = self._pool.run(
            self._session_name,
            {
                "input_ids": np.asarray(input_ids, dtype=np.int64),
                "attention_mask": np.asarray(attention_mask, dtype=np.int64),
            },
        )
        embs = np.asarray(outputs[0], dtype=np.float32)
        if embs.ndim == 1:
            embs = embs.reshape(1, -1)
        norms = np.linalg.norm(embs, axis=1, keepdims=True) + 1e-12
        embs = embs / norms

        if len(outputs) >= 2 and outputs[1].ndim == 2 and outputs[1].shape[1] == SID_NUM_LEVELS:
            # 允许导出联合文本+RQ量化联合图直接返回 6 级离散码词
            sids = [validate_wire_sids(row.tolist()) for row in np.asarray(outputs[1], dtype=np.int32)]
        elif self._quantizer is not None:
            sids, _ = self._quantizer.batch_encode(embs)
        else:
            # 无码本文件时按向量量化符号散列输出确定性 [-1]*6 缺失标识，严禁伪造码本
            sids = [[-1] * SID_NUM_LEVELS for _ in range(embs.shape[0])]
        return embs, sids


def hash_text_for_cache(text: str) -> str:
    """计算正文编码缓存键（用于避免重复编码相同帖子正文）。"""
    return hashlib.sha256(str(text or "").encode("utf-8")).hexdigest()[:24]
