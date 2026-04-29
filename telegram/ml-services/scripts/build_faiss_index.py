"""
FAISS 索引构建脚本
复刻 x-algorithm 的向量检索优化

支持的索引类型:
- Flat: 精确搜索 (小规模)
- IVF: 倒排索引 (中等规模)
- HNSW: 图索引 (高召回率)
- IVF+PQ: 量化压缩 (大规模)
"""

import faiss
import numpy as np
import pickle
from pathlib import Path
from typing import Literal
import time
import argparse

# 路径配置
DATA_DIR = Path(__file__).parent.parent / "data"
MODELS_DIR = Path(__file__).parent.parent / "models"

# 索引类型
IndexType = Literal["flat", "ivf", "hnsw", "ivf_pq"]


def load_embeddings(data_dir: Path = DATA_DIR):
    """加载 item embeddings"""
    embeddings_path = data_dir / "item_embeddings.npy"
    if not embeddings_path.exists():
        raise FileNotFoundError(
            f"Item embeddings not found at {embeddings_path}. "
            "Please run train_two_tower.py first."
        )
    
    embeddings = np.load(embeddings_path).astype(np.float32)
    print(f"✅ Loaded embeddings: shape={embeddings.shape}")
    return embeddings


def load_id_mapping(data_dir: Path = DATA_DIR):
    """加载 news_vocab (id -> index 映射)"""
    vocab_path = data_dir / "news_vocab.pkl"
    if not vocab_path.exists():
        raise FileNotFoundError(f"News vocab not found at {vocab_path}")
    
    with open(vocab_path, "rb") as f:
        news_vocab = pickle.load(f)
    
    # 反向映射: index -> news_id
    idx_to_news_id = {v: k for k, v in news_vocab.items()}
    print(f"✅ Loaded ID mapping: {len(idx_to_news_id)} items")
    return news_vocab, idx_to_news_id


def normalize_embeddings(embeddings: np.ndarray) -> np.ndarray:
    """L2 归一化 (用于余弦相似度)"""
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1, norms)  # 避免除零
    return embeddings / norms


def build_flat_index(embeddings: np.ndarray) -> faiss.Index:
    """
    Flat Index - 精确搜索
    适用: <10万向量
    """
    dim = embeddings.shape[1]
    # 使用 IP (内积) 配合归一化向量 = 余弦相似度
    index = faiss.IndexFlatIP(dim)
    index.add(embeddings)
    print(f"📦 Built Flat index with {index.ntotal} vectors")
    return index


def build_ivf_index(
    embeddings: np.ndarray, 
    nlist: int = 100,
    nprobe: int = 10
) -> faiss.Index:
    """
    IVF Index - 倒排文件索引
    适用: 10万-100万向量
    
    Args:
        nlist: 聚类中心数量 (推荐 sqrt(n) 到 4*sqrt(n))
        nprobe: 搜索时检查的聚类数 (越大越准但越慢)
    """
    dim = embeddings.shape[1]
    quantizer = faiss.IndexFlatIP(dim)
    index = faiss.IndexIVFFlat(quantizer, dim, nlist, faiss.METRIC_INNER_PRODUCT)
    
    # 训练聚类中心
    print(f"🔄 Training IVF index with {nlist} clusters...")
    index.train(embeddings)
    index.add(embeddings)
    index.nprobe = nprobe
    
    print(f"📦 Built IVF index: {index.ntotal} vectors, nlist={nlist}, nprobe={nprobe}")
    return index


