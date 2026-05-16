"""
从 MongoDB 导出 Phoenix V2 训练数据

数据来源: telegram-clone-backend 的 UserAction collection
输出格式: pickle 文件, 每条样本是一个 dict

样本构造逻辑 (对标 X):
  每条样本 = (用户行为序列, 候选帖子, 各动作标签)
  - 用户行为序列: 最近 64 条 UserAction (post_id, author_id, action_type)
  - 候选帖子: 用户交互过的帖子 (正样本) + 随机负采样 (负样本)
  - 标签: click/like/reply/repost/quote/share/dwell/video_view/dismiss/report

用法:
  python export_training_data.py --mongo-uri mongodb://localhost:27017/telegram_db
  python export_training_data.py --mongo-uri $MONGO_URI --days 30 --output data/phoenix_v2_samples.pkl
"""

import argparse
import pickle
import random
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# 尝试导入 pymongo, 如果没安装会给出提示
try:
    from pymongo import MongoClient
except ImportError:
    print("需要安装 pymongo: pip install pymongo")
    exit(1)


# ============================================================
# Action Type 映射 (与后端 ActionType 枚举对齐)
# ============================================================
ACTION_TYPE_MAP = {
    "like": 0,
    "reply": 1,
    "repost": 2,
    "quote": 3,
    "click": 4,
    "profile_click": 5,
    "share": 6,
    "impression": 7,
    "video_view": 8,
    "dwell": 9,
    "dismiss": 10,
    "block_author": 11,
    "report": 12,
}

# 用于构造标签的动作 (与 actionLabels.ts 中的 LABEL_ACTION_TYPES 对齐)
LABEL_ACTIONS = ["click", "like", "reply", "repost", "quote", "share", "dismiss", "block_author", "report", "dwell"]


def connect_mongo(uri: str, db_name: Optional[str] = None):
    """连接 MongoDB"""
    client = MongoClient(uri)
    if db_name:
        return client[db_name]
    # 从 URI 中提取 db name
    db_name = uri.split("/")[-1].split("?")[0]
    if not db_name or db_name == "":
        db_name = "telegram_db"
    return client[db_name]


def export_user_actions(db, days: int = 30, min_actions_per_user: int = 5) -> Dict:
    """
    导出用户行为数据, 按用户分组

    返回:
      {
        user_id: [
          {post_id, author_id, action_type_id, timestamp_ms, dwell_ms, ...},
          ...
        ]
      }
    """
    cutoff = datetime.utcnow() - timedelta(days=days)
    collection = db["user_actions"]

    print(f"📥 查询 {days} 天内的用户行为...")
    cursor = collection.find(
        {"timestamp": {"$gte": cutoff}},
        {
            "userId": 1, "action": 1, "targetPostId": 1, "targetAuthorId": 1,
            "timestamp": 1, "dwellTimeMs": 1, "videoWatchPercentage": 1,
            "inNetwork": 1, "recallSource": 1,
        },
    ).sort("timestamp", -1)

    user_actions: Dict[str, List[dict]] = defaultdict(list)
    total = 0
    for doc in cursor:
        user_id = str(doc["userId"])
        action = doc.get("action", "")
        action_id = ACTION_TYPE_MAP.get(action)
        if action_id is None:
            continue

        post_id = str(doc.get("targetPostId", ""))
        author_id = str(doc.get("targetAuthorId", ""))
        if not post_id or post_id == "None":
            continue

        user_actions[user_id].append({
            "post_id": post_id,
            "author_id": author_id,
            "action_type": action_id,
            "action_name": action,
            "timestamp_ms": int(doc.get("timestamp", datetime.utcnow()).timestamp() * 1000),
            "dwell_ms": doc.get("dwellTimeMs", 0) or 0,
        })
        total += 1

    # 过滤行为太少的用户
    filtered = {
        uid: actions for uid, actions in user_actions.items()
        if len(actions) >= min_actions_per_user
    }

    print(f"✅ 导出完成: {total} 条行为, {len(user_actions)} 个用户, "
          f"过滤后 {len(filtered)} 个用户 (>= {min_actions_per_user} 条)")
    return filtered


