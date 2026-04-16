package summary

import "testing"

func TestSummaryTracksConsumptionAndErrors(t *testing.T) {
	state := New("chat:delivery:bus:v1", "go-dryrun", "consumer-a", "dry-run", true)
	state.SetPlatformStreamKey("platform:events:v1")

	state.RecordConsumed("chat:delivery:bus:v1", "message_written", "1-0", "2026-04-15T00:00:00Z")
	state.RecordConsumed("platform:events:v1", "sync_wake_requested", "2-0", "2026-04-15T00:00:01Z")
	state.RecordError("boom")

	snapshot := state.Snapshot()
	if snapshot.EventsConsumed != 2 {
		t.Fatalf("expected 2 consumed events, got %d", snapshot.EventsConsumed)
	}
	if snapshot.ReadErrors != 1 {
		t.Fatalf("expected 1 read error, got %d", snapshot.ReadErrors)
	}
	if snapshot.CountsByTopic["message_written"] != 1 || snapshot.CountsByTopic["sync_wake_requested"] != 1 {
		t.Fatalf("expected topic count to be tracked")
	}
	if snapshot.CountsByStream["platform:events:v1"] != 1 {
		t.Fatalf("expected stream count to be tracked, got %#v", snapshot.CountsByStream)
	}
	if snapshot.LastEventID != "2-0" {
		t.Fatalf("unexpected last event id: %s", snapshot.LastEventID)
	}
	if snapshot.LastStreamKey != "platform:events:v1" {
		t.Fatalf("unexpected last stream key: %s", snapshot.LastStreamKey)
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

func TestSummaryTracksPrimaryExecutions(t *testing.T) {
	state := New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)

	state.RecordPrimaryExecution(true, "private", "evt-1", "outbox-1", 2, "")
	state.RecordPrimaryExecution(false, "group", "evt-2", "outbox-2", 0, "mongo write failed")
	state.RecordPrimaryRetryQueued("evt-2")
	state.RecordPrimaryFailureRecorded(false)
	state.RecordPrimaryFailureRecorded(true)
	state.RecordPrimarySkipped("evt-3", "segment_not_enabled")

	snapshot := state.Snapshot()
	if snapshot.PrimaryExecutions != 2 {
		t.Fatalf("expected 2 primary executions, got %d", snapshot.PrimaryExecutions)
	}
	if snapshot.PrimarySucceeded != 1 {
		t.Fatalf("expected 1 primary success, got %d", snapshot.PrimarySucceeded)
	}
	if snapshot.PrimaryFailed != 1 {
		t.Fatalf("expected 1 primary failure, got %d", snapshot.PrimaryFailed)
	}
	if snapshot.PrimarySkipped != 1 {
		t.Fatalf("expected 1 primary skipped, got %d", snapshot.PrimarySkipped)
	}
	if snapshot.PrimaryProjectedRecipients != 2 {
		t.Fatalf("unexpected projected recipients: %d", snapshot.PrimaryProjectedRecipients)
	}
	if snapshot.PrimaryPrivateSucceeded != 1 || snapshot.PrimaryGroupFailed != 1 {
		t.Fatalf("expected segment counters to be tracked, got %#v", snapshot)
	}
	if snapshot.PrimaryRetryQueued != 1 {
		t.Fatalf("expected 1 queued primary retry, got %d", snapshot.PrimaryRetryQueued)
	}
	if snapshot.PrimaryRetryableFailures != 1 || snapshot.PrimaryTerminalFailures != 1 {
		t.Fatalf("unexpected primary failure classes: %#v", snapshot)
	}
	if snapshot.LastPrimaryFailure != "mongo write failed" {
		t.Fatalf("unexpected primary failure reason: %s", snapshot.LastPrimaryFailure)
	}
	if snapshot.LastPrimarySkipReason != "segment_not_enabled" {
		t.Fatalf("unexpected primary skip reason: %s", snapshot.LastPrimarySkipReason)
	}
	if snapshot.PrimarySkipReasons["segment_not_enabled"] != 1 {
		t.Fatalf("expected skip reason to be tracked, got %#v", snapshot.PrimarySkipReasons)
	}
	if snapshot.Derived.PrimarySuccessRate != 0.5 {
		t.Fatalf("unexpected primary success rate: %#v", snapshot.Derived)
	}
	if snapshot.Derived.PrivatePrimarySuccessRate != 1 {
		t.Fatalf("unexpected private primary success rate: %#v", snapshot.Derived)
	}
	if snapshot.Derived.GroupPrimarySuccessRate != 0 {
		t.Fatalf("unexpected group primary success rate: %#v", snapshot.Derived)
	}
}

func TestSummaryTracksPlatformExecutions(t *testing.T) {
	state := New("chat:delivery:bus:v1", "go-primary", "consumer-a", "primary", false)

	state.RecordPlatformExecution("sync_wake_requested", true, false, "sync:update:wake:v1", "")
	state.RecordPlatformExecution("presence_fanout_requested", false, true, "", "presence_shadow_mode")

	snapshot := state.Snapshot()
	if snapshot.PlatformExecutions != 2 {
		t.Fatalf("expected 2 platform executions, got %d", snapshot.PlatformExecutions)
	}
	if snapshot.PlatformSucceeded != 1 || snapshot.PlatformShadowed != 1 {
		t.Fatalf("unexpected platform counters: %#v", snapshot)
	}
	if snapshot.LastPlatformTopic != "presence_fanout_requested" {
		t.Fatalf("unexpected last platform topic: %s", snapshot.LastPlatformTopic)
	}
	if snapshot.LastPlatformFailure != "presence_shadow_mode" {
		t.Fatalf("unexpected last platform failure: %s", snapshot.LastPlatformFailure)
	}
}
