import unittest


class TestFeedRecommendRelatedDedup(unittest.TestCase):
    def test_dedup_keeps_highest_score_per_related_group(self):
        # Import lazily to keep test focused on pure logic.
        from recsys_dedup import dedup_scored_by_related_ids

        posts_by_id = {
            # p1 and p2 are "related" via the same original/root id
            "p1": {"_id": "p1", "originalPostId": "root"},
            "p2": {"_id": "p2", "originalPostId": "root"},
            "p3": {"_id": "p3"},
        }

        scored = [
            {"postId": "p1", "score": 0.1, "inNetwork": True},
            {"postId": "p2", "score": 0.9, "inNetwork": True},
            {"postId": "p3", "score": 0.5, "inNetwork": False},
        ]

        out = dedup_scored_by_related_ids(scored, posts_by_id)
        out_ids = [x["postId"] for x in out]

        # Highest-score item in the related group should be kept.
        self.assertIn("p2", out_ids)
        self.assertNotIn("p1", out_ids)
        self.assertIn("p3", out_ids)

        # Output should remain score-sorted descending (best-effort contract).
        self.assertEqual(out_ids, ["p2", "p3"])


if __name__ == "__main__":
    unittest.main()