def build_hnsw_index(
    embeddings: np.ndarray,
    M: int = 32,
    efConstruction: int = 200,
    efSearch: int = 64
) -> faiss.Index:
    """
    HNSW Index - 层次可导航小世界图
    适用: 需要高召回率场景
    
    Args:
        M: 每个节点的邻居数 (16-64)
        efConstruction: 构建时的搜索宽度
        efSearch: 查询时的搜索宽度
    """
    dim = embeddings.shape[1]
    index = faiss.IndexHNSWFlat(dim, M, faiss.METRIC_INNER_PRODUCT)
    index.hnsw.efConstruction = efConstruction
    index.hnsw.efSearch = efSearch
    
    print(f"🔄 Building HNSW index (M={M}, efConstruction={efConstruction})...")
    index.add(embeddings)
    
    print(f"📦 Built HNSW index: {index.ntotal} vectors")
    return index


def build_ivf_pq_index(
    embeddings: np.ndarray,
    nlist: int = 256,
    m: int = 8,  # 子向量数量
    nbits: int = 8,  # 每个子向量的量化位数
    nprobe: int = 16
) -> faiss.Index:
    """
    IVF+PQ Index - 倒排索引 + 乘积量化
    适用: >100万向量, 需要节省内存
    
    Args:
        nlist: 聚类中心数量
        m: 子向量数量 (必须能整除 dim)
        nbits: 每个子向量的量化位数 (8=256个聚类中心)
        nprobe: 搜索时检查的聚类数
    """
    dim = embeddings.shape[1]
    
    # 确保 m 能整除 dim
    if dim % m != 0:
        m = min([i for i in [4, 8, 16, 32] if dim % i == 0], default=dim)
        print(f"⚠️ Adjusted m to {m} (must divide dim={dim})")
    
    quantizer = faiss.IndexFlatIP(dim)
    index = faiss.IndexIVFPQ(quantizer, dim, nlist, m, nbits, faiss.METRIC_INNER_PRODUCT)
    
    print(f"🔄 Training IVF+PQ index (nlist={nlist}, m={m}, nbits={nbits})...")
    index.train(embeddings)
    index.add(embeddings)
    index.nprobe = nprobe
    
    print(f"📦 Built IVF+PQ index: {index.ntotal} vectors")
    return index


def benchmark_index(index: faiss.Index, embeddings: np.ndarray, k: int = 100):
    """性能测试"""
    # 随机选择 100 个查询向量
    n_queries = min(100, embeddings.shape[0])
    query_indices = np.random.choice(embeddings.shape[0], n_queries, replace=False)
    queries = embeddings[query_indices]
    
    # 预热
    index.search(queries[:10], k)
    
    # 计时
    start = time.time()
    distances, indices = index.search(queries, k)
    elapsed = time.time() - start
    
    qps = n_queries / elapsed
    avg_latency = elapsed / n_queries * 1000  # ms
    
    # 召回率估算 (自检索应该返回自己)
    recall_at_1 = np.mean(indices[:, 0] == query_indices)
    
    print(f"📊 Benchmark Results:")
    print(f"   QPS: {qps:.1f}")
    print(f"   Avg Latency: {avg_latency:.2f} ms")
    print(f"   Recall@1 (self): {recall_at_1:.2%}")
    
    return {"qps": qps, "latency_ms": avg_latency, "recall_at_1": recall_at_1}


def save_index(index: faiss.Index, index_type: str, models_dir: Path = MODELS_DIR):
    """保存索引到文件"""
    models_dir.mkdir(exist_ok=True)
    index_path = models_dir / f"faiss_{index_type}.index"
    faiss.write_index(index, str(index_path))
    
    # 文件大小
    size_mb = index_path.stat().st_size / (1024 * 1024)
    print(f"💾 Saved index to {index_path} ({size_mb:.2f} MB)")
    
    return index_path


