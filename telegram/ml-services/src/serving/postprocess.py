"""推荐候选后处理工具：按关联帖图谱（转推/回复/会话根）保留最高得分。"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping


def related_post_ids_from_doc(doc: Mapping[str, Any]) -> List[str]:
    """提取帖子的关联去重 ID 族（本身 + 原帖 + 回复父帖 + 会话根）。"""
    ids: List[str] = []
    for key in ("_id", "postId", "originalPostId", "replyToPostId", "conversationId"):
        val = doc.get(key)
        if val is None:
            continue
        text = str(val).strip()
        if text:
            ids.append(text)

    out: List[str] = []
    seen = set()
    for pid in ids:
        if pid not in seen:
            seen.add(pid)
            out.append(pid)
    return out


def dedup_scored_by_related_ids(
    scored: List[Dict[str, Any]],
    posts_by_id: Mapping[str, Mapping[str, Any]],
) -> List[Dict[str, Any]]:
    """按 score 降序贪心保留每个关联族内得分最高的一条候选。"""
    if not scored:
        return []
    ordered = sorted(scored, key=lambda item: float(item.get("score", 0.0) or 0.0), reverse=True)
    kept: List[Dict[str, Any]] = []
    seen_related = set()
    for item in ordered:
        pid = str(item.get("postId") or "").strip()
        if not pid:
            continue
        doc = posts_by_id.get(pid) or {"postId": pid}
        related = related_post_ids_from_doc(doc)
        if any(rid in seen_related for rid in related):
            continue
        seen_related.update(related)
        kept.append(item)
    return kept
