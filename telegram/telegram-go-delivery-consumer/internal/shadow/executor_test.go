package shadow

import "testing"

func TestTrackerComparesProjectionResults(t *testing.T) {
	tracker := New()
	tracker.Track(TrackedPlan{
		MessageID:              "msg-1",
		OutboxID:               "outbox-1",
		ChunkIndex:             0,
		ExpectedRecipientCount: 3,
		ExpectedChunkCount:     2,
	})

	result := tracker.Compare(ProjectionResult{
		MessageID:      "msg-1",
		OutboxID:       "outbox-1",
		ChunkIndex:     0,
		RecipientCount: 3,
		ChunkCount:     2,
	})

	if !result.Compared || !result.Matched {
		t.Fatalf("expected matched comparison, got %#v", result)
	}
	if tracker.Pending() != 0 {
		t.Fatalf("expected pending tracker size to be 0, got %d", tracker.Pending())
	}
}

func TestTrackerReportsMismatchWhenProjectionDiffers(t *testing.T) {
	tracker := New()
	tracker.Track(TrackedPlan{
		MessageID:              "msg-2",
		OutboxID:               "outbox-2",
		ChunkIndex:             1,
		ExpectedRecipientCount: 4,
		ExpectedChunkCount:     2,
	})

	result := tracker.Compare(ProjectionResult{
		MessageID:      "msg-2",
		OutboxID:       "outbox-2",
		ChunkIndex:     1,
		RecipientCount: 3,
		ChunkCount:     2,
	})

	if !result.Compared || result.Matched {
		t.Fatalf("expected mismatch, got %#v", result)
	}
	if result.Reason == "" {
		t.Fatalf("expected mismatch reason")
	}
}
