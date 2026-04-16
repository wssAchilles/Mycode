from __future__ import annotations

from typing import Iterable, List

from agent_plane.contracts.models import AgentConversationItem


def compact_history(history: Iterable[AgentConversationItem], limit: int = 8) -> List[AgentConversationItem]:
    materialized = [item for item in history if item.content.strip()]
    if len(materialized) <= limit:
        return materialized
    return materialized[-limit:]
