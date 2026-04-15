package summary

import "testing"

func TestSummaryTracksConsumptionAndErrors(t *testing.T) {
	state := New("chat:delivery:bus:v1", "go-dryrun", "consumer-a", true)

	state.RecordConsumed("message_written", "1-0", "2026-04-15T00:00:00Z")
	state.RecordConsumed("fanout_requested", "2-0", "2026-04-15T00:00:01Z")
	state.RecordError("boom")

	snapshot := state.Snapshot()
	if snapshot.EventsConsumed != 2 {
		t.Fatalf("expected 2 consumed events, got %d", snapshot.EventsConsumed)
	}
	if snapshot.ReadErrors != 1 {
		t.Fatalf("expected 1 read error, got %d", snapshot.ReadErrors)
	}
	if snapshot.CountsByTopic["message_written"] != 1 {
		t.Fatalf("expected topic count to be tracked")
	}
	if snapshot.LastEventID != "2-0" {
		t.Fatalf("unexpected last event id: %s", snapshot.LastEventID)
	}
}
