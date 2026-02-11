from typing import Dict, List


def related_post_ids_from_doc(doc: dict) -> List[str]:
    """
    Return "related IDs" used for industrial-grade seen/served/dedup semantics.
    This matches the backend logic: postId + original + reply parent + conversation root.
    """
    ids: List[str] = []
    for k in ["_id", "originalPostId", "replyToPostId", "conversationId"]:
        v = doc.get(k)
        if v is None:
            continue
        try:
            ids.append(str(v))
        except Exception:
            continue

    out: List[str] = []
    seen: set = set()
    for i in ids:
        if not i or i in seen:
            continue
        seen.add(i)
        out.append(i)
    return out


def dedup_scored_by_related_ids(scored: List[dict], posts_by_id: Dict[str, dict]) -> List[dict]:
    """
    Dedup scored items using "related IDs" semantics (retweet/reply/conversation).

    Policy: keep the highest-score item in each related group.
    Implementation: sort by score desc, then greedy keep-first while tracking all related IDs.
    """
    if not scored:
        return []

    ordered = sorted(scored, key=lambda x: float(x.get("score", 0.0) or 0.0), reverse=True)
    kept: List[dict] = []
    seen_related: set = set()

    for item in ordered:
        pid = str(item.get("postId") or "")
        if not pid:
            continue
        doc = posts_by_id.get(pid) or {"_id": pid}
        related = related_post_ids_from_doc(doc)
        if any(rid in seen_related for rid in related):
            continue
        for rid in related:
            seen_related.add(rid)
        kept.append(item)

    return kept