def build_post_author_map(db, post_ids: set) -> Dict[str, str]:
    """查询帖子 → 作者映射"""
    print(f"📥 查询 {len(post_ids)} 个帖子的作者信息...")
    posts = db["posts"].find(
        {"_id": {"$in": [pid for pid in post_ids]}},
        {"authorId": 1},
    )
    mapping = {}
    for post in posts:
        pid = str(post["_id"])
        author_id = str(post.get("authorId", ""))
        if author_id:
            mapping[pid] = author_id
    print(f"✅ 找到 {len(mapping)} 个帖子的作者")
    return mapping


def build_training_samples(
    user_actions: Dict[str, List[dict]],
    post_author_map: Dict[str, str],
    max_history_len: int = 64,
    num_negatives: int = 7,
    window_hours: int = 24,
) -> List[dict]:
    """
    构造训练样本

    每条样本:
    {
      "user_id": str,
      "history": [(post_id, author_id, action_type), ...],  最近 max_history_len 条
      "candidate_post_id": str,
      "candidate_author_id": str,
      "labels": {action_name: 0/1, ...},  多标签
      "dwell_ms": float,
      "is_positive": bool,
    }

    正样本: 用户实际交互过的 (post_id, action) 组合
    负样本: 用户看过但没交互的 impression, 或者完全随机的帖子
    """
    all_post_ids = list(post_author_map.keys())
    all_user_ids = list(user_actions.keys())
    samples = []

    for user_id, actions in user_actions.items():
        # 按时间排序 (最早的在前)
        actions.sort(key=lambda a: a["timestamp_ms"])

        # 构建用户交互过的帖子集合 (用于负采样排除)
        interacted_posts = set(a["post_id"] for a in actions)

        # 构建帖子 → 动作集合的映射 (一个帖子可能有多个动作)
        post_actions: Dict[str, Dict[str, float]] = defaultdict(dict)
        post_dwell: Dict[str, float] = {}
        for a in actions:
            pid = a["post_id"]
            action_name = a["action_name"]
            post_actions[pid][action_name] = 1.0
            if action_name == "dwell" and a["dwell_ms"] > 0:
                post_dwell[pid] = max(post_dwell.get(pid, 0), a["dwell_ms"])

        # 对每个交互过的帖子, 构造一个正样本
        # 用该帖子交互之前的历史作为 context
        seen_posts = set()
        for i, action in enumerate(actions):
            pid = action["post_id"]
            if pid in seen_posts:
                continue  # 同一帖子只取第一次交互
            seen_posts.add(pid)

            # 历史: 该帖子之前的行为
            history_actions = actions[:i]
            if len(history_actions) < 3:
                continue  # 太短的历史跳过

            # 取最近 max_history_len 条
            recent_history = history_actions[-max_history_len:]

            # 构造标签
            labels = {}
            for label_action in LABEL_ACTIONS:
                labels[label_action] = post_actions[pid].get(label_action, 0.0)
            dwell_ms = post_dwell.get(pid, 0)

            author_id = action["author_id"] or post_author_map.get(pid, "")

            samples.append({
                "user_id": user_id,
                "history": [(a["post_id"], a["author_id"] or "", a["action_type"]) for a in recent_history],
                "candidate_post_id": pid,
                "candidate_author_id": author_id,
                "labels": labels,
                "dwell_ms": dwell_ms,
                "is_positive": True,
            })

        # 负采样: 随机选几个用户没交互过的帖子
        neg_count = min(num_negatives, len(seen_posts))
        neg_candidates = [p for p in all_post_ids if p not in interacted_posts]
        if len(neg_candidates) < neg_count:
            neg_candidates = all_post_ids  # fallback
        neg_posts = random.sample(neg_candidates, min(neg_count, len(neg_candidates)))

        for neg_pid in neg_posts:
            # 用最后一条交互作为历史截断点
            if len(actions) < 3:
                continue
            recent_history = actions[-max_history_len:]
            neg_author_id = post_author_map.get(neg_pid, "")

            samples.append({
                "user_id": user_id,
                "history": [(a["post_id"], a["author_id"] or "", a["action_type"]) for a in recent_history],
                "candidate_post_id": neg_pid,
                "candidate_author_id": neg_author_id,
                "labels": {action: 0.0 for action in LABEL_ACTIONS},
                "dwell_ms": 0,
                "is_positive": False,
            })

    random.shuffle(samples)
    print(f"✅ 构造完成: {len(samples)} 条训练样本 "
          f"(正样本 {sum(1 for s in samples if s['is_positive'])}, "
          f"负样本 {sum(1 for s in samples if not s['is_positive'])})")
    return samples


