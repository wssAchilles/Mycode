"""
MIND 数据集预处理脚本
将 MIND-Small 数据集转换为 PyTorch 可用的格式
"""

import os
import pickle
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
from tqdm import tqdm

# 路径配置
PROJECT_ROOT = Path(__file__).parent.parent.parent
TRAIN_DIR = PROJECT_ROOT / "MINDsmall_train"
DEV_DIR = PROJECT_ROOT / "MINDsmall_dev"
OUTPUT_DIR = Path(__file__).parent.parent / "data"


def load_news(news_path: Path) -> Dict[str, dict]:
    """
    加载 news.tsv 文件
    格式: news_id \t category \t subcategory \t title \t abstract \t url \t title_entities \t abstract_entities
    """
    print(f"📰 加载新闻数据: {news_path}")
    
    # 读取 TSV 文件
    df = pd.read_csv(
        news_path,
        sep="\t",
        header=None,
        names=["news_id", "category", "subcategory", "title", "abstract", "url", "title_entities", "abstract_entities"],
        dtype=str,
        na_values=[""],
    )
    
    # 填充缺失值
    df = df.fillna("")
    
    # 转换为字典
    news_dict = {}
    for _, row in tqdm(df.iterrows(), total=len(df), desc="处理新闻"):
        news_dict[row["news_id"]] = {
            "news_id": row["news_id"],
            "category": row["category"],
            "subcategory": row["subcategory"],
            "title": row["title"],
            "abstract": row["abstract"],
            "text": f"{row['title']} {row['abstract']}",  # 合并标题和摘要
        }
    
    print(f"  ✅ 加载了 {len(news_dict)} 条新闻")
    return news_dict


def load_behaviors(behaviors_path: Path) -> List[dict]:
    """
    加载 behaviors.tsv 文件
    格式: impression_id \t user_id \t time \t history \t impressions
    """
    print(f"👤 加载用户行为数据: {behaviors_path}")
    
    # 读取 TSV 文件
    df = pd.read_csv(
        behaviors_path,
        sep="\t",
        header=None,
        names=["impression_id", "user_id", "time", "history", "impressions"],
        dtype=str,
        na_values=[""],
    )
    
    # 填充缺失值
    df = df.fillna("")
    
    behaviors = []
    for _, row in tqdm(df.iterrows(), total=len(df), desc="处理行为"):
        # 解析历史点击
        history = row["history"].split() if row["history"] else []
        
        # 解析曝光和点击
        # 格式: news_id-click (1=点击, 0=未点击)
        impressions = []
        if row["impressions"]:
            for imp in row["impressions"].split():
                parts = imp.rsplit("-", 1)
                if len(parts) == 2:
                    news_id, click = parts
                    impressions.append({
                        "news_id": news_id,
                        "clicked": click == "1"
                    })
        
        behaviors.append({
            "impression_id": row["impression_id"],
            "user_id": row["user_id"],
            "time": row["time"],
            "history": history,
            "impressions": impressions,
        })
    
    print(f"  ✅ 加载了 {len(behaviors)} 条行为记录")
    return behaviors


def create_user_sequences(behaviors: List[dict], news_dict: Dict[str, dict]) -> Dict[str, List[str]]:
    """
    为每个用户创建历史点击序列
    """
    print("🔄 创建用户序列...")
    
    user_sequences = {}
    for behavior in tqdm(behaviors, desc="构建序列"):
        user_id = behavior["user_id"]
        if user_id not in user_sequences:
            user_sequences[user_id] = []
        
        # 添加历史记录
        user_sequences[user_id].extend(behavior["history"])
        
        # 添加当前点击
        for imp in behavior["impressions"]:
            if imp["clicked"]:
                user_sequences[user_id].append(imp["news_id"])
    
    # 去重并保持顺序
    for user_id in user_sequences:
        seen = set()
        unique = []
        for news_id in user_sequences[user_id]:
            if news_id not in seen and news_id in news_dict:
                seen.add(news_id)
                unique.append(news_id)
        user_sequences[user_id] = unique
    
    print(f"  ✅ 创建了 {len(user_sequences)} 个用户序列")
    return user_sequences


