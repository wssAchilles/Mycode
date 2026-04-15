package planner

import "testing"

func TestPlanChunksDedupesRecipientsAndTracksChunkShape(t *testing.T) {
	payload := FanoutRequest{
		MessageID:    "msg-1",
		ChatID:       "chat-1",
		OutboxID:     "outbox-1",
		RecipientIDs: []string{"u1", "u2", "u1", "u3", "u4"},
	}

	plan := BuildShadowPlan(payload, 2)

	if plan.TotalRecipientCount != 4 {
		t.Fatalf("expected 4 deduped recipients, got %d", plan.TotalRecipientCount)
	}
	if plan.ChunkCount != 2 {
		t.Fatalf("expected 2 chunks, got %d", plan.ChunkCount)
	}
	if len(plan.Chunks) != 2 {
		t.Fatalf("expected 2 chunk plans, got %d", len(plan.Chunks))
	}
	if plan.Chunks[0].RecipientCount != 2 || plan.Chunks[1].RecipientCount != 2 {
		t.Fatalf("unexpected chunk recipient counts: %#v", plan.Chunks)
	}
}