def build_vocabs(samples: List[dict]) -> Tuple[Dict[str, int], Dict[str, int]]:
    """构建 user/post/author 词表"""
    user_ids = set()
    post_ids = set()
    author_ids = set()

    for sample in samples:
        user_ids.add(sample["user_id"])
        post_ids.add(sample["candidate_post_id"])
        author_ids.add(sample["candidate_author_id"])
        for pid, aid, _ in sample["history"]:
            post_ids.add(pid)
            author_ids.add(aid)

    # 0 = padding/unknown
    user_vocab = {uid: i + 1 for i, uid in enumerate(sorted(user_ids))}
    post_vocab = {pid: i + 1 for i, pid in enumerate(sorted(post_ids))}
    author_vocab = {aid: i + 1 for i, aid in enumerate(sorted(author_ids))}

    print(f"📊 词表大小: users={len(user_vocab)}, posts={len(post_vocab)}, authors={len(author_vocab)}")
    return user_vocab, post_vocab, author_vocab


def main():
    parser = argparse.ArgumentParser(description="从 MongoDB 导出 Phoenix V2 训练数据")
    parser.add_argument("--mongo-uri", required=True, help="MongoDB 连接 URI")
    parser.add_argument("--db-name", default=None, help="数据库名 (默认从 URI 提取)")
    parser.add_argument("--days", type=int, default=30, help="导出最近 N 天的数据")
    parser.add_argument("--min-actions", type=int, default=5, help="最少行为数")
    parser.add_argument("--max-history", type=int, default=64, help="最大历史长度")
    parser.add_argument("--num-negatives", type=int, default=7, help="每个正样本的负采样数")
    parser.add_argument("--output", type=Path, default=None, help="输出路径")
    args = parser.parse_args()

    # 1. 连接数据库
    db = connect_mongo(args.mongo_uri, args.db_name)

    # 2. 导出用户行为
    user_actions = export_user_actions(db, days=args.days, min_actions_per_user=args.min_actions)
    if not user_actions:
        print("❌ 没有找到足够的用户行为数据")
        return

    # 3. 收集所有帖子 ID, 查询作者映射
    all_post_ids = set()
    for actions in user_actions.values():
        for a in actions:
            all_post_ids.add(a["post_id"])
    post_author_map = build_post_author_map(db, all_post_ids)

    # 4. 构造训练样本
    samples = build_training_samples(
        user_actions, post_author_map,
        max_history_len=args.max_history,
        num_negatives=args.num_negatives,
    )

    # 5. 构建词表
    user_vocab, post_vocab, author_vocab = build_vocabs(samples)

    # 6. 保存
    output_dir = args.output.parent if args.output else Path(__file__).parent.parent / "data"
    output_dir.mkdir(parents=True, exist_ok=True)

    output_path = args.output or output_dir / "phoenix_v2_samples.pkl"
    with open(output_path, "wb") as f:
        pickle.dump(samples, f)
    print(f"💾 训练样本已保存: {output_path} ({len(samples)} 条)")

    # 保存词表
    for name, vocab in [("user_vocab", user_vocab), ("post_vocab", post_vocab), ("author_vocab", author_vocab)]:
        vocab_path = output_dir / f"phoenix_v2_{name}.pkl"
        with open(vocab_path, "wb") as f:
            pickle.dump(vocab, f)
        print(f"💾 {name} 已保存: {vocab_path}")


if __name__ == "__main__":
    main()
