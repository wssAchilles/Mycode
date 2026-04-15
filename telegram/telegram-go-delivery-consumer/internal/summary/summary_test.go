package summary

import "testing"

func TestSummaryTracksConsumptionAndErrors(t *testing.T) {
	state := New("chat:delivery:bus:v1", "go-dryrun", "consumer-a", "dry-run", true)

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

func TestSummaryTracksCanaryExecutions(t *testing.T) {
	state := New("chat:delivery:bus:v1", "go-canary", "consumer-a", "canary", false)

	state.RecordCanaryExecution(true, "canary-1", "")
	state.RecordCanaryExecution(false, "canary-2", "recipient_count_mismatch")

	snapshot := state.Snapshot()
	if snapshot.CanaryExecutions != 2 {
		t.Fatalf("expected 2 canary executions, got %d", snapshot.CanaryExecutions)
	}
	if snapshot.CanarySucceeded != 1 {
		t.Fatalf("expected 1 canary success, got %d", snapshot.CanarySucceeded)
	}
	if snapshot.CanaryFailed != 1 {
		t.Fatalf("expected 1 canary failure, got %d", snapshot.CanaryFailed)
	}
	if snapshot.LastCanaryEventID != "canary-2" {
		t.Fatalf("unexpected last canary event id: %s", snapshot.LastCanaryEventID)
	}
	if snapshot.LastCanaryFailure != "recipient_count_mismatch" {
		t.Fatalf("unexpected canary failure reason: %s", snapshot.LastCanaryFailure)
	}
}
