from __future__ import annotations

from typing import List

from agent_plane.contracts.models import AgentContextSnapshot, AgentScope


def build_agent_system_instruction(style: str) -> str:
    style_hint = {
        "general_assistant": "当缺少个性化上下文时，坦率说明并给出通用建议。",
        "single_context": "优先围绕用户当前最相关的上下文给出简洁、直接的回答。",
        "blended_context": "先提炼关键信息，再按轻重缓急组织回答，避免罗列成流水账。",
    }.get(style, "回答简洁、具体、自然。")

    return (
        "你是一名面向聊天产品用户的中文 AI 助手。"
        "你可以基于用户最近的动态、通知和新闻摘要回答问题，但绝对不要虚构上下文里没有的信息。"
        "如果上下文不足，就直接说明当前可见信息有限。"
        "默认使用简体中文，语气自然、清楚、偏实用。"
        f"{style_hint}"
    )


def render_context_blocks(snapshot: AgentContextSnapshot, scopes: List[AgentScope]) -> str:
    sections: list[str] = []

    if "feed" in scopes and snapshot.feed:
        rows = [
            f"- @{item.authorUsername or 'unknown'}: {item.title or item.snippet}（{item.recallSource or 'feed'}）"
            for item in snapshot.feed.items[:5]
        ]
        if rows:
            sections.append("【最近动态】\n" + "\n".join(rows))

    if "notifications" in scopes and snapshot.notifications:
        rows = [
            f"- {item.actorUsername or '有人'} · {item.type} · {item.actionText or item.postSnippet or '有新的互动'}"
            for item in snapshot.notifications.items[:5]
        ]
        if rows:
            sections.append("【最近通知】\n" + "\n".join(rows))

    if "news" in scopes and snapshot.news:
        rows = [
            f"- {item.title}（{item.source or 'news'}）：{item.summary}"
            for item in snapshot.news.items[:5]
        ]
        if rows:
            sections.append("【新闻简报】\n" + "\n".join(rows))

    return "\n\n".join(sections)