def create_training_samples(behaviors: List[dict], news_dict: Dict[str, dict]) -> List[dict]:
    """
    创建训练样本 (正样本 + 负样本)
    每条样本: {user_id, user_history, candidate_news_id, label}
    """
    print("📊 创建训练样本...")
    
    samples = []
    for behavior in tqdm(behaviors, desc="生成样本"):
        user_id = behavior["user_id"]
        history = [nid for nid in behavior["history"] if nid in news_dict]
        
        if len(history) < 3:  # 历史太短则跳过
            continue
        
        for imp in behavior["impressions"]:
            news_id = imp["news_id"]
            if news_id not in news_dict:
                continue
            
            samples.append({
                "user_id": user_id,
                "history": history[-50:],  # 只保留最近50条
                "candidate_id": news_id,
                "label": 1 if imp["clicked"] else 0,
            })
    
    print(f"  ✅ 生成了 {len(samples)} 条训练样本")
    
    # 统计正负样本比例
    pos = sum(1 for s in samples if s["label"] == 1)
    neg = len(samples) - pos
    print(f"  📈 正样本: {pos} ({pos/len(samples)*100:.1f}%)")
    print(f"  📉 负样本: {neg} ({neg/len(samples)*100:.1f}%)")
    
    return samples


def build_vocabularies(news_dict: Dict[str, dict], user_sequences: Dict[str, List[str]]) -> Tuple[Dict, Dict]:
    """
    构建 news_id 和 user_id 的映射词表
    """
    print("📖 构建词表...")
    
    # News ID 词表
    news_vocab = {"<PAD>": 0, "<UNK>": 1}
    for news_id in news_dict.keys():
        if news_id not in news_vocab:
            news_vocab[news_id] = len(news_vocab)
    
    # User ID 词表
    user_vocab = {"<PAD>": 0, "<UNK>": 1}
    for user_id in user_sequences.keys():
        if user_id not in user_vocab:
            user_vocab[user_id] = len(user_vocab)
    
    print(f"  ✅ News 词表大小: {len(news_vocab)}")
    print(f"  ✅ User 词表大小: {len(user_vocab)}")
    
    return news_vocab, user_vocab


def main():
    """主函数"""
    print("=" * 60)
    print("🚀 MIND 数据预处理开始")
    print("=" * 60)
    
    # 创建输出目录
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # 加载训练集新闻
    train_news = load_news(TRAIN_DIR / "news.tsv")
    dev_news = load_news(DEV_DIR / "news.tsv")
    
    # 合并新闻字典
    all_news = {**train_news, **dev_news}
    print(f"📰 总新闻数: {len(all_news)}")
    
    # 加载行为数据
    train_behaviors = load_behaviors(TRAIN_DIR / "behaviors.tsv")
    dev_behaviors = load_behaviors(DEV_DIR / "behaviors.tsv")
    
    # 创建用户序列
    user_sequences = create_user_sequences(train_behaviors + dev_behaviors, all_news)
    
    # 创建训练样本
    train_samples = create_training_samples(train_behaviors, all_news)
    dev_samples = create_training_samples(dev_behaviors, all_news)
    
    # 构建词表
    news_vocab, user_vocab = build_vocabularies(all_news, user_sequences)
    
    # 保存处理后的数据
    print("\n💾 保存处理后的数据...")
    
    with open(OUTPUT_DIR / "news_dict.pkl", "wb") as f:
        pickle.dump(all_news, f)
    
    with open(OUTPUT_DIR / "user_sequences.pkl", "wb") as f:
        pickle.dump(user_sequences, f)
    
    with open(OUTPUT_DIR / "train_samples.pkl", "wb") as f:
        pickle.dump(train_samples, f)
    
    with open(OUTPUT_DIR / "dev_samples.pkl", "wb") as f:
        pickle.dump(dev_samples, f)
    
    with open(OUTPUT_DIR / "news_vocab.pkl", "wb") as f:
        pickle.dump(news_vocab, f)
    
    with open(OUTPUT_DIR / "user_vocab.pkl", "wb") as f:
        pickle.dump(user_vocab, f)
    
    print("\n" + "=" * 60)
    print("✅ 预处理完成！")
    print(f"📁 输出目录: {OUTPUT_DIR}")
    print("=" * 60)


if __name__ == "__main__":
    main()
