import unittest
from pathlib import Path
import sys

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from agent_plane.contracts.models import (
    AgentContextSnapshot,
    AgentFeedItem,
    AgentNewsItem,
    AgentNotificationItem,
    AgentUserSnapshot,
    FeedContextSnapshot,
    NewsContextSnapshot,
    NotificationContextSnapshot,
)
from agent_plane.planner import build_execution_plan


class AgentPolicyTestCase(unittest.TestCase):
    def test_prefers_notification_scope_when_message_mentions_notifications(self) -> None:
        snapshot = AgentContextSnapshot(
            user=AgentUserSnapshot(id="u1", username="tester"),
            requestedScopes=["feed", "notifications"],
            feed=FeedContextSnapshot(
                items=[
                    AgentFeedItem(
                        postId="p1",
                        snippet="一条动态",
                        authorUsername="alice",
                        createdAt="2026-04-16T00:00:00Z",
                    )
                ],
                summary="feed summary",
            ),
            notifications=NotificationContextSnapshot(
                items=[
                    AgentNotificationItem(
                        id="n1",
                        type="reply",
                        actorUsername="bob",
                        actionText="回复了你",
                        createdAt="2026-04-16T00:00:00Z",
                    )
                ],
                summary="notification summary",
            ),
            news=NewsContextSnapshot(
                items=[
                    AgentNewsItem(
                        title="一条新闻",
                        summary="新闻摘要",
                    )
                ],
                summary="news summary",
            ),
            generatedAt="2026-04-16T00:00:00Z",
        )

        plan = build_execution_plan("帮我看下最近通知里最重要的内容", snapshot)
        self.assertEqual(plan.active_scopes, ["notifications"])


if __name__ == "__main__":
    unittest.main()
