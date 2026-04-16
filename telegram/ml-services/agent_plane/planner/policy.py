from __future__ import annotations

from dataclasses import dataclass
from typing import List

from agent_plane.contracts.models import AgentContextSnapshot, AgentScope

FEED_KEYWORDS = ("动态", "推荐", "feed", "space", "帖子", "关注", "时间线")
NOTIFICATION_KEYWORDS = ("通知", "提醒", "谁找我", "谁赞", "谁回复", "未读")
NEWS_KEYWORDS = ("新闻", "热点", "头条", "快讯", "时事", "今天发生")


@dataclass(frozen=True)
class AgentExecutionPlan:
    active_scopes: List[AgentScope]
    response_style: str


def _contains_any(text: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in text for keyword in keywords)


def build_execution_plan(message: str, snapshot: AgentContextSnapshot) -> AgentExecutionPlan:
    normalized = message.strip().lower()
    active_scopes: list[AgentScope] = []
    detected_explicit_scope = False

    if _contains_any(normalized, FEED_KEYWORDS) and snapshot.feed and snapshot.feed.items:
        active_scopes.append("feed")
        detected_explicit_scope = True
    if _contains_any(normalized, NOTIFICATION_KEYWORDS) and snapshot.notifications and snapshot.notifications.items:
        active_scopes.append("notifications")
        detected_explicit_scope = True
    if _contains_any(normalized, NEWS_KEYWORDS) and snapshot.news and snapshot.news.items:
        active_scopes.append("news")
        detected_explicit_scope = True

    if not active_scopes and not detected_explicit_scope:
        for scope in snapshot.requestedScopes:
            if scope == "feed" and snapshot.feed and snapshot.feed.items:
                active_scopes.append(scope)
            if scope == "notifications" and snapshot.notifications and snapshot.notifications.items:
                active_scopes.append(scope)
            if scope == "news" and snapshot.news and snapshot.news.items:
                active_scopes.append(scope)

    if not active_scopes:
        response_style = "general_assistant"
    elif len(active_scopes) == 1:
        response_style = "single_context"
    else:
        response_style = "blended_context"

    return AgentExecutionPlan(active_scopes=active_scopes, response_style=response_style)