def build_index(
    index_type: IndexType = "ivf",
    normalize: bool = True,
    benchmark: bool = True,
    data_dir: Path = DATA_DIR,
    models_dir: Path = MODELS_DIR,
    ivf_nlist: int = 0,
    ivf_pq_m: int = 8,
    ivf_pq_nbits: int = 8,
    nprobe: int = 16,
) -> Path:
    """
    主构建函数
    
    Args:
        index_type: 索引类型
        normalize: 是否 L2 归一化
        benchmark: 是否运行性能测试
    """
    print(f"\n{'='*50}")
    print(f"🚀 Building FAISS Index: {index_type.upper()}")
    print(f"{'='*50}\n")
    
    # 1. 加载数据
    embeddings = load_embeddings(data_dir)
    news_vocab, idx_to_news_id = load_id_mapping(data_dir)
    
    # 2. 归一化
    if normalize:
        print("🔄 Normalizing embeddings...")
        embeddings = normalize_embeddings(embeddings)
    
    # 3. 构建索引
    start_time = time.time()
    
    if index_type == "flat":
        index = build_flat_index(embeddings)
    elif index_type == "ivf":
        # 自动计算 nlist
        n = embeddings.shape[0]
        nlist = ivf_nlist or max(16, min(int(np.sqrt(n) * 2), 1024))
        index = build_ivf_index(embeddings, nlist=nlist, nprobe=nprobe)
    elif index_type == "hnsw":
        index = build_hnsw_index(embeddings)
    elif index_type == "ivf_pq":
        n = embeddings.shape[0]
        nlist = ivf_nlist or max(64, min(int(np.sqrt(n) * 4), 2048))
        index = build_ivf_pq_index(
            embeddings,
            nlist=nlist,
            m=ivf_pq_m,
            nbits=ivf_pq_nbits,
            nprobe=nprobe,
        )
    else:
        raise ValueError(f"Unknown index type: {index_type}")
    
    build_time = time.time() - start_time
    print(f"⏱️ Build time: {build_time:.2f} seconds")
    
    # 4. 性能测试
    if benchmark:
        benchmark_index(index, embeddings)
    
    # 5. 保存索引
    index_path = save_index(index, index_type, models_dir)
    
    # 6. 保存 ID 映射
    mapping_path = models_dir / "faiss_id_mapping.pkl"
    with open(mapping_path, "wb") as f:
        pickle.dump({
            "news_vocab": news_vocab,
            "idx_to_news_id": idx_to_news_id
        }, f)
    print(f"💾 Saved ID mapping to {mapping_path}")
    
    print(f"\n{'='*50}")
    print(f"✅ FAISS Index build complete!")
    print(f"{'='*50}\n")
    
    return index_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build FAISS index for recommendation")
    parser.add_argument(
        "--type", 
        type=str, 
        default="ivf",
        choices=["flat", "ivf", "hnsw", "ivf_pq"],
        help="Index type (default: ivf)"
    )
    parser.add_argument(
        "--no-normalize",
        action="store_true",
        help="Skip L2 normalization"
    )
    parser.add_argument(
        "--no-benchmark",
        action="store_true",
        help="Skip benchmark"
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=DATA_DIR,
        help="Directory containing item_embeddings.npy and news_vocab.pkl"
    )
    parser.add_argument(
        "--models-dir",
        type=Path,
        default=MODELS_DIR,
        help="Directory to write FAISS index and id mapping"
    )
    parser.add_argument("--ivf-nlist", type=int, default=0, help="Override IVF/IVF_PQ cluster count; 0 uses auto.")
    parser.add_argument("--ivf-pq-m", type=int, default=8, help="IVF_PQ sub-vector count.")
    parser.add_argument("--ivf-pq-nbits", type=int, default=8, help="IVF_PQ bits per codebook entry.")
    parser.add_argument("--nprobe", type=int, default=16, help="IVF search probe count.")
    
    args = parser.parse_args()
    
    build_index(
        index_type=args.type,
        normalize=not args.no_normalize,
        benchmark=not args.no_benchmark,
        data_dir=args.data_dir,
        models_dir=args.models_dir,
        ivf_nlist=args.ivf_nlist,
        ivf_pq_m=args.ivf_pq_m,
        ivf_pq_nbits=args.ivf_pq_nbits,
        nprobe=args.nprobe,
    )
